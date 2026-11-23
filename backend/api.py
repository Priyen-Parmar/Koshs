"""Kosh, a local-first accounts payable case study. Run with python app.py."""

import hashlib
import mimetypes
import json
import logging
import time
from queue import Queue
from threading import Thread
from urllib.parse import quote
import os
from pathlib import Path
import re
import secrets
import sqlite3
import pymupdf
from contextlib import contextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .engine import decide, ORDERS, OPENING
from .reader import read_invoice, PDF_LOCK
from .vision import enrich, needed, provider, always
from .policy import DEFAULT, VENDORS, ORDERS, ROLES, business_date, effective_orders, identity, supplier
from .service import install,configuration,save_config,audit,now,intervene,Intervention,PolicyChange,report_pdf
from .paths import FIXTURES, ROOT, SAMPLES
from .lab import make_invoice
from .comms import brief

# Windows can map .js to text/plain in the registry, which browsers refuse for ES modules.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("image/svg+xml", ".svg")

MAILBOX = json.loads((FIXTURES / "mailbox.json").read_text(encoding="utf-8"))
DB = Path(os.environ.get("KOSH_DB", ROOT / "data" / "kosh.sqlite"))
DB.parent.mkdir(parents=True, exist_ok=True)
app = FastAPI(title="Kosh Invoice Review", docs_url=None, redoc_url=None)
app.mount("/assets", StaticFiles(directory=ROOT / "ui"), name="assets")
app.mount("/samples", StaticFiles(directory=SAMPLES), name="samples")
LIMIT = 6 * 1024 * 1024


@contextmanager
def database():
    conn = sqlite3.connect(DB, timeout=12)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def initialize_database():
    with database() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("""CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY, workspace TEXT NOT NULL, digest TEXT, filename TEXT, pdf BLOB,
            readout TEXT, result TEXT, created TEXT, closed_by TEXT, resolves TEXT, note TEXT,
            UNIQUE(workspace,digest))""")
        db.execute("CREATE INDEX IF NOT EXISTS by_workspace ON runs(workspace,created)")
        db.execute("CREATE TABLE IF NOT EXISTS reader_budget (hour INTEGER PRIMARY KEY, used INTEGER NOT NULL)")

        install(db)
        # Migrate prior local approvals without changing the original audit records.
        db.execute("""INSERT OR IGNORE INTO postings SELECT id,workspace,json_extract(result,'$.po'),json_extract(result,'$.amount'),json_extract(result,'$.qty') FROM runs WHERE json_extract(result,'$.status')='Approved'""")


initialize_database()


@app.middleware("http")
async def workspace(request: Request, call_next):
    wid = request.cookies.get("kosh_session", "")
    fresh = not re.fullmatch("[0-9a-f]{64}", wid)
    request.state.wid = secrets.token_hex(32) if fresh else wid
    response = await call_next(request)
    if fresh or getattr(request.state, "renew", False):
        response.set_cookie(
            "kosh_session",
            request.state.wid,
            httponly=True,
            samesite="strict",
            secure=request.url.scheme == "https",
            max_age=60 * 60 * 24 * 30,
        )
    response.headers["X-Content-Type-Options"] = "nosniff"
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
    elif request.url.path.startswith("/assets") or request.url.path == "/":
        response.headers["Cache-Control"] = "no-cache"
    return response


def record(row):
    result = {
        **json.loads(row["result"]),
        **{
            k: row[k]
            for k in ("id", "filename", "created", "closed_by", "resolves", "note")
        },
    }
    result.setdefault("timeline", [])
    result["kind"] = "action" if any(e.get("stage") == "Human review" for e in result["timeline"]) else "review"
    result["brief"] = brief(result)
    return result


def history(db, wid):
    return [
        record(r)
        for r in db.execute(
            """SELECT id,result,filename,created,closed_by,resolves,note
            FROM runs WHERE workspace=? ORDER BY created DESC""",
            (wid,),
        )
    ]


def get_run(db, wid, rid):
    row = db.execute(
        "SELECT * FROM runs WHERE workspace=? AND id=?", (wid, rid)
    ).fetchone()
    if not row:
        raise HTTPException(404, "Run not found in this workspace.")
    return row


@app.get("/healthz")
def health():
    with database() as db:
        db.execute("SELECT id FROM runs LIMIT 1").fetchone()
    return {"status":"ok"}


