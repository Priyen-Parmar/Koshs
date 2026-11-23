"""Regression tests for the audit upgrade: real-world formats, every reviewer action, AI verification and exports."""

import pymupdf
import pytest

from test_kosh import alter, client, run, sample  # noqa: F401  (client is a fixture)


def page_pdf(lines):
    with pymupdf.open() as d:
        p = d.new_page()
        for i, l in enumerate(lines):
            p.insert_text((40, 60 + i * 18), l, fontsize=11)
        return d.tobytes()


BASE = dict(vendor="Vendor: Apex Office Supply", number="Invoice number: {n}", date="Date: 2026-11-23",
            cur="Currency: INR", po="Purchase order: PO-A", item="Item: Desk lamp", qty="Quantity: 1",
            rate="Unit price: 2,000.00", sub="Subtotal: 2,000.00", tax="Tax: 360.00", tot="Total: 2,360.00")


def invoice(n, **change):
    fields = {**BASE, **change}
    return page_pdf([l for v in fields.values() for l in v.format(n=n).split("\n")])


@pytest.mark.parametrize("change", [
    {"date": "Date: 23/11/2026"}, {"date": "Date: 23 Nov 2026"}, {"vendor": "Vendor: Apex Office Supply Pvt Ltd"},
    {"tax": "CGST: 180.00\nSGST: 180.00"}, {"po": "PO #: PO-A"}, {"sub": "Sub Total: 2,000.00"},
    {"qty": "Quantity: 1.0"}, {"number": "Invoice No: {n}"}, {"tot": "Total: Rs. 2,360.00"},
])
def test_real_world_formats_approve(client, change):
    r = run(client, invoice("F-1", **change))
    assert r["status"] == "Approved", [c for c in r["checks"] if c["status"] != "Passed"]


def test_wrong_gst_type_and_unknown_vendor_hold(client):
    r = run(client, invoice("G-1", tax="IGST: 360.00"))
    assert r["status"] == "Hold" and r["title"] == "GST breakdown"
    r = run(client, invoice("G-2", vendor="Vendor: Zenith Traders"))
    assert r["title"] == "Approved supplier"
    assert next(c for c in r["checks"] if c["name"] == "Purchase order")["status"] == "Awaiting"


def act(c, rid, **body):
    return c.post(f"/api/runs/{rid}/action", json={"reason": "Evidence recorded for the test.", **body})


def test_multiline_split_gst_and_receipt_action(client):
    m = run(client, sample("apex-multiline"))
    assert m["status"] == "Approved" and m["gross"] == 354000 and len(m["lines"]) == 2
    hold = run(client, sample("delta-receipt"))
    assert hold["title"] == "Goods receipt" and hold["brief"]["message"]["to"].startswith("Procurement")
    assert act(client, hold["id"], action="receipt", role="Accounts payable", field="Task chair", value="8").status_code == 403
    assert act(client, hold["id"], action="receipt", role="Procurement", field="Task chair", value="99").status_code == 409
    done = act(client, hold["id"], action="receipt", role="Procurement", field="Task chair", value="8").json()
    assert done["status"] == "Approved" and done["resolves"] == hold["id"]


def test_bank_callback_updates_vendor_and_duplicate_scan(client):
    hold = run(client, sample("apex-bank-change"))
    contact = "Apex supplier desk · ext 210"
    assert act(client, hold["id"], action="verify_bank", role="Accounts payable", value=contact).status_code == 403
    assert act(client, hold["id"], action="verify_bank", role="Vendor master team", value="number on the invoice").status_code == 409
    ok = act(client, hold["id"], action="verify_bank", role="Vendor master team", value=contact).json()
    assert ok["status"] == "Approved"
    apex = next(v for v in client.get("/api/dashboard").json()["vendors"] if v["name"] == "Apex Office Supply")
    assert apex["account"].endswith("7714") and apex["verified_change"] and "100000007714" not in str(apex)
    assert run(client, sample("apex-bank-scan"))["title"] == "Duplicate invoice"


def test_fixed_resend_supersedes_open_hold(client):
    hold = run(client, sample("apex-bank-change"))
    fixed = alter(sample("apex-bank-change"), [("Bank account: 100000007714", "Bank account: 100000002841")])
    resent = run(client, fixed)
    assert resent["status"] == "Approved"
    assert client.get("/api/runs/" + hold["id"]).json()["closed_by"] == resent["id"]


def po(client, number):
    return next(o for o in client.get("/api/dashboard").json()["orders"] if o["po"] == number)


