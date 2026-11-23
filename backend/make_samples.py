"""Regenerate the synthetic source documents used by Kosh, including a real scan."""

from dataclasses import dataclass

import pymupdf as pdf

from .paths import SAMPLES


INK = (0.10, 0.15, 0.20)
MUTED = (0.27, 0.33, 0.37)
LINE = (0.80, 0.84, 0.85)
PAPER = (0.94, 0.96, 0.97)
WHITE = (1, 1, 1)


@dataclass(frozen=True)
class Invoice:
    file: str
    vendor: str
    number: str
    po: str
    item: str
    qty: int
    price: int
    bank: str
    replaces: str = ""


INVOICES = (
    Invoice("apex-standard", "Apex Office Supply", "A-101", "PO-A", "Desk lamp", 4, 2000, "100000002841"),
    Invoice("delta-overbill", "Delta Furniture", "D-103", "PO-D", "Task chair", 30, 5000, "100000006012"),
    Invoice("delta-corrected", "Delta Furniture", "D-103-R1", "PO-D", "Task chair", 20, 5000, "100000006012", "D-103"),
    Invoice("apex-bank-change", "Apex Office Supply", "A-102", "PO-A", "Desk lamp", 2, 2000, "100000007714"),
    Invoice("kaveri-freight", "Kaveri Logistics", "K-301", "", "Freight trip", 1, 6000, "100000003115"),
)


def write(page, x, y, words, size=13, font="helv", color=INK):
    page.insert_text((x, y), words, fontsize=size, fontname=font, color=color)


def rule(page, y):
    page.draw_line((46, y), (549, y), color=LINE, width=0.7)


def footer(page, ref):
    rule(page, 785)
    write(page, 46, 805, "Synthetic document for the Kosh demonstration.", 10, color=MUTED)
    write(page, 440, 805, ref + "  /  1", 10, color=MUTED)


def save(doc, name):
    target = SAMPLES / (name + ".pdf")
    target.write_bytes(doc.tobytes(garbage=4, deflate=True, no_new_id=True))


def invoice_document(inv):
    paper = pdf.open()
    page = paper.new_page(width=595, height=842)
    delta = inv.vendor == "Delta Furniture"
    color = (0.06, 0.28, 0.30) if delta else (0.12, 0.20, 0.40)
    if inv.vendor == "Kaveri Logistics":
        color = (0.33, 0.20, 0.35)

    if delta:
        page.draw_rect((0, 0, 595, 150), color=None, fill=color)
        write(page, 46, 48, inv.vendor, 17, "hebo", WHITE)
        write(page, 46, 106, "Corrected invoice" if inv.replaces else "Invoice", 40, "tiro", WHITE)
        write(page, 46, 133, "Commercial furniture  /  Bengaluru", 11, color=WHITE)
    else:
        page.draw_rect((46, 35, 53, 89), color=None, fill=color)
        write(page, 66, 64, inv.vendor, 25, "hebo", color)
        write(page, 66, 86, "Bengaluru, Karnataka", 12, color=MUTED)
        write(page, 46, 145, "Freight invoice" if not inv.po else "Invoice", 35, "tiro", color)

    write(page, 46, 188, f"Invoice number: {inv.number}", 18, "hebo")
    header_lines = [
        "Date: 2026-11-23",
        f"Vendor: {inv.vendor}",
        "Bill to: Nimbus Retail Pvt Ltd",
        "Currency: INR",
    ]
    if inv.po:
        header_lines.append(f"Purchase order: {inv.po}")
    if inv.replaces:
        header_lines.append(f"Replaces: {inv.replaces}")
    for n, line in enumerate(header_lines):
        write(page, 46, 220 + n * 18, line)

    page.draw_rect((46, 338, 549, 372), color=None, fill=PAPER)
    write(page, 58, 360, "Goods supplied" if inv.po else "Services supplied", 14, "hebo", color)
    write(page, 58, 405, f"Item: {inv.item}", 15, "hebo")
    write(page, 58, 431, f"Quantity: {inv.qty}")
    write(page, 58, 453, f"Unit price: {inv.price:,.2f}")
    rule(page, 475)

    subtotal = inv.qty * inv.price
    tax = subtotal * 18 // 100
    billing_x = 58 if delta else 310
    write(page, billing_x, 506, f"Subtotal: {subtotal:,.2f}")
    write(page, billing_x, 530, f"Tax: {tax:,.2f}")
    write(page, billing_x, 568, f"Total: {subtotal + tax:,.2f}", 20, "hebo", color)
    rule(page, 594)

    write(page, 46, 632, "Remittance details", 16, "hebo", color)
    write(page, 46, 660, f"Bank account: {inv.bank}")
    write(page, 46, 685, "Terms: 30 days from invoice date", 11, color=MUTED)
    footer(page, inv.number)
    paper.set_metadata({"title": f"{inv.vendor} | {inv.number}", "author": inv.vendor})
    return paper