@app.get("/")
def home():
    return FileResponse(ROOT / "ui" / "index.html")


@app.get("/api/dashboard")
def dashboard(request: Request):
    with database() as db:
        rows = history(db, request.state.wid)
        state=configuration(db,request.state.wid)
        versions=[dict(r) for r in db.execute("SELECT version,created FROM policies WHERE workspace=? ORDER BY version DESC",(request.state.wid,))]
        postings=[dict(r) for r in db.execute("SELECT * FROM postings WHERE workspace=?",(request.state.wid,))]
        actions=[dict(r) for r in db.execute("SELECT run_id,role,action,reason,created FROM actions WHERE workspace=? ORDER BY rowid DESC",(request.state.wid,))]
        payments=[dict(r) for r in db.execute("SELECT * FROM payments WHERE workspace=?",(request.state.wid,))]
    orders=[]
    approved=[r for r in rows if r["status"]=="Approved"]
    for num,o in effective_orders(state).items():
        prior=[r for r in [*OPENING,*postings] if r["po"]==num]
        lines=[]
        for line in o["lines"]:
            key=identity(line["item"])
            billed=sum(r["qty"] for r in OPENING if r["po"]==num and identity(r.get("item"))==key)
            billed+=sum(l.get("qty") or 0 for r in approved if r.get("po")==num for l in (r.get("lines") or [r]) if identity(l.get("item"))==key)
            lines.append({**line,"billed":billed})
        orders.append({**o,"lines":lines,"limit":sum(l["units"]*l["rate"] for l in o["lines"]),"units":sum(l["units"] for l in o["lines"]),
                       "billed":sum(r["amount"] for r in prior),"used":sum(r["qty"] for r in prior),
                       "amended":num in state["amendments"],"base_units":sum(l["units"] for l in ORDERS[num]["lines"])})
    vendors=[{**{k2:v2 for k2,v2 in v.items() if k2!="account"},"account":"•••• "+state["banks"].get(k,v["account"])[-4:],
              "verified_change":k in state["banks"] and state["banks"][k]!=v["account"]} for k,v in VENDORS.items()]
    ai=provider()
    return {"temporary_storage":os.getenv("KOSH_TEMPORARY_STORAGE")=="1","reference_date":bool(os.getenv("KOSH_DEMO_DATE")),"ai":ai["label"] if ai else None,"mail":MAILBOX,"payments":payments,"today":business_date().isoformat(),"runs":rows,"orders":orders,"opening":OPENING,"vendors":vendors,"policy":state["policy"],"versions":versions,"actions":actions,
            "samples":json.loads((FIXTURES / "sample_catalog.json").read_text(encoding="utf-8-sig"))}


@app.get("/api/runs/{rid}")
def detail(request: Request, rid: str):
    with database() as db:
        r=record(get_run(db,request.state.wid,rid))
        r["actions"]=[dict(a) for a in db.execute("SELECT role,action,reason,created FROM actions WHERE workspace=? AND run_id=? ORDER BY rowid",(request.state.wid,rid))]
        return r


@app.get("/api/runs/{rid}/source")
def source(request: Request, rid: str):
    with database() as db:
        row=get_run(db,request.state.wid,rid)
        data=row["pdf"]
        name=quote(Path(row["filename"]).name,safe="")
    return Response(
        bytes(data),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename*=UTF-8''"+name},
    )


@app.post("/api/new-workspace")
def new_workspace(request: Request):
    request.state.wid = secrets.token_hex(32)
    request.state.renew = True
    return {"started": True}


_THUMBS = {}


@app.get("/api/sample-thumb/{slug}")
def sample_thumb(slug: str):
    """First page of a bundled sample, small, for mailbox attachment previews."""
    path = SAMPLES / f"{slug}.pdf"
    if not re.fullmatch(r"[a-z0-9-]{1,40}", slug) or not path.is_file():
        raise HTTPException(404, "Sample not found.")
    if slug not in _THUMBS:
        with PDF_LOCK, pymupdf.open(path) as doc:
            page = doc[0]
            scale = 220 / page.rect.width
            _THUMBS[slug] = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False).tobytes("png")
    return Response(_THUMBS[slug], media_type="image/png", headers={"Cache-Control": "max-age=3600"})