def test_request_info_amend_and_reject(client):
    hold = run(client, sample("delta-overbill"))
    same = act(client, hold["id"], action="request_info", role="Accounts payable").json()
    assert same["id"] == hold["id"]
    assert client.get("/api/runs/" + hold["id"]).json()["actions"][0]["action"] == "request_info"
    amended = act(client, hold["id"], action="amend", role="Procurement", value="110").json()
    assert amended["status"] == "Approved"
    assert po(client, "PO-D")["amended"] and po(client, "PO-D")["billed"] == 55000000
    second = run(client, sample("delta-instruction"))
    assert "Embedded instructions" in {c["name"] for c in second["checks"] if c["status"] == "Hold"}
    rejected = act(client, second["id"], action="reject", role="Accounts payable").json()
    assert rejected["status"] == "Rejected"
    assert po(client, "PO-D")["billed"] == 55000000


def test_controller_waiver_cannot_clear_money_controls(client):
    hold = run(client, sample("delta-instruction"))
    assert act(client, hold["id"], action="waive", role="Finance controller", field="Cumulative order balance").status_code == 409
    waived = act(client, hold["id"], action="waive", role="Finance controller", field="Embedded instructions").json()
    statuses = {c["name"]: c["status"] for c in waived["checks"]}
    assert statuses["Embedded instructions"] == "Waived" and waived["status"] == "Hold"


def lab_pdf(c, **over):
    spec = {"vendor": "Apex Office Supply", "number": "L-1", "date": "23/11/2026", "po": "PO-A", "bank": "@record",
            "tax_mode": "Split GST", "tax_rate": 18, "lines": [{"item": "Desk lamp", "qty": 1, "rate": 2000}], **over}
    r = c.post("/api/lab", json=spec)
    assert r.status_code == 200, r.text
    return r.content


def test_lab_and_policy_preview_never_posts(client):
    assert run(client, lab_pdf(client, vendor="Apex Office Supply Pvt Ltd"))["status"] == "Approved"
    hold = run(client, lab_pdf(client, number="L-2", lines=[{"item": "Desk lamp", "qty": 1, "rate": 2080}]))
    assert hold["title"] == "Order line"
    before = client.get("/api/dashboard").json()
    body = {"price_percent": 5, "approval_limit": 500000, "age_days": 180, "allow_derived": True}
    preview = client.post("/api/policy/preview", json=body).json()["preview"]
    assert next(p for p in preview if p["id"] == hold["id"])["status"] == "Approved"
    after = client.get("/api/dashboard").json()
    assert after["orders"] == before["orders"] and after["policy"]["version"] == 1
    assert client.post("/api/policy/save", json=body).json()["version"] == 2
    bad = {"vendor": "X", "number": "1", "date": "31/31/2026", "lines": [{"item": "a", "qty": 1, "rate": 1}]}
    assert client.post("/api/lab", json=bad).status_code == 422


def test_ai_values_must_be_on_the_page():
    import reader
    import vision
    extracted = reader.read_invoice(sample("apex-table"))
    answers = {k: "" for k in vision.KEYS} | {"vendor": "Apex Office Supply", "total": "2,360.00", "subtotal": "9,999.00",
                                              "lines": [], "line_count": 1, "instructions": "", "uncertain": False}
    out = vision.verify(extracted, answers, "test reader")
    review = {a["field"]: a["verified"] for a in out["ai_review"]}
    assert review["vendor"] and review["total"] and not review["subtotal"]
    assert out["fields"].get("subtotal") != "9,999.00"


def test_claude_reader_path_is_verified(client, monkeypatch):
    import vision
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    def fake(data):
        return {k: "" for k in vision.KEYS} | {
            "vendor": "Apex Office Supply", "number": "A-104", "date": "2026-11-23", "currency": "INR", "po": "PO-A",
            "subtotal": "2,000.00", "tax": "360.00", "total": "2,360.00", "bank": "100000002841",
            "lines": [{"item": "Desk lamp", "qty": "1", "rate": "2,000.00", "line_amount": "2,000.00"}],
            "line_count": 1, "instructions": "", "uncertain": False}
    monkeypatch.setattr(vision, "ask_claude", fake)
    r = run(client, sample("apex-table"))
    assert r["status"] == "Approved" and "Claude" in r["method"]
    assert all(a["verified"] for a in r["ai_review"])


def test_reports_briefs_highlights_and_timeline(client):
    r = run(client, sample("delta-overbill"))
    assert r["brief"]["headline"] == "₹50,000 over the purchase order"
    assert "D-101" in r["brief"]["message"]["body"]
    pdf = client.get(f"/api/runs/{r['id']}/report")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    boxes = [e["bbox"] for e in r["evidence"]]
    assert all(boxes) and len({tuple(b) for b in boxes}) == len(boxes)
    names = [e["stage"] for e in r["timeline"] if e["state"] != "running"]
    assert names[:2] == ["Receive PDF", "Read document"] and names[-1] == "Decision"


def review_mail(c, slug, sender, mail_id):
    r = c.post(f"/api/review?name={slug}.pdf&sender={sender}&mail={mail_id}", content=sample(slug))
    assert r.status_code == 200, r.text
    return __import__("json").loads(r.text.splitlines()[-1])["result"]


