"""Regression tests for the decisions that change a purchase order balance."""

import json
from concurrent.futures import ThreadPoolExecutor

import pymupdf
import pytest
from fastapi.testclient import TestClient

import app as service


@pytest.fixture
def client(tmp_path, monkeypatch):
    dbfile = tmp_path / "test.sqlite"
    monkeypatch.setattr(service, "DB", dbfile)
    monkeypatch.setattr("vision.MODEL", "")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("KOSH_DEMO_DATE", "2026-11-23")
    service.initialize_database()
    with TestClient(service.app) as c:
        c.get("/api/dashboard")
        yield c


def sample(name):
    return (service.ROOT / "samples" / (name + ".pdf")).read_bytes()


def run(c, data):
    r = c.post("/api/review?name=arbitrary-name.pdf", content=data)
    assert r.status_code == 200
    return json.loads(r.text.splitlines()[-1])["result"]


def test_reconcile_and_correct(client):
    a = run(client, sample("apex-standard"))
    assert (a["status"], a["gross"], a["amount"]) == ("Approved", 944000, 800000)
    hold = run(client, sample("delta-overbill"))
    assert hold["status"] == "Hold" and hold["balance"]["excess"] == 5000000
    correction = run(client, sample("delta-corrected"))
    assert correction["status"] == "Approved" and correction["resolves"] == hold["id"]
    assert client.get("/api/runs/" + hold["id"]).json()["closed_by"] == correction["id"]
    rerun = run(client, sample("delta-corrected"))
    assert rerun["id"] == correction["id"]
    orders = client.get("/api/dashboard").json()["orders"]
    assert next(o for o in orders if o["po"] == "PO-D")["billed"] == 50000000


def test_bank_and_buyer_confirmation(client):
    assert run(client, sample("apex-bank-change"))["title"] == "Remittance account"
    r = run(client, sample("kaveri-freight"))
    assert r["candidates"] == ["PO-E", "PO-W"]
    api = "/api/runs/" + r["id"] + "/resolve"
    assert (
        client.post(api, json={"po": "PO-D", "reason": "Dispatch DN-301"}).status_code
        == 409
    )
    body = {"po": "PO-E", "reason": "Dispatch DN-301 confirms East depot."}
    resolved = client.post(api, json=body).json()
    assert resolved["status"] == "Approved" and resolved["resolves"] == r["id"]
    assert client.post(api, json=body).json()["id"] == resolved["id"]
    with TestClient(service.app) as other:
        assert other.get("/api/runs/" + r["id"]).status_code == 404
        assert other.get("/api/dashboard").json()["runs"] == []


def test_early_correction_can_be_reconsidered(client):
    early = run(client, sample("delta-corrected"))
    assert early["status"] == "Hold"
    hold = run(client, sample("delta-overbill"))
    posted = run(client, sample("delta-corrected"))
    assert posted["status"] == "Approved" and posted["resolves"] == hold["id"]
    assert client.get("/api/runs/" + early["id"]).json()["closed_by"] == posted["id"]


def alter(pdf, changes):
    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        for src, dst in changes:
            rects = doc[0].search_for(src)
            assert rects, src
            for rect in rects:
                doc[0].add_redact_annot(rect)
            doc[0].apply_redactions()
            if dst:
                for rect in rects:
                    doc[0].insert_text((rect.x0, rect.y1 - 2), dst, fontsize=9)
        return doc.tobytes()


def test_missing_total_and_bad_file(client):
    with pymupdf.open() as d:
        d.new_page().insert_text((40, 60), "Invoice number: X-42")
        result = run(client, d.tobytes())
    assert result["status"] == "Hold" and "total" in result["checks"][0]["detail"]
    assert client.post("/api/review", content=b"random").status_code == 422
    assert run(client, b"%PDF- broken file")["status"] == "Error"


def test_duplicate_and_concurrent_consumption(client):
    pdf = sample("apex-standard")
    blobs = [
        alter(pdf, [("Invoice number: A-101", "Invoice number: A-10" + str(i))])
        for i in (4, 5, 6)
    ]
    with ThreadPoolExecutor(3) as pool:
        statuses = list(pool.map(lambda b: run(client, b)["status"], blobs))
    assert sorted(statuses) == ["Approved", "Approved", "Hold"]
    variant = alter(
        blobs[statuses.index("Approved")],
        [("Terms: 30 days from invoice date", "Terms: 31 days")],
    )
    duplicate = run(client, variant)
    assert any(
        c["name"] == "Duplicate invoice" and c["status"] == "Hold"
        for c in duplicate["checks"]
    )


def test_confirming_po_keeps_bank_hold(client):
    raw = alter(
        sample("kaveri-freight"),
        [("Bank account: 100000003115", "Bank account: 100000007714")],
    )
    r = run(client, raw)
    decision = client.post(
        "/api/runs/" + r["id"] + "/resolve",
        json={"po": "PO-E", "reason": "Confirmed by dispatch"},
    ).json()
    assert decision["status"] == "Hold" and decision["title"] == "Remittance account"


def test_scan(client):
    r = run(client, sample("apex-bank-scan"))
    assert r["method"] == "OCR" and r["title"] == "Remittance account"