@app.get("/api/runs/{rid}/page/{number}")
def preview(request: Request, rid: str, number: int):
    with database() as db:
        row = get_run(db, request.state.wid, rid)
    if record(row)["status"] == "Error":
        raise HTTPException(422, "Preview unavailable for unreadable documents.")
    with PDF_LOCK, pymupdf.open(stream=row["pdf"], filetype="pdf") as doc:
        if not 1 <= number <= len(doc):
            raise HTTPException(404, "Page not found.")
        page = doc[number - 1]
        scale = min(1.7, 1600 / max(page.rect.width, page.rect.height))
        png = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale)).tobytes("png")
    return Response(png, media_type="image/png")


def document_digest(data, sender="", mail_id=""):
    fingerprint = hashlib.sha256(data)
    if sender or mail_id:
        fingerprint.update(b"\0")
        fingerprint.update(json.dumps([sender, mail_id], ensure_ascii=True).encode("ascii"))
    return fingerprint.hexdigest()


def reserve_cloud_read():
    """Cap outbound model requests across workspaces, including concurrent uploads."""
    limit = max(0, int(os.environ.get("KOSH_CLOUD_READS_PER_HOUR", "20")))
    hour = int(time.time() // 3600)
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("DELETE FROM reader_budget WHERE hour < ?", (hour,))
        db.execute("INSERT OR IGNORE INTO reader_budget VALUES (?, 0)", (hour,))
        return db.execute("UPDATE reader_budget SET used=used+1 WHERE hour=? AND used<?",
                          (hour, limit)).rowcount == 1


def match_document(db, wid, data, digest):
    # Older releases keyed every upload by PDF alone. Re-key an old mail record
    # on first access so both the original email and a later upload keep their own evidence.
    query = "SELECT * FROM runs WHERE workspace=? AND digest=?"
    raw = document_digest(data)
    old = db.execute(query, (wid, raw)).fetchone()
    if old:
        saved = json.loads(old["readout"])
        saved_digest = document_digest(data, saved.get("sender", ""), (saved.get("mail") or {}).get("id", ""))
        if saved_digest != raw:
            collision = db.execute("SELECT 1 FROM runs WHERE workspace=? AND digest=?", (wid, saved_digest)).fetchone()
            db.execute("UPDATE runs SET digest=? WHERE id=?", (None if collision else saved_digest, old["id"]))
        elif raw == digest:
            return old
    return db.execute(query, (wid, digest)).fetchone()


def store_run(
    wid,
    data,
    filename,
    readout,
    digest,
    *,
    selection=None,
    resolves=None,
    note=None,
    error=None,
    body=None, timeline=None, on_check=None,
):
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        previous = history(db, wid)
        settings=configuration(db,wid)
        same = None
        if resolves:
            old = get_run(db, wid, resolves)
            old_result = record(old)
            if old["closed_by"]:
                return record(get_run(db, wid, old["closed_by"]))
            body=body or Intervention(action="select_po",role="Procurement",reason=note,value=selection)
            intervene(body,old_result,readout,settings,effective_orders(settings))
            audit(db,wid,resolves,body.role,body.action,body.reason)
            if body.action=="request_info":return record(old)
            save_config(db,wid,settings)
        elif digest:
            same = match_document(db, wid, data, digest)
            if same:
                prior = record(same)
                # A correction can arrive before the original hold is in the workspace.
                # Preserve the unsuccessful attempt and re-evaluate once its parent exists.
                pending_ref = readout["fields"].get("replaces")
                missing_parent = any(
                    c["name"] == "Correction reference" and c["status"] == "Hold"
                    for c in prior["checks"]
                )
                now_present = any(
                    identity(r["number"]) == identity(pending_ref)
                    and r["vendor"] == prior["vendor"]
                    and r["po"] == prior["po"]
                    and r["status"] == "Hold"
                    and not r["closed_by"]
                    for r in previous
                )
                if not (missing_parent and now_present and not prior["closed_by"]):
                    return {**prior, "existing": True}
                db.execute("UPDATE runs SET digest=NULL WHERE id=?", (prior["id"],))
                previous = [r for r in previous if r["id"] != prior["id"]]
                note = "Rechecked after the referenced invoice became available."
        if error:
            result = dict(
                status="Error",
                title="Document could not be read",
                owner="Accounts payable",
                action=error,
                number="Unread invoice",
                vendor="Unknown supplier",
                item=None,
                po="",
                qty=0,
                amount=0,
                gross=None,
                checks=[],
                balance=None,
                candidates=[],
                parent=None,
            )
        else:
            result = decide(
                readout,
                [r for r in previous if r["id"] != resolves and r["status"] != "Error"],
                selection or readout.get("selected_po"), settings, on_check,
            )
        if body and body.action=="reject":
            result.update(status="Rejected",title="Rejected by reviewer",summary=body.reason,action="Notify the supplier of the rejection.",owner=body.role)
        if timeline is not None and not error:
            timeline.append(dict(stage="Policy checks",state="done",detail=result["status"],ms=elapsed(timeline,"Policy checks")))
        if timeline is None and body:
            timeline=[dict(stage="Human review",state="done",detail=body.role+" · "+body.action.replace("_"," "),ms=0)]
        timeline=timeline or []
        timeline.append(dict(stage="Decision",state="failed" if error else "done",detail=result["status"],ms=0))
        result["timeline"]=[{k:v for k,v in e.items() if k!="tick"} for e in timeline]
        result["cycle_ms"]=sum((e.get("ms") or 0) for e in timeline if e["state"] in ("done","failed"))
        result["ai_review"]=readout.get("ai_review",[])
        result.update(
            evidence=readout["evidence"],
            pages=readout.get("pages", 0),
            method=readout["method"],
            policy="AP-01 / v"+str(settings["policy"]["version"]),
        )
        rid = secrets.token_hex(8)
        parent = resolves or (
            result.get("parent")
        )
        db.execute(
            "INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (
                rid,
                wid,
                digest,
                filename,
                data,
                json.dumps(readout),
                json.dumps(result),
                datetime.now(timezone.utc).isoformat(),
                None,
                parent,
                note,
            ),
        )
        if body:audit(db,wid,rid,body.role,body.action,body.reason)
        if result["status"]=="Approved":db.execute("INSERT INTO postings VALUES(?,?,?,?,?)",(rid,wid,result["po"],result["amount"],result["qty"]))
        if parent:
            db.execute(
                "UPDATE runs SET closed_by=? WHERE id=? AND workspace=?",
                (rid, parent, wid),
            )
        if not resolves and digest and same:
            db.execute("UPDATE runs SET closed_by=? WHERE id=?", (rid, same["id"]))
        return record(get_run(db, wid, rid))


