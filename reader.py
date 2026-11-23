"""Local PDF and OCR extraction with page provenance."""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from threading import RLock

import pymupdf

PDF_LOCK = RLock()
LABELS = {
    "vendor":r"Vendor(?: name)?|Supplier(?: name)?|Seller","number":r"(?:Invoice|Bill)\s*(?:number|no\.?|#|ID)",
    "date":r"(?:Invoice |Bill )?Date","currency":r"Currency","po":r"(?:Purchase order|P\.?O\.?)\s*(?:reference|number|no\.?|#)?",
    "item":r"Item(?: description)?|Description|Service","qty":r"Quantity|Qty","rate":r"Unit price(?: \(ex.tax\))?|Unit rate|Rate",
    "subtotal":r"Sub[\s-]?total|Taxable (?:amount|value)","tax":r"(?:Total )?Tax(?: amount)?|GST",
    "total":r"Grand total|Invoice total|Total(?: due)?|Amount due","bank":r"Bank account(?: number)?|Account (?:number|no\.?)",
    "replaces":r"Replaces|Revised invoice for","cgst":r"CGST","sgst":r"SGST|UTGST","igst":r"IGST","tax_rate":r"(?:GST|Tax) rate",
    "place":r"Place of supply","terms":r"Terms|Payment terms","due":r"Due date","gstin":r"(?:Vendor |Supplier )?GSTIN",
    "inclusive":r"Tax basis|Price basis|Tax treatment","line_amount":r"Line (?:amount|total)"
}
PATTERNS={k:re.compile(r"^(?:"+v+r")\s*[:：]\s*(.+)$",re.I) for k,v in LABELS.items()}


def norm(s):return " ".join(s.casefold().split())


def locate(words,value,label="",occurrence=0):
    target=norm(value)
    hits=[]
    for i in range(len(words)):
        buf=""
        for word in words[i:i+min(30,len(value.split())+3)]:
            buf=(buf+" "+norm(word["text"])).strip()
            if buf==target:
                j=i+len(buf.split())-1
                subset=words[i:max(i,j)+1]
                hits.append((norm(" ".join(w["text"] for w in words[max(0,i-4):i])),[
                    min(w["bbox"][0] for w in subset),min(w["bbox"][1] for w in subset),
                    max(w["bbox"][2] for w in subset),max(w["bbox"][3] for w in subset)]))
                break
            if not target.startswith(buf):break
    exact=[b for prev,b in hits if label and prev.endswith(norm(label))]
    matches=exact or [b for _,b in hits]
    return matches[min(occurrence,len(matches)-1)] if matches else None


def scan_page(png):
    with tempfile.TemporaryDirectory() as td:
        picture=Path(td)/"invoice.png";picture.write_bytes(png)
        if sys.platform=="win32":
            cmd=["powershell.exe","-NoProfile","-NonInteractive","-ExecutionPolicy","RemoteSigned","-File",str(Path(__file__).with_name("windows_ocr.ps1")),str(picture)]
            proc=subprocess.run(cmd,capture_output=True,timeout=40,creationflags=subprocess.CREATE_NO_WINDOW)
            if proc.returncode:raise ValueError("OCR could not read this scan. Upload a clearer copy.")
            rows=json.loads(proc.stdout.decode("utf-8-sig"))
            return "\n".join(r["text"] for r in rows),[w for r in rows for w in r["words"]]
        # Run OCR in a separate process so a scan cannot block PDF previews.
        import csv,io
        try:
            result=subprocess.run(["tesseract",str(picture),"stdout","-l","eng","tsv"],capture_output=True,timeout=40,check=True)
        except (FileNotFoundError,subprocess.SubprocessError) as exc:
            raise ValueError("English OCR could not start. Upload a searchable PDF.") from exc
        rows=list(csv.DictReader(io.StringIO(result.stdout.decode()),delimiter="\t"))
        width,height=int(rows[0]["width"]),int(rows[0]["height"])
        lines={};words=[]
        for r in rows:
            if not r["text"].strip():continue
            x,y,w,h=[int(r[k]) for k in ("left","top","width","height")]
            words.append({"text":r["text"],"bbox":[x/width,y/height,(x+w)/width,(y+h)/height]})
            lines.setdefault(tuple(r[k] for k in ("block_num","par_num","line_num")),[]).append(r["text"])
        return "\n".join(" ".join(v) for v in lines.values()),words


def read_invoice(data,progress=None):
    fields,evidence,warnings,methods,lines,pages={ },[],[],set(),[],[]
    with PDF_LOCK,pymupdf.open(stream=data,filetype="pdf") as doc:
        if doc.needs_pass:raise ValueError("This PDF is password-protected. Ask for an unlocked copy.")
        count=len(doc)
        if not 1<=count<=8:raise ValueError("Upload an invoice with one to eight pages.")
    for i in range(count):
        with PDF_LOCK,pymupdf.open(stream=data,filetype="pdf") as doc:
            page=doc[i];w,h=page.rect.width,page.rect.height
            if max(w,h)>2400 or min(w,h)<10:raise ValueError("Use standard invoice page dimensions.")
            raw=page.get_text(sort=True)
            words=[{"text":a[4],"bbox":[a[0]/w,a[1]/h,a[2]/w,a[3]/h]} for a in page.get_text("words",sort=True)]
            scan=len(raw.strip())<24
            if scan:
                scale=min(2.5,2300/max(w,h))
                png=page.get_pixmap(matrix=pymupdf.Matrix(scale,scale),alpha=False).tobytes("png")
        origin="OCR" if scan else "PDF text"
        if progress:progress(f"{origin} · page {i+1} of {count}")
        if scan:raw,words=scan_page(png)
        if len(raw)>120000:raise ValueError("This page is too dense for the invoice reader.")
        methods.add(origin);pages.append({"text":raw,"words":words,"method":origin})
        for row in raw.splitlines():
            for cell in re.split(r"\s{3,}(?=\S)",row.strip()):
                for key,pattern in PATTERNS.items():
                    m=pattern.match(cell.strip())
                    if not m:continue
                    val=m[1].strip()
                    if key in ("item","qty","rate","line_amount"):
                        if key=="item" or not lines:lines.append({})
                        if key in lines[-1]:warnings.append(f"Conflicting {key} on an item.")
                        lines[-1][key]=val
                    elif fields.get(key) and fields[key]!=val:
                        warnings.append(f"Conflicting printed {key} values.")
                    fields[key]=val
                    evidence.append({"field":key,"value":val if key!="bank" else "•••• "+val[-4:],"page":i+1,"source":origin,
                                     "bbox":locate(words,val,cell[:m.start(1)].strip(),sum(x["field"]==key and x["value"]==val for x in evidence))})
                    break
    return dict(fields=fields,evidence=evidence,pages=count,warnings=sorted(set(warnings)),method=" + ".join(sorted(methods)),
                lines=lines,page_text=pages,document_notice=any(re.search(r"(?:ignore (?:all |previous )?instructions|mark (?:this |it )?approved|approve this invoice)",p["text"],re.I) for p in pages))

