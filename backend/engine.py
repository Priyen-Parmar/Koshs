"""Apply the workspace's purchasing policy and produce an explainable posting decision."""
import re
from collections import Counter
from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP

from .policy import VENDORS, ORDERS, OPENING, DEFAULT, amount, business_date, identity, parsedate, quantity, rupees, supplier, effective_orders

AP = "Accounts payable"
BUYER = "Procurement"
# Checks a finance controller may waive after review. Money-movement controls are never waivable.
WAIVABLE = ("Invoice date window", "Order line", "GST breakdown", "Embedded instructions")


def invoice_lines(readout):
    f = readout["fields"]
    rows = readout.get("lines") or [f]
    return [dict(item=r.get("item", ""), qty=quantity(r.get("qty")), printed_qty=r.get("qty", ""),
                 rate=amount(r.get("rate")),
                 printed_amount=amount(r.get("line_amount")) if r.get("line_amount") else None) for r in rows]


def tax_basis(f, policy):
    subtotal, tax, total = [amount(f.get(k)) for k in ("subtotal", "tax", "total")]
    parts = {k: amount(f[k]) for k in ("cgst", "sgst", "igst") if k in f}
    issues = []
    if parts:
        if None in parts.values():
            issues.append("A printed GST amount is unreadable.")
        else:
            component_sum = sum(parts.values())
            if tax is not None and abs(component_sum - tax) > 1:
                issues.append("GST components disagree with printed tax.")
            tax = component_sum
    derived = False
    inclusive = "inclus" in (f.get("inclusive", "") + " " + f.get("tax_rate", "")).lower() or (subtotal is None and f.get("tax_rate"))
    if inclusive and total is not None and (subtotal is None or subtotal == total):
        match = re.search(r"\d+(?:\.\d+)?", f.get("tax_rate", ""))
        if match and 0 < Decimal(match[0]) <= 100:
            net = int((Decimal(total) / (1 + Decimal(match[0]) / 100)).quantize(Decimal(1), rounding=ROUND_HALF_UP))
            if tax is not None and tax > 0 and abs(total - net - tax) > 1:
                issues.append("Inclusive rate conflicts with printed tax.")
            subtotal, tax, derived = net, total - net, True
            if not policy["allow_derived"]:
                issues.append("Policy requires an explicit pre-tax amount.")
    return subtotal, tax, total, parts, derived, issues