def event(**kw):
    return json.dumps(kw) + "\n"


@app.post("/api/review")
async def review(request: Request):
    chunks = bytearray()
    async for chunk in request.stream():
        if len(chunks) + len(chunk) > LIMIT:
            raise HTTPException(413, "PDF exceeds 6 MB.")
        chunks.extend(chunk)
    data = bytes(chunks)
    if not data.startswith(b"%PDF-"):
        raise HTTPException(422, "Select a genuine PDF file.")
    filename = request.query_params.get("name", "invoice.pdf")[:150]
    wid = request.state.wid
    sender = request.query_params.get("sender", "").strip().lower()[:120]
    if sender and not re.fullmatch(r"[^@\s]+@[a-z0-9.-]+\.[a-z]{2,}", sender):
        raise HTTPException(422, "The sender must be an email address.")
    mail_id = request.query_params.get("mail", "")[:20]
    mail = next(({"id": m["id"], "subject": m["subject"], "from_name": m["from_name"]} for m in MAILBOX if m["id"] == mail_id), None)

    def run():
        events=Queue()
        def worker():
            timeline=[]
            def push(stage,state,detail,ms=None):
                e=dict(stage=stage,state=state,detail=detail,ms=ms,tick=time.monotonic())
                timeline.append(e);events.put({k:v for k,v in e.items() if k!="tick"})
            stage="Receive PDF"
            try:
                push(stage,"running",filename)
                # A mailbox envelope contributes evidence to sender verification.
                digest = document_digest(data, sender, mail["id"] if mail else "")
                push(stage,"done",f"{len(data):,} bytes",elapsed(timeline,stage))
                stage="Read document";push(stage,"running","Locating printed fields")
                extraction=read_invoice(data,lambda message:events.put(dict(stage=stage,state="progress",detail=message)))
                push(stage,"done",f"{extraction['pages']} page(s) · {extraction['method']}",elapsed(timeline,stage))
                stage="AI reader"
                ai=provider()
                use_ai = bool(ai and (needed(extraction) or always()))
                if use_ai and ai["name"] in ("gemini", "claude") and not reserve_cloud_read():
                    push(stage, "skipped", "Hourly cloud reader limit reached. Continuing with printed evidence.")
                elif use_ai:
                    push(stage,"running",f"{ai['label']} is proposing values; each must be found on the page")
                    extraction=enrich(data,extraction,ai)
                    kept=sum(1 for x in extraction.get("ai_review",[]) if x["verified"])
                    push(stage,"failed" if extraction.get("ai_error") else "done",
                         "Reader unavailable; continuing with printed labels" if extraction.get("ai_error") else
                         f"{kept} of {len(extraction.get('ai_review',[]))} proposed values verified on the page",elapsed(timeline,stage))
                else:push(stage,"skipped","Printed labels covered every field" if not needed(extraction) else "No AI reader configured; missing fields will hold")
                if sender:extraction["sender"]=sender
                if mail:extraction["mail"]=mail
                stage="Policy checks";push(stage,"running","Matching supplier, order and receipts")
                result=store_run(wid,data,filename,extraction,digest,timeline=timeline,
                                 on_check=lambda c:events.put(dict(stage="Policy checks",state="check",detail=c["name"]+" · "+c["status"])))
                events.put(dict(stage=stage,state="done",detail=result["status"],ms=elapsed(timeline,stage)))
                events.put(dict(stage="Decision",state="done",detail="Prior review" if result.get("existing") else result["status"]))
                events.put(dict(result=result))
            except Exception as exc:
                logging.exception("Review failed during %s",stage)
                msg=str(exc) if isinstance(exc,ValueError) else ("Unable to open this PDF. Upload a legible, unlocked copy." if stage=="Read document" else "Review interrupted. Retry this invoice.")
                push(stage,"failed",msg,elapsed(timeline,stage))
                try:events.put(dict(result=store_run(wid,data,filename,{"method":"Unavailable","evidence":[]},None,error=msg,timeline=timeline)))
                except Exception:events.put(dict(error="The ledger could not save this review. Retry once storage is available."))
            finally:events.put(None)
        Thread(target=worker,daemon=True).start()
        while True:
            payload=events.get()
            if payload is None:break
            yield event(**payload)

    return StreamingResponse(
        run(), media_type="application/x-ndjson", headers={"X-Accel-Buffering": "no"}
    )


