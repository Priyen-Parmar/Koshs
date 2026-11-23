"""Plain-English explanations and drafted follow-up messages, written only from rule results.

Nothing here decides anything. Each sentence restates facts the engine already computed, so the
explanation can never disagree with the decision.
"""
from datetime import date

from policy import ORDERS, VENDORS, rupees


def _failed(result, name):
    return next((c for c in result.get("checks", []) if c["name"] == name and c["status"] == "Hold"), None)


def _tail(check, n):
    """Last four digits from 'Invoice •••• 7714 · vendor record •••• 2841.'"""
    import re
    found = re.findall(r"(\d{4})", (check or {}).get("detail", ""))
    return found[n] if len(found) > n else "····"


def _message(to, subject, body):
    return {"to": to, "subject": subject, "body": body.strip()}


def brief(result):
    """Return {headline, explanation, tone, message} for a stored decision."""
    status = result.get("status")
    vendor = result.get("vendor") or "the supplier"
    number = result.get("number") or "this invoice"
    po = result.get("po") or ""
    master = VENDORS.get(vendor, {})
    balance = result.get("balance") or {}
    title = result.get("title", "")
    sign = "\n\nRegards,\nAccounts payable · Nimbus Retail"

    if status == "Error":
        return dict(tone="error", headline="This document couldn't be read",
                    explanation=result.get("action") or "The PDF could not be opened.",
                    message=_message(f"{vendor} accounts team", "Invoice could not be processed",
                                     "Hello,\n\nWe could not read the invoice PDF you sent. Please send an unlocked, legible "
                                     "PDF copy so we can review it." + sign))
    if status == "Rejected":
        return dict(tone="error", headline=f"Rejected by {result.get('owner', 'a reviewer')}",
                    explanation=result.get("summary") or "A reviewer rejected this invoice.",
                    message=_message(f"{vendor} accounts team", f"Invoice {number} rejected",
                                     f"Hello,\n\nWe are unable to process invoice {number}. Reason: "
                                     f"{result.get('summary') or 'see attached'}\n\nPlease contact us if you believe this is in error." + sign))
    if status == "Approved":
        left = (balance.get("available") or 0) - (result.get("amount") or 0)
        due = result.get("due")
        return dict(tone="ok", headline=f"Cleared for posting against {po}",
                    explanation=f"{rupees(result.get('amount'))} pre-tax ({rupees(result.get('gross'))} with tax) is posted to {po}. "
                                + (f"{rupees(left)} of the order remains. " if balance else "")
                                + (f"Payment due {date.fromisoformat(due):%d %b %Y}." if due else ""),
                    message=None)

    # Hold: explain the primary reason in business terms.
    if title == "Remittance account" and _failed(result, title):
        c = _failed(result, "Remittance account")
        contact = master.get("contact", "the contact on file")
        spoof = _failed(result, "Sender verification")
        also = (f" It also arrived from {result.get('sender')}, not {vendor}'s registered domain {master.get('domain')}: "
                "a lookalike sender plus a new bank account is the classic invoice-fraud pattern." if spoof else "")
        return dict(tone="risk", headline="Bank account differs from the vendor record",
                    explanation=f"The invoice asks for payment to an account ending {_tail(c, 0)}, but {vendor}'s verified account ends {_tail(c, 1)}. "
                                f"Changed bank details are the most common invoice-fraud pattern, so "
                                f"Kosh won't post this until the vendor master team confirms the change by calling {contact}, "
                                "never a number printed on the invoice or the email." + also,
                    message=_message("Vendor master team", f"Verify new bank account for {vendor} ({number})",
                                     f"Hi team,\n\nInvoice {number} from {vendor} asks for payment to a different account than the one "
                                     f"in our vendor record ({c['detail'] if c else ''}).\n\nPlease call {contact} using the details already "
                                     "on file (not any contact printed on the invoice) and confirm whether the change is genuine. "
                                     "Record the call in Kosh so the invoice can be rechecked." + sign))
    if title == "Cumulative order balance" and _failed(result, title):
        excess = balance.get("excess") or 0
        c = _failed(result, "Cumulative order balance")
        return dict(tone="warn", headline=f"{rupees(excess)} over the purchase order" if excess else "Billed quantity exceeds the order",
                    explanation=f"{vendor} has already billed {rupees(balance.get('spent'))} of the {rupees(balance.get('limit'))} "
                                f"authorised on {po}. This invoice asks for {rupees(balance.get('requested'))}"
                                + (f", so {rupees(excess)} goes beyond the order. " if excess else ". ")
                                + (c["detail"].split(' Available')[0] if c else ""),
                    message=_message(f"{vendor} accounts team", f"Invoice {number} exceeds {po}",
                                     f"Hello,\n\nInvoice {number} bills {rupees(balance.get('requested'))} against {po}, but only "
                                     f"{rupees(balance.get('available'))} remains on the order after earlier invoices"
                                     + (f" ({', '.join(l['number'] for l in balance.get('ledger', []))})" if balance.get('ledger') else "")
                                     + ".\n\nPlease send a corrected invoice for the remaining balance, or let us know if our "
                                     "procurement team agreed an amendment to the order." + sign))
    if title == "Sender verification" and _failed(result, title):
        return dict(tone="risk", headline="Sent from an unregistered email domain",
                    explanation=_failed(result, title)["detail"] + " Kosh holds it until the vendor master team confirms with the "
                                f"supplier through {master.get('contact', 'the contact on file')}.",
                    message=_message("Vendor master team", f"Confirm sender of {vendor} invoice {number}",
                                     f"Hi team,\n\nInvoice {number} arrived from {result.get('sender')}, which is not {vendor}'s registered "
                                     f"domain ({master.get('domain')}). Please confirm with the supplier via {master.get('contact', 'the contact on file')} "
                                     "before we process it." + sign))
    if title == "Purchase order":
        cands = result.get("candidates") or []
        options = ", ".join(f"{p} ({ORDERS[p]['location']})" for p in cands if p in ORDERS)
        return dict(tone="warn", headline="Which purchase order is this for?" if cands else "No matching purchase order",
                    explanation=(f"The invoice doesn't name an order, and {vendor} has {len(cands)} open orders with the same terms: "
                                 f"{options}. Procurement needs to confirm which one received the goods." if cands
                                 else (_failed(result, 'Purchase order') or {}).get("detail", "")),
                    message=_message("Procurement", f"Confirm the PO for {vendor} invoice {number}",
                                     f"Hi,\n\nInvoice {number} from {vendor} ({rupees(result.get('gross'))}) has no order reference. "
                                     + (f"Open orders: {options}. " if options else "")
                                     + "Can you confirm which order this belongs to, ideally with the dispatch or receiving record?" + sign))
    if title == "Goods receipt" and _failed(result, title):
        c = _failed(result, "Goods receipt")
        return dict(tone="warn", headline="Billed for more than was received",
                    explanation=(c["detail"] if c else "") + " Paying for goods that haven't arrived is a common leak; "
                                "Kosh waits for the receipt to catch up or for a corrected invoice.",
                    message=_message("Procurement / receiving", f"Receipt shortfall on {po} ({number})",
                                     f"Hi,\n\nInvoice {number} from {vendor} bills more units than we have recorded as received on {po}. "
                                     f"{c['detail'] if c else ''}\n\nHas the rest been delivered? If so, please record the goods receipt; "
                                     "otherwise we will ask the supplier for a corrected invoice." + sign))
    if title == "Duplicate invoice":
        return dict(tone="risk", headline="This invoice is already posted",
                    explanation=f"{vendor} invoice {number} matches an earlier posting. Paying it again would be a duplicate payment.",
                    message=_message(f"{vendor} accounts team", f"Invoice {number} already received",
                                     f"Hello,\n\nWe already processed invoice {number}. If this is a new bill, please issue it with a new "
                                     "invoice number." + sign))
    if title == "Embedded instructions":
        return dict(tone="risk", headline="The document tries to instruct the reviewer",
                    explanation="Text on the invoice asks for it to be approved without review. Kosh's decision comes only from the "
                                "rules, so this text has no effect, but an invoice that asks to skip controls is a fraud signal.",
                    message=_message("Accounts payable lead", f"Suspicious instruction on {vendor} invoice {number}",
                                     f"Hi,\n\nInvoice {number} from {vendor} contains printed text asking us to approve it without review. "
                                     "Please confirm with the supplier through the contact on file before any posting." + sign))
    c = next((c for c in result.get("checks", []) if c["name"] == title), None) or {}
    headlines = {
        "Document evidence": "Some required details couldn't be read",
        "Approved supplier": "Supplier isn't in the approved register",
        "Currency": "Invoice currency doesn't match the order",
        "GST breakdown": "GST type doesn't match the place of supply",
        "Invoice arithmetic": "The invoice's numbers don't add up",
        "Order line": "Item or price doesn't match the order",
        "Invoice date window": "Invoice date is outside policy",
        "Controller approval": "Needs finance controller approval",
        "Correction reference": "Correction doesn't match an open invoice",
    }
    internal = title in ("Controller approval",)
    return dict(tone="warn", headline=headlines.get(title, title or "On hold"), explanation=c.get("detail", result.get("summary", "")),
                message=_message(c.get("owner", "Accounts payable") if internal else f"{vendor} accounts team",
                                 f"Invoice {number}: {headlines.get(title, title).lower()}",
                                 (f"Hi,\n\nInvoice {number} from {vendor} ({rupees(result.get('gross'))}) needs your authorisation. "
                                  f"{c.get('detail', '')}" if internal else
                                  f"Hello,\n\nWe could not process invoice {number}. {c.get('detail', '')}\n\n"
                                  "Please send a corrected invoice.") + sign))