def test_lookalike_sender_is_held_and_callback_clears_it(client):
    ok = review_mail(client, "apex-standard", "accounts@apexoffice.in", "m01")
    assert ok["status"] == "Approved" and ok["mail"]["id"] == "m01" and ok["sender"] == "accounts@apexoffice.in"
    spoof = review_mail(client, "apex-bank-change", "accounts@apex-office-supply.co", "m05")
    failing = {c["name"] for c in spoof["checks"] if c["status"] == "Hold"}
    assert {"Sender verification", "Remittance account"} <= failing
    assert spoof["title"] == "Remittance account" and "lookalike" in spoof["brief"]["explanation"]
    assert client.post("/api/review?name=x.pdf&sender=not-an-email", content=sample("apex-standard")).status_code == 422
    cleared = client.post(f"/api/runs/{spoof['id']}/action", json={"action": "verify_bank", "role": "Vendor master team",
                          "value": "Apex supplier desk · ext 210", "reason": "Callback confirmed both the sender and the account."}).json()
    assert cleared["status"] == "Approved"


def test_same_pdf_keeps_source_identity_on_legacy_and_new_mail(client):
    import app
    data = sample("apex-standard")
    original = review_mail(client, "apex-standard", "accounts@apexoffice.in", "m01")
    with app.database() as db:
        db.execute("UPDATE runs SET digest=? WHERE id=?", (app.document_digest(data), original["id"]))
    repeated = review_mail(client, "apex-standard", "accounts@apexoffice.in", "m01")
    assert repeated["id"] == original["id"] and repeated["existing"]
    forwarded = review_mail(client, "apex-standard", "billing@elsewhere.example", "")
    assert forwarded["id"] != original["id"]
    assert any(c["name"] == "Sender verification" and c["status"] == "Hold" for c in forwarded["checks"])
    uploaded = run(client, data)
    assert uploaded["id"] not in (original["id"], forwarded["id"])
    assert uploaded["title"] == "Duplicate invoice"
    assert len(client.get("/api/dashboard").json()["runs"]) == 3


def test_gemini_pdf_request_verification_and_shared_budget(client, monkeypatch):
    import io
    import json
    import base64
    import vision
    data = sample("apex-table")
    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    monkeypatch.setenv("KOSH_GEMINI_MODEL", "test-model")
    monkeypatch.setenv("KOSH_CLOUD_READS_PER_HOUR", "1")
    calls = []

    def generate(req, timeout):
        calls.append(req)
        body = json.loads(req.data)
        pdf = body["contents"][0]["parts"][0]["inlineData"]
        assert pdf["mimeType"] == "application/pdf" and base64.b64decode(pdf["data"]) == data
        assert req.get_header("X-goog-api-key") == "test-only"
        assert "test-only" not in req.full_url and req.full_url.endswith("/test-model:generateContent")
        assert body["generationConfig"]["responseJsonSchema"] == vision.SCHEMA
        proposals = {"vendor": "Apex Office Supply", "total": "9,999.00", "lines": []}
        return io.BytesIO(json.dumps({"candidates": [{"finishReason": "STOP", "content": {
            "parts": [{"text": json.dumps(proposals)}]}}]}).encode())

    monkeypatch.setattr(vision, "urlopen", generate)
    result = run(client, data)
    fields = {f["field"]: f["verified"] for f in result["ai_review"]}
    assert fields["vendor"] and not fields["total"] and result["status"] == "Hold"
    client.post("/api/new-workspace")
    capped = run(client, data)
    assert len(calls) == 1 and capped["status"] == "Hold"
    assert any(e["stage"] == "AI reader" and "limit reached" in e["detail"] for e in capped["timeline"])


def test_payment_batch_needs_two_roles_and_takes_discount(client):
    a = run(client, sample("apex-standard"))
    hold = run(client, sample("delta-overbill"))
    body = lambda action, role, ids: {"action": action, "role": role, "ids": ids}
    assert client.post("/api/payments", json=body("schedule", "Accounts payable", [hold["id"]])).status_code == 409
    assert client.post("/api/payments", json=body("schedule", "Procurement", [a["id"]])).status_code == 403
    batch = client.post("/api/payments", json=body("schedule", "Accounts payable", [a["id"]])).json()
    pay = next(p for p in client.get("/api/dashboard").json()["payments"] if p["run_id"] == a["id"])
    assert pay["status"] == "Scheduled" and pay["batch"] == batch["batch"] and pay["discount"] == 18880 and pay["amount"] == 944000 - 18880
    assert client.post("/api/payments", json=body("schedule", "Accounts payable", [a["id"]])).status_code == 409
    assert client.post("/api/payments", json=body("release", "Accounts payable", [a["id"]])).status_code == 403
    assert client.post("/api/payments", json=body("release", "Finance controller", [a["id"]])).status_code == 200
    assert next(p for p in client.get("/api/dashboard").json()["payments"] if p["run_id"] == a["id"])["status"] == "Paid"