def elapsed(timeline,stage):
    start=next((e["tick"] for e in reversed(timeline) if e.get("stage")==stage and e.get("state")=="running"),None)
    return round((time.monotonic()-start)*1000) if start is not None else 0


@app.post("/api/lab")
def lab(request:Request,spec:dict):
    # "@record" prints the account already on file without exposing it to the browser.
    if spec.get("bank")=="@record":
        with database() as db:banks=configuration(db,request.state.wid)["banks"]
        name=supplier(spec.get("vendor","")) or ""
        spec={**spec,"bank":banks.get(name,VENDORS.get(name,{}).get("account",""))}
    try:
        with PDF_LOCK: data=make_invoice(spec)
    except (ValueError,TypeError,ArithmeticError) as exc:raise HTTPException(422,str(exc)) from exc
    return Response(data,media_type="application/pdf")


class PaymentChange(BaseModel):
    action: str = Field(pattern="^(schedule|release|cancel)$")
    role: str
    ids: list[str] = Field(min_length=1, max_length=50)


@app.post("/api/payments")
def payments(request: Request, body: PaymentChange):
    """Schedule approved invoices into a batch (AP), release it (finance controller), or cancel before release."""
    wid = request.state.wid
    need = {"schedule": "Accounts payable", "release": "Finance controller", "cancel": "Accounts payable"}[body.action]
    if body.role != need:
        raise HTTPException(403, f"{need} records this step. Switch role to continue.")
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        state = configuration(db, wid)
        batch = "PB-" + secrets.token_hex(2).upper()
        today = business_date()
        done = []
        for rid in dict.fromkeys(body.ids):
            run = record(get_run(db, wid, rid))
            current = db.execute("SELECT * FROM payments WHERE workspace=? AND run_id=?", (wid, rid)).fetchone()
            if body.action == "schedule":
                if run["status"] != "Approved" or run["closed_by"] or current:
                    raise HTTPException(409, f"{run['number']} is not an approved, unscheduled invoice.")
                vendor = VENDORS.get(run["vendor"], {})
                # Bank details must still match the record when money moves, not just when the invoice was approved.
                pct, days = (vendor.get("discount") or "0|0").split("|")
                inv = datetime.fromisoformat(run["date"]).date() if run.get("date") else today
                discount = round((run["gross"] or 0) * float(pct) / 100) if (today - inv).days <= int(days) else 0
                db.execute("INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?,?)",
                           (wid, rid, "Scheduled", batch, (run["gross"] or 0) - discount, discount, now(), body.role, None, None))
            elif body.action == "release":
                if not current or current["status"] != "Scheduled":
                    raise HTTPException(409, f"{run['number']} has no scheduled payment to release.")
                db.execute("UPDATE payments SET status='Paid',paid=?,paid_by=? WHERE workspace=? AND run_id=?", (now(), body.role, wid, rid))
            else:
                if not current or current["status"] != "Scheduled":
                    raise HTTPException(409, f"{run['number']} has no scheduled payment to cancel.")
                db.execute("DELETE FROM payments WHERE workspace=? AND run_id=?", (wid, rid))
            audit(db, wid, rid, body.role, "payment_" + body.action, f"Payment of {run['number']} " + {"schedule": f"scheduled in {batch}", "release": "released", "cancel": "cancelled"}[body.action])
            done.append(rid)
        return {"done": done, "batch": batch if body.action == "schedule" else None}