def decide(extracted, previous, selection=None, settings=None, on_check=None):
    settings = settings or {}
    policy = {**DEFAULT, **settings.get("policy", {})}
    f = extracted["fields"]
    checks = []
    waived = set(extracted.get("waived", []))

    def check(name, ok, detail, fields="", owner=AP, action="Request a corrected invoice.", priority=50):
        status = "Awaiting" if ok is None else "Passed" if ok else "Hold"
        if status == "Hold" and name in waived:
            status, detail = "Waived", detail + " Waived by the finance controller after review."
        row = dict(name=name, status=status, detail=detail, fields=fields.split(), owner=owner, action=action, priority=priority)
        checks.append(row)
        if on_check:
            on_check(row)

    lines = invoice_lines(extracted)
    net, tax, gross, parts, derived, issues = tax_basis(f, policy)
    missing = [k for k in ("vendor", "number", "date", "currency") if not f.get(k)]
    for k, v in (("subtotal", net), ("tax", tax), ("total", gross)):
        if v is None:
            missing.append(k)
    issues.extend(extracted.get("warnings", []))
    if missing:
        issues.append("Missing or unreadable " + ", ".join(missing) + ".")
    invdate = parsedate(f.get("date"))
    if f.get("date") and not invdate:
        issues.append(f"The printed date '{f['date']}' is not a recognised date format.")
    if any(not l["item"] or l["rate"] is None or not l["qty"] for l in lines):
        issues.append("Each line needs an item, a whole-unit quantity and a unit price. Check the printed quantity.")
    check("Document evidence", not issues,
          " ".join(issues) or f"All required fields located. Invoice date read as {invdate:%d %B %Y}.",
          "number date total", priority=4)
    if invdate:
        days = (business_date() - invdate).days
        check("Invoice date window", -1 <= days <= policy["age_days"],
              (f"Invoice is dated {invdate:%d %B %Y}, {-days} days in the future." if days < -1 else
               f"Invoice dated {invdate:%d %B %Y} ({days} days old); policy accepts up to {policy['age_days']} days."),
              "date", action="Confirm the invoice date with the supplier.")
    vendor = supplier(f.get("vendor"))
    master = VENDORS.get(vendor, {})
    orders = effective_orders(settings)
    candidates = [p for p, o in orders.items() if o["vendor"] == vendor]
    printed_vendor = f.get("vendor", "")
    check("Approved supplier", bool(vendor),
          (f"'{printed_vendor}' matches the approved supplier {vendor}." if vendor and identity(printed_vendor) != identity(vendor)
           else f"{vendor} is in the approved vendor register." if vendor
           else f"'{printed_vendor}' is not in the approved vendor register." if printed_vendor
           else "No supplier name was printed."),
          "vendor", action="Reject the invoice or start vendor onboarding.", priority=8)
    check("Currency", f.get("currency", "").upper() == "INR",
          f"Orders are in INR; the invoice is in {f.get('currency') or 'an unreadable currency'}.", "currency")
    sender = (extracted.get("sender") or "").strip().lower()
    if sender:
        domain = sender.rsplit("@", 1)[-1]
        registered = master.get("domain", "")
        same = bool(vendor) and domain == registered
        check("Sender verification", (same or bool(extracted.get("sender_verified"))) if vendor else None,
              (f"Sent from {sender}, which matches {vendor}'s registered domain." if same else
               f"Sent from {sender}; the confirmed sender was verified by callback." if extracted.get("sender_verified") and vendor else
               f"Sent from {sender}, but {vendor}'s registered domain is {registered}. Lookalike domains are a common invoice-fraud pattern.")
              if vendor else "Awaiting an approved supplier.",
              "", "Vendor master team", "Confirm the sender through the trusted contact in the vendor record.", 1)
    if f.get("bank"):
        account = settings.get("banks", {}).get(vendor, master.get("account", ""))
        digits = re.sub(r"[\s-]", "", f["bank"])
        check("Remittance account", digits == account if vendor else None,
              f"Invoice •••• {digits[-4:]} · vendor record •••• {account[-4:]}." if vendor else "Awaiting an approved supplier.",
              "bank", "Vendor master team",
              "Verify the printed account through the trusted contact in the vendor record.",0)
    if parts:
        place = f.get("place", "Karnataka").casefold()
        same = place == master.get("state", "").casefold()
        valid = (set(parts) == {"cgst", "sgst"} and parts["cgst"] == parts["sgst"]) if same else set(parts) == {"igst"}
        expected = "CGST + SGST in equal halves" if same else "IGST"
        check("GST breakdown", valid if vendor else None,
              f"Supplier state {master.get('state', 'unknown')}; supply in {place.title()}. Expected {expected}; printed "
              + " + ".join(k.upper() for k in parts) + ".", "cgst sgst igst place",
              action="Request an invoice with the correct GST type.")
    sums = [l["qty"] * l["rate"] for l in lines if l["qty"] and l["rate"] is not None]
    valid = len(sums) == len(lines) and None not in (net, tax, gross)
    check("Invoice arithmetic",
          (net > 0 and min(sums) > 0 and abs(sum(sums) - net) <= 1 and abs(net + tax - gross) <= 1 and
           all(l["printed_amount"] is None or abs(l["printed_amount"] - s) <= 1 for l, s in zip(lines, sums))) if valid else None,
          (f"{rupees(sum(sums))} in items · {rupees(net)} pre-tax + {rupees(tax)} tax · {rupees(gross)} gross."
           + (" Pre-tax amount derived from the printed inclusive rate." if derived else "")) if valid
          else "Awaiting legible quantities and totals.", "qty rate subtotal tax total")
    earlier = [*OPENING, *previous]
    posted = [r for r in earlier if r.get("status", "Approved") == "Approved"]
    number = f.get("number", "")
    duplicate = next((r for r in posted if r["vendor"] == vendor and identity(r["number"]) == identity(number)), None)
    check("Duplicate invoice", not duplicate if vendor and number else None,
          (f"{duplicate['number']} from {vendor} is already posted." if duplicate else
           f"No earlier posting of {number} from {vendor}.") if vendor and number
          else "Awaiting an approved supplier and invoice number.",
          "number", AP, "Inspect the earlier posting and reject a confirmed duplicate.", 2)
    if extracted.get("document_notice"):
        check("Embedded instructions", False,
              "The document contains text telling reviewers or software to approve it. Kosh ignores such text; "
              "the decision comes from the rules alone. Treat it as a fraud signal.",
              "", AP, "Review the instruction with the supplier before any posting.", 3)
    ref = (f.get("po") or selection or "").strip().upper()
    parent = None
    matching = [r for r in previous if r["vendor"] == vendor and r.get("status") == "Hold" and not r.get("closed_by")]
    if f.get("replaces"):
        parent = next((r for r in matching if identity(r["number"]) == identity(f["replaces"]) and r["po"] == ref), None)
        check("Correction reference", bool(parent),
              "Replaces open hold " + f["replaces"] + "." if parent else f"Replaces {f['replaces']}, but no open hold with that number was found.",
              "replaces", action="Upload the original invoice first or confirm the reference.")
    else:
        parent = next((r for r in matching if identity(r["number"]) == identity(number)), None)
    po = orders.get(ref)
    matches = bool(po and ref in candidates)
    if not vendor:
        po_detail = "Awaiting an approved supplier."
    elif matches:
        po_detail = f"{ref} · {po['location']} · open order for {vendor}."
    elif ref:
        po_detail = f"{ref} is not an open order for {vendor}."
    else:
        po_detail = f"No order reference printed. {vendor} has {len(candidates)} open order{'s' if len(candidates) != 1 else ''}: " + ", ".join(
            f"{p} ({orders[p]['location']})" for p in candidates) + "."
    check("Purchase order", matches if vendor else None, po_detail, "po", BUYER,
          "Confirm the purchase order using a dispatch or buyer record.", 12)
    bal = None
    if matches:
        ledger = [r for r in posted if r["po"] == ref]
        spent = sum(r["amount"] for r in ledger)
        used = Counter()
        for r in ledger:
            for l in r.get("lines") or [r]:
                used[identity(l.get("item"))] += l.get("qty") or 0
        limit = sum(l["units"] * l["rate"] for l in po["lines"])
        left = limit - spent
        order_lines = {identity(l["item"]): l for l in po["lines"]}
        requested = Counter()
        line_issues = []
        for l in lines:
            key = identity(l["item"])
            o = order_lines.get(key)
            if not o:
                line_issues.append(f"{l['item'] or 'An unnamed item'} is not on {ref}.")
            elif l["rate"] is None or abs(l["rate"] - o["rate"]) * 100 > o["rate"] * policy["price_percent"]:
                line_issues.append(f"{o['item']} ordered at {rupees(o['rate'])}; invoice {rupees(l['rate'])}.")
            requested[key] += l["qty"] or 0
        check("Order line", not line_issues,
              " ".join(line_issues) or (f"All {len(lines)} billed lines match order items and the price policy." if len(lines) != 1
                                        else f"{po['lines'][0]['item'] if len(po['lines']) == 1 else 'The billed line'} matches the order item and price policy."),
              "item qty rate", BUYER, "Confirm the item and price with the buyer or request a corrected invoice.")
        cap_issues, receipts, receipt_issues = [], [], []
        for key, n in requested.items():
            if key not in order_lines:
                continue
            o = order_lines[key]
            remaining = o["units"] - used[key]
            if n > remaining:
                cap_issues.append(f"{remaining} of {o['units']} {o['item'].lower()} units remain; this invoice bills {n}.")
            if o["received"] is not None:
                receipts.append(f"{o['receipt']}: {o['received']} {o['item'].lower()} units received, {used[key]} already billed.")
                if n + used[key] > o["received"]:
                    receipt_issues.append(f"Only {max(0, o['received'] - used[key])} received {o['item'].lower()} units are unbilled; this invoice bills {n}.")
        excess = max(0, net - left) if net is not None else None
        ready = net is not None and all(l["qty"] for l in lines) and not any(identity(l["item"]) not in order_lines for l in lines)
        detail = " ".join(cap_issues) + f" Available {rupees(left)}. This invoice {rupees(net)}." + (f" Excess {rupees(excess)}." if excess else "")
        check("Cumulative order balance", not cap_issues and not excess if ready else None,
              detail.strip() if ready else "Awaiting comparable line quantities and a pre-tax amount.",
              "item qty subtotal", BUYER, "Request a corrected invoice or record an authorised PO amendment.", 6)
        if receipts:
            check("Goods receipt", not receipt_issues if ready else None, " ".join(receipts + receipt_issues), "item qty", BUYER,
                  "Confirm the outstanding delivery or request a corrected quantity.", 7)
        bal = dict(limit=limit, spent=spent, requested=net, excess=excess, available=left,
                   ledger=[{k: r.get(k) for k in ("number", "amount", "qty", "id")} for r in ledger])
    else:
        check("Cumulative order balance", None, "Awaiting a matched purchase order.", "po", BUYER)
    if gross is not None and gross > policy["approval_limit"] * 100:
        check("Controller approval", bool(extracted.get("controller")),
              f"{rupees(gross)} exceeds the {rupees(policy['approval_limit'] * 100)} controller threshold."
              + (" Authorised by the finance controller." if extracted.get("controller") else ""),
              "total", "Finance controller", "Record controller authorisation before posting.", 10)
    holds = sorted([c for c in checks if c["status"] == "Hold"], key=lambda c: c["priority"])
    waiting = [c for c in checks if c["status"] == "Awaiting"]
    main = holds[0] if holds else (waiting[0] if waiting else {})
    due = parsedate(f.get("due"))
    if not due and invdate:
        terms = re.search(r"\b(\d{1,3})\s*days?\b", f.get("terms", ""), re.I)
        due = invdate + timedelta(days=int(terms[1]) if terms else int(master.get("terms", 30)))
    # Anything unresolved (a hold or an awaited prerequisite) prevents posting.
    blocked = bool(holds or waiting)
    return dict(status="Hold" if blocked else "Approved", title=main.get("name", "Cleared for posting"),
                summary=main.get("detail", f"{rupees(net)} cleared against {ref}."),
                owner=main.get("owner", AP), action=main.get("action", "Posted to the purchase order ledger."),
                checks=checks, balance=bal, candidates=candidates if not ref else [],
                vendor=vendor or f.get("vendor", "Unknown supplier"), number=number or "Unnumbered",
                item=lines[0]["item"], po=ref, lines=lines, qty=sum(l["qty"] or 0 for l in lines),
                amount=net or 0, gross=gross, tax=tax, parent=parent["id"] if parent else None,
                due=due.isoformat() if due else None, notice=extracted.get("document_notice", False),
                date=invdate.isoformat() if invdate else None,
                sender=extracted.get("sender"), mail=extracted.get("mail"))
