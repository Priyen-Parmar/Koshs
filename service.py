"""Workspace settings, allowed interventions, and reviewer exports."""
import csv
import io
import json
from datetime import datetime,timezone
from fastapi import HTTPException
from pydantic import BaseModel,Field
import pymupdf
from policy import DEFAULT, CONFIG_DEFAULT, VENDORS, ROLES, identity
from engine import WAIVABLE
from reader import PDF_LOCK

def now():return datetime.now(timezone.utc).isoformat()

def install(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS settings (workspace TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS actions (workspace TEXT,run_id TEXT,role TEXT,action TEXT,reason TEXT,created TEXT);
    CREATE TABLE IF NOT EXISTS policies (workspace TEXT,version INTEGER,value TEXT,created TEXT,PRIMARY KEY(workspace,version));
    CREATE TABLE IF NOT EXISTS postings (run_id TEXT PRIMARY KEY,workspace TEXT,po TEXT,amount INTEGER,qty INTEGER);
    CREATE TABLE IF NOT EXISTS payments (workspace TEXT,run_id TEXT,status TEXT,batch TEXT,amount INTEGER,discount INTEGER,
        scheduled TEXT,scheduled_by TEXT,paid TEXT,paid_by TEXT,PRIMARY KEY(workspace,run_id));
    """)

def configuration(db,wid):
    row=db.execute("SELECT value FROM settings WHERE workspace=?",(wid,)).fetchone()
    state=json.loads(row[0]) if row else {"policy":dict(DEFAULT)}
    for key,value in CONFIG_DEFAULT.items():state.setdefault(key,json.loads(json.dumps(value)))
    return state

def save_config(db,wid,state):
    db.execute("INSERT OR REPLACE INTO settings VALUES(?,?)",(wid,json.dumps(state)))

def audit(db,wid,rid,role,action,note):
    db.execute("INSERT INTO actions VALUES(?,?,?,?,?,?)",(wid,rid,role,action,note,now()))

class Intervention(BaseModel):
    action:str
    role:str
    reason:str=Field(min_length=5,max_length=500)
    value:str=Field(default="",max_length=150)
    field:str=Field(default="",max_length=30)
    page:int=Field(default=1,ge=1,le=8)

class PolicyChange(BaseModel):
    price_percent:float=Field(ge=0,le=5)
    approval_limit:int=Field(ge=1,le=10000000)
    age_days:int=Field(ge=1,le=1500)
    allow_derived:bool=True

def intervene(body,r,readout,state,orders):
    kind,role,note,value=body.action,body.role,body.reason.strip(),body.value.strip()
    owners={"verify_bank":"Vendor master team","verify_sender":"Vendor master team","amend":"Procurement","select_po":"Procurement","receipt":"Procurement",
            "controller":"Finance controller","waive":"Finance controller","correct_field":"Accounts payable"}
    if role not in ROLES or (kind in owners and owners[kind]!=role):
        raise HTTPException(403,"Switch to the responsible demo role to record this action.")
    if len(note)<5 or r["status"]!="Hold":raise HTTPException(409,"An open hold and an evidence note are required.")
    failed={c["name"] for c in r["checks"] if c["status"]=="Hold"}
    if kind=="request_info":return
    if kind=="reject":
        if role not in ("Accounts payable",r["owner"]):raise HTTPException(403,"The owner or accounts payable must record a rejection.")
    elif kind=="select_po":
        if value not in r["candidates"]:raise HTTPException(409,"Choose a purchase order for this supplier.")
        readout["selected_po"]=value
    elif kind=="verify_bank":
        vendor=VENDORS.get(r["vendor"])
        if not vendor or value!=vendor["contact"] or "Remittance account" not in failed:
            raise HTTPException(409,"Confirm the callback through the registered supplier contact.")
        account=readout["fields"].get("bank","").replace(" ","").replace("-","")
        if not account.isdigit() or not 6<=len(account)<=24:raise HTTPException(409,"The printed account is incomplete.")
        state["banks"][r["vendor"]]=account
        readout["sender_verified"]=True  # the same callback confirms who sent the invoice
    elif kind=="verify_sender":
        vendor=VENDORS.get(r["vendor"])
        if not vendor or value!=vendor["contact"] or "Sender verification" not in failed:
            raise HTTPException(409,"Confirm the sender through the registered supplier contact.")
        readout["sender_verified"]=True
    elif kind=="amend":
        order=orders.get(r["po"])
        if not order or len(order["lines"])!=1 or "Cumulative order balance" not in failed or not value.isdigit() or not order["lines"][0]["units"]<int(value)<=100000:
            raise HTTPException(409,"Enter the authorised new order quantity from the amendment.")
        state["amendments"][r["po"]]=int(value)
    elif kind=="receipt":
        order=orders.get(r["po"])
        line=next((l for l in (order or {}).get("lines",[]) if identity(l["item"])==identity(body.field)),None)
        if not line or "Goods receipt" not in failed or line["received"] is None or not value.isdigit() or not line["received"]<int(value)<=line["units"]:
            raise HTTPException(409,"Enter the new total received quantity for an order line with a receipt shortfall.")
        state["receipts"].setdefault(r["po"],{})[identity(line["item"])]=int(value)
    elif kind=="waive":
        if body.field not in WAIVABLE or body.field not in failed:
            raise HTTPException(409,"Only a failed date, order-line, GST or embedded-instruction check can be waived.")
        readout["waived"]=sorted({*readout.get("waived",[]),body.field})
    elif kind=="controller":
        if "Controller approval" not in failed:raise HTTPException(409,"This invoice does not require controller approval.")
        readout["controller"]=True
    elif kind=="correct_field":
        key=body.field
        if key not in ("vendor","date","number","currency","po","subtotal","tax","total") or not value or body.page>readout.get("pages",0):
            raise HTTPException(422,"Supply a supported field, its printed value and a valid page.")
        readout["fields"][key]=value
        readout["evidence"].append({"field":key,"value":value,"page":body.page,"source":"Human confirmation","bbox":None})
        readout["warnings"]=[w for w in readout["warnings"] if w not in (f"Readers disagree on {key}. Inspect the PDF.",f"Conflicting printed {key} values.",f"Vision reading for {key} needs source confirmation.")]
    else:raise HTTPException(422,"Unknown action.")


def report_pdf(r,actions):
    """A one-page-per-section audit record of a decision, generated from the stored result only."""
    from textwrap import wrap
    from comms import brief
    b=r.get("brief") or brief(r)
    ink,muted,line=(0.08,0.13,0.11),(0.38,0.44,0.42),(0.86,0.85,0.81)
    tone={"Approved":(0.09,0.47,0.31),"Hold":(0.60,0.36,0.0),"Rejected":(0.70,0.15,0.12),"Error":(0.37,0.42,0.40)}.get(r["status"],(0.3,0.3,0.3))
    def clean(v):
        return str(v if v is not None else "-").replace("₹","INR ").replace("••••","****").replace("·","/").replace("—","-").replace("−","-").replace("“",'"').replace("”",'"').replace("’","'")
    def inr(paise):
        if paise is None:return "-"
        whole,frac=divmod(abs(int(paise)),100);d=str(whole);head,tail=d[:-3],d[-3:];parts=[]
        while head:parts.insert(0,head[-2:]);head=head[:-2]
        return "INR "+",".join(parts+[tail])+(f".{frac:02}" if frac else "")
    with PDF_LOCK,pymupdf.open() as doc:
        page=None;y=0
        def new_page():
            nonlocal page,y
            page=doc.new_page(width=595,height=842)
            page.draw_rect((0,0,595,8),color=None,fill=(0.05,0.29,0.25))
            page.insert_text((40,826),f"Kosh decision record  /  run {r['id']}  /  generated from stored evidence",fontsize=8,color=muted)
            y=44
        def need(h):
            if y+h>800:new_page()
        def text(t,size=10,bold=False,color=ink,indent=0,width=96,gap=3):
            nonlocal y
            for part in wrap(clean(t),width) or [""]:
                need(size+gap);page.insert_text((40+indent,y),part,fontsize=size,fontname="hebo" if bold else "helv",color=color);y+=size+gap
        def rule():
            nonlocal y
            need(14);page.draw_line((40,y),(555,y),color=line,width=0.7);y+=14
        def heading(t):
            nonlocal y
            y+=6;need(30);text(t.upper(),8.5,True,muted);y+=2
        new_page()
        text("KOSH  /  Nimbus Retail accounts payable",8.5,True,muted);y+=6
        text(f"{r['number']}  -  {r['vendor']}",20,True,width=60,gap=6)
        page.draw_rect((40,y,40+9*len(r["status"])+18,y+18),color=None,fill=tone)
        page.insert_text((49,y+12.5),r["status"].upper(),fontsize=9,fontname="hebo",color=(1,1,1));y+=32
        text(b.get("headline") or r.get("title"),13,True,width=80,gap=5)
        text(b.get("explanation") or r.get("summary",""),10,color=muted,width=100)
        y+=4;text(f"Owner: {r.get('owner')}   Next action: {r.get('action')}",9.5,width=104)
        rule()
        facts=[("Purchase order",r.get("po") or "Not printed"),("Gross total",inr(r.get("gross"))),("Pre-tax",inr(r.get("amount"))),
               ("Invoice date",r.get("date") or "-"),("Due",r.get("due") or "-"),("Policy",r.get("policy")),("Reader",r.get("method")),
               ("Reviewed (UTC)",(r.get("created") or "")[:19].replace("T"," ")),("Source file",r.get("filename"))]
        for i,(k,v) in enumerate(facts):
            x=40+(i%3)*172
            if i%3==0:need(30)
            page.insert_text((x,y),clean(k).upper(),fontsize=7.5,fontname="hebo",color=muted)
            page.insert_text((x,y+12),clean(v)[:34],fontsize=9.5,color=ink)
            if i%3==2 or i==len(facts)-1:y+=30
        bal=r.get("balance")
        if bal:
            heading("Order reconciliation")
            text(f"Authorised {inr(bal['limit'])}   /   Previously billed {inr(bal['spent'])}   /   This invoice {inr(bal['requested'])}   /   "
                 +(f"Excess {inr(bal['excess'])}" if bal.get("excess") else f"Remaining {inr(bal['available']-(r['amount'] if r['status']=='Approved' else 0))}"),9.5,width=110)
            for l in bal.get("ledger",[]):text(f"- {l['number']}: {l['qty']} units, {inr(l['amount'])}",9,color=muted,indent=8)
        heading("Policy checks")
        for c in r.get("checks",[]):
            need(28)
            col={"Passed":(0.09,0.47,0.31),"Hold":(0.70,0.36,0.0),"Waived":(0.42,0.28,0.76)}.get(c["status"],muted)
            page.draw_circle((44,y-3.5),3,color=None,fill=col)
            page.insert_text((54,y),clean(c["name"]),fontsize=10,fontname="hebo",color=ink)
            page.insert_text((470,y),clean(c["status"]).upper(),fontsize=8,fontname="hebo",color=col);y+=13
            text(c["detail"],9,color=muted,indent=14,width=98,gap=2);y+=3
        if r.get("evidence"):
            heading("Printed evidence")
            for e in r["evidence"]:text(f"{e['field']}: {e['value']}   (page {e['page']}, {e.get('source','PDF text')})",8.5,color=muted,width=112,gap=2)
        heading("Audit trail")
        for e in r.get("timeline",[]):
            if e.get("state") in ("running","progress"):continue
            text(f"{e['stage']}: {e.get('detail') or e.get('state')}"+(f"  ({e['ms']} ms)" if e.get("ms") else ""),9,width=110,gap=2)
        for a in actions:text(f"{a['created'][:19].replace('T',' ')} UTC  {a['role']}  {a['action'].replace('_',' ')}: {a['reason']}",9,width=110,gap=2)
        if r.get("resolves"):text(f"Follow-up to run {r['resolves']}.",9,color=muted)
        if r.get("closed_by"):text(f"Closed by run {r['closed_by']}.",9,color=muted)
        return doc.tobytes(deflate=True,garbage=3)