class Note(BaseModel):
    role: str
    text: str = Field(min_length=1, max_length=600)


@app.post("/api/runs/{rid}/note")
def add_note(request: Request, rid: str, body: Note):
    """A team note on an invoice. Notes never change a decision; they sit in the audit trail."""
    if body.role not in ROLES or not body.text.strip():
        raise HTTPException(422, "Write a note as one of the demo roles.")
    with database() as db:
        get_run(db, request.state.wid, rid)
        audit(db, request.state.wid, rid, body.role, "note", body.text.strip())
    return {"ok": True}


@app.post("/api/runs/{rid}/action")
def action(request:Request,rid:str,body:Intervention):
    with database() as db:old=get_run(db,request.state.wid,rid)
    return store_run(request.state.wid,old["pdf"],old["filename"],json.loads(old["readout"]),None,resolves=rid,body=body,note=body.reason)


@app.get("/api/runs/{rid}/report")
def report(request:Request,rid:str):
    r=detail(request,rid)
    return Response(report_pdf(r,r["actions"]),media_type="application/pdf",headers={"Content-Disposition":"attachment; filename=kosh-decision-"+rid+".pdf"})


@app.post("/api/policy/{operation}")
def policy_change(request:Request,operation:str,body:PolicyChange):
    wid=request.state.wid
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        cfg=configuration(db,wid)
        cfg["policy"]={**body.model_dump(),"version":cfg["policy"]["version"]+1}
        if operation=="preview":
            prior=history(db,wid)
            diff=[]
            for r in prior:
                if r["status"]!="Hold" or r["closed_by"]:continue
                source=json.loads(get_run(db,wid,r["id"])["readout"])
                sim=decide(source,[p for p in prior if p["id"]!=r["id"]],source.get("selected_po"),cfg)
                diff.append({"id":r["id"],"number":r["number"],"status":sim["status"],"summary":sim["summary"]})
            return {"preview":diff}
        if operation!="save":raise HTTPException(404)
        save_config(db,wid,cfg)
        db.execute("INSERT INTO policies VALUES(?,?,?,?)",(wid,cfg["policy"]["version"],json.dumps(cfg["policy"]),now()))
        return cfg["policy"]


class Resolution(BaseModel):
    po: str = Field(min_length=1, max_length=40)
    reason: str = Field(min_length=5, max_length=400)


@app.post("/api/runs/{rid}/resolve")
def resolve(request: Request, rid: str, body: Resolution):
    with database() as db:
        old = get_run(db, request.state.wid, rid)
    if len(body.reason.strip()) < 5:
        raise HTTPException(422, "Enter the evidence for your selection.")
    return store_run(
        request.state.wid,
        old["pdf"],
        old["filename"],
        json.loads(old["readout"]),
        None,
        selection=body.po,
        resolves=rid,
        note=body.reason.strip(),
    )


def main():
    import uvicorn

    uvicorn.run(
        app,
        host=os.environ.get("KOSH_HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8765")),
    )
