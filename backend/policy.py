import csv
import os
import re
from datetime import date, datetime
from decimal import Decimal

from .paths import FIXTURES


def rows(name):
    with (FIXTURES / name).open(encoding="utf-8-sig") as source:
        return list(csv.DictReader(source))


VENDORS = {r["name"]: r for r in rows("vendors.csv")}
ORDERS = {}
for r in rows("orders.csv"):
    o = ORDERS.setdefault(r["po"],dict(po=r["po"],vendor=r["vendor"],location=r["location"],support=r["support"],lines=[]))
    o["lines"].append(dict(item=r["item"],units=int(r["units"]),rate=int(r["unit_price"])*100,
                           received=int(r["received"]) if r["received"] else None,receipt=r["receipt"]))
OPENING = [dict(**{k:v for k,v in r.items() if k not in ("amount","qty")}, amount=int(r["amount"]),qty=int(r["qty"])) for r in rows("ledger_seed.csv")]
CONFIG_DEFAULT = {"banks":{},"amendments":{},"receipts":{}}
DEFAULT = {"version":1,"price_percent":0,"approval_limit":500000,"age_days":180,"allow_derived":True}
ROLES = ["Accounts payable","Procurement","Vendor master team","Finance controller"]


def identity(value):
    return re.sub(r"[\s./_-]", "", str(value or "")).casefold()


def supplier(value):
    return next((name for name,v in VENDORS.items() if identity(value) in {identity(name),*(identity(a) for a in v["aliases"].split("|"))}),None)


def amount(value):
    raw=re.sub(r"^(?:INR|Rs\.?|₹)\s*","",str(value or "").strip(),flags=re.I)
    if not re.fullmatch(r"(?:\d{1,12}|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?",raw):
        return None
    return int(Decimal(raw.replace(",",""))*100)


def rupees(paise):
    if paise is None: return "unreadable"
    whole,frac=divmod(abs(paise),100)
    digits=str(whole)
    prefix=digits[:-3]
    parts=[]
    while prefix:
        parts.insert(0,prefix[-2:]);prefix=prefix[:-2]
    return ("−" if paise<0 else "")+"₹"+",".join(parts+[digits[-3:]])+(f".{frac:02}" if frac else "")


def parsedate(raw):
    text=" ".join(str(raw or "").replace("Sept","Sep").split())
    for fmt in ("%Y-%m-%d","%d/%m/%Y","%d-%m-%Y","%d.%m.%Y","%d %b %Y","%d %B %Y","%d-%b-%Y","%d %b, %Y","%d %B, %Y","%b %d, %Y","%B %d, %Y"):
        try: return datetime.strptime(text,fmt).date()
        except ValueError: pass
    return None


def quantity(raw):
    match=re.fullmatch(r"(\d{1,8}(?:\.\d{1,4})?)(?:\s*(?:units?|pcs|each|chairs?|trips?))?",str(raw or "").strip(),re.I)
    if not match:return None
    q=Decimal(match[1])
    return int(q) if q>0 and q==int(q) else None


def effective_orders(settings):
    import copy
    orders=copy.deepcopy(ORDERS)
    for po,units in settings.get("amendments",{}).items():
        if po in orders and len(orders[po]["lines"])==1:
            orders[po]["lines"][0]["units"]=units
    # Goods receipts recorded by procurement after the original GRN, keyed by PO and normalised item.
    for po,items in settings.get("receipts",{}).items():
        for line in orders.get(po,{}).get("lines",[]):
            if identity(line["item"]) in items:
                line["received"]=items[identity(line["item"])]
    return orders



def business_date():
    """Use a declared reference date for the hosted sample workspace."""
    reference = os.environ.get("KOSH_DEMO_DATE", "")
    return date.fromisoformat(reference) if reference else date.today()