def dispatch_note():
    with pdf.open() as doc:
        page = doc.new_page(width=595, height=842)
        plum = (0.33, 0.20, 0.35)
        write(page, 46, 70, "Nimbus Retail", 25, "hebo", plum)
        write(page, 46, 99, "Receiving desk  /  East depot", 13, color=MUTED)
        rule(page, 129)
        write(page, 46, 201, "Dispatch note", 39, "tiro")
        for n, line in enumerate((
            "Dispatch reference: DN-301",
            "Service date: 2026-11-22",
            "Carrier: Kaveri Logistics",
            "Depot: East",
            "Purchase order: PO-E",
            "Carrier invoice reference: K-301",
        )):
            write(page, 46, 260 + n * 33, line, 15)
        rule(page, 491)
        write(page, 46, 532, "Receiving record", 17, "hebo", plum)
        write(page, 46, 565, "One freight trip was received at the East depot.")
        write(page, 46, 592, "Recorded by: Meera Rao, depot coordinator")
        footer(page, "DN-301")
        save(doc, "kaveri-dispatch")


def table_invoice():
    """A conventional column-based invoice for testing general document readers."""
    with pdf.open() as doc:
        page = doc.new_page(width=595, height=842)
        blue = (0.12, 0.20, 0.40)
        write(page, 46, 68, "Apex Office Supply", 27, "hebo", blue)
        write(page, 46, 92, "Bengaluru, Karnataka", 12, color=MUTED)
        rule(page, 122)
        write(page, 46, 181, "Invoice", 38, "tiro", blue)
        write(page, 350, 162, "Invoice number: A-104", 14, "hebo")
        write(page, 350, 186, "Date: 2026-11-23", 12)
        write(page, 46, 241, "Bill to", 12, "hebo", MUTED)
        write(page, 46, 267, "Nimbus Retail Pvt Ltd", 16)
        write(page, 350, 241, "Purchase order: PO-A", 13)
        write(page, 350, 267, "Currency: INR", 13)

        columns = ((56, "Description"), (261, "Quantity"), (346, "Unit price"), (455, "Line amount"))
        page.draw_rect((46, 314, 549, 352), color=None, fill=blue)
        for x, label in columns:
            write(page, x, 339, label, 12, "hebo", WHITE)
        for (x, _), value in zip(columns, ("Desk lamp", "1", "2,000.00", "2,000.00")):
            write(page, x, 384, value, 13)
        rule(page, 409)
        for y, label, value in ((450, "Subtotal", "2,000.00"), (480, "Tax", "360.00"),
                                (525, "Total", "2,360.00")):
            emphasis = label == "Total"
            font, size = ("hebo", 18) if emphasis else ("helv", 13)
            write(page, 310, y, label, size, font, blue)
            width = pdf.get_text_length(value, fontname=font, fontsize=size)
            write(page, 539 - width, y, value, size, font, blue)
        rule(page, 561)
        write(page, 46, 614, "Remittance details", 16, "hebo", blue)
        write(page, 46, 642, "Bank account: 100000002841", 13)
        write(page, 46, 666, "Terms: 30 days from invoice date", 11, color=MUTED)
        footer(page, "A-104")
        doc.set_metadata({"title": "Apex Office Supply | A-104", "author": "Apex Office Supply"})
        save(doc, "apex-table")


def main():
    SAMPLES.mkdir(parents=True, exist_ok=True)
    for inv in INVOICES:
        with invoice_document(inv) as doc:
            save(doc, inv.file)
            if inv.file == "apex-bank-change":
                with pdf.open() as scan:
                    page = scan.new_page(width=595, height=842)
                    pixmap = doc[0].get_pixmap(dpi=200, colorspace=pdf.csGRAY)
                    page.insert_image(page.rect, stream=pixmap.tobytes("png"))
                    save(scan, "apex-bank-scan")
    dispatch_note()
    table_invoice()


if __name__ == "__main__":
    main()
