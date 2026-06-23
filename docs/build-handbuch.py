#!/usr/bin/env python3
"""
Erzeugt das gebrandete Gesamt-Handbuch (PDF) aus INSTALL.md + BEDIENUNGSANLEITUNG.md.

Voraussetzungen: Python-Pakete `markdown`, `reportlab`, `pypdf` und Google Chrome.
  python3 -m venv .venv && .venv/bin/pip install markdown reportlab pypdf
Aufruf:
  .venv/bin/python docs/build-handbuch.py
Ergebnis: docs/RAG-Wissensdatenbank-Handbuch-V<Version>.pdf

Version wird aus backend/version.py gelesen; Stand-Datum aus den Doku-Köpfen.
"""
import base64, re, subprocess, sys, tempfile, pathlib, datetime, markdown
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import Color
import io

REPO = pathlib.Path(__file__).resolve().parent.parent
LOGO = pathlib.Path("/Users/mgehring/Documents/Tech-IT Vault/referenz/Logo neu.png")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Version aus version.py
ver_ns = {}
exec((REPO / "backend" / "version.py").read_text(), ver_ns)
VERSION = ver_ns["__version__"]
_MON = ["", "Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
        "August", "September", "Oktober", "November", "Dezember"]
_t = datetime.date.today()
STAND = f"{_t.day}. {_MON[_t.month]} {_t.year}"
OUT = REPO / "docs" / f"RAG-Wissensdatenbank-Handbuch-V{VERSION}.pdf"

logo_tag = ""
if LOGO.exists():
    logo_tag = f'<img src="data:image/png;base64,{base64.b64encode(LOGO.read_bytes()).decode()}" alt="Tech-IT Consulting">'

combined = (REPO / "INSTALL.md").read_text() + "\n\n" + (REPO / "BEDIENUNGSANLEITUNG.md").read_text()
md = markdown.Markdown(extensions=["tables", "fenced_code", "toc"])
body = md.convert(combined)

toc = "\n".join(
    f'<div class="toc-h{lvl}"><a href="#{hid}">{re.sub(chr(60)+"[^>]+"+chr(62), "", txt).strip()}</a></div>'
    for lvl, hid, txt in re.findall(r'<h([12]) id="([^"]+)">(.*?)</h\1>', body, re.S)
)

CSS = """:root{--primary:#4f46e5;--primary-d:#4338ca;--text:#1e1b4b;--muted:#6b7280;--border:#e4e4f7;--soft:#f5f3ff;}
*{box-sizing:border-box;}@page{size:A4;margin:20mm 18mm 22mm 18mm;}html,body{margin:0;padding:0;}
body{font-family:'Outfit','Segoe UI',system-ui,-apple-system,sans-serif;color:var(--text);font-size:11pt;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.cover{height:235mm;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;page-break-after:always;}
.cover img{height:150px;width:auto;margin-bottom:34px;}.cover .accent{width:64px;height:6px;background:var(--primary);border-radius:3px;margin-bottom:26px;}
.cover h1{font-size:34pt;font-weight:700;margin:0 0 8px;color:var(--text);letter-spacing:-.5px;}
.cover .sub{font-size:15pt;color:var(--muted);font-weight:400;margin-bottom:30px;}
.badge{display:inline-block;background:var(--primary);color:#fff;font-weight:600;font-size:13pt;padding:6px 16px;border-radius:8px;}
.cover .meta{margin-top:40px;font-size:11pt;color:var(--muted);}.cover .meta b{color:var(--text);}
.toc{page-break-after:always;}.toc h2{font-size:18pt;color:var(--primary);border-bottom:2px solid var(--border);padding-bottom:8px;margin:0 0 18px;}
.toc a{color:var(--text);text-decoration:none;}.toc-h1{font-weight:600;font-size:12.5pt;margin:14px 0 4px;}.toc-h2{font-size:10.5pt;color:#4b5563;margin:3px 0 3px 18px;}
.content h1{font-size:21pt;color:var(--primary);border-bottom:2px solid var(--border);padding-bottom:8px;margin:0 0 6px;page-break-before:always;page-break-after:avoid;}
.content h2{font-size:15pt;color:var(--text);margin:22px 0 6px;page-break-after:avoid;border-left:4px solid var(--primary);padding-left:10px;}
.content h3{font-size:12.5pt;color:var(--primary-d);margin:16px 0 4px;page-break-after:avoid;}
.content p{margin:6px 0;}.content ul,.content ol{margin:6px 0;padding-left:22px;}.content li{margin:3px 0;}.content a{color:var(--primary-d);}
code{font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:9.5pt;background:var(--soft);border:1px solid var(--border);border-radius:4px;padding:1px 5px;}
pre{background:var(--soft);border:1px solid var(--border);border-radius:8px;padding:12px 14px;overflow:hidden;page-break-inside:avoid;}
pre code{background:none;border:none;padding:0;font-size:9pt;white-space:pre-wrap;word-break:break-word;}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:10pt;page-break-inside:avoid;}
th,td{border:1px solid var(--border);padding:6px 9px;text-align:left;vertical-align:top;}th{background:var(--soft);font-weight:600;}
blockquote{margin:10px 0;padding:8px 14px;background:var(--soft);border-left:4px solid var(--primary);border-radius:0 6px 6px 0;color:#3f3a6b;}
hr{border:none;border-top:1px solid var(--border);margin:18px 0;}"""

html = f"""<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>{CSS}</style></head><body>
<div class="cover">{logo_tag}<div class="accent"></div>
<h1>RAG Wissensdatenbank</h1><div class="sub">Handbuch &middot; Installation &amp; Bedienung</div>
<span class="badge">V{VERSION}</span>
<div class="meta"><b>Stand:</b> {STAND} &nbsp;&middot;&nbsp; <b>Tech-IT Consulting</b></div></div>
<div class="toc"><h2>Inhaltsverzeichnis</h2>{toc}</div>
<div class="content">{body}</div></body></html>"""

tmp = pathlib.Path(tempfile.mkdtemp())
(tmp / "manual.html").write_text(html)
raw = tmp / "raw.pdf"
subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                "--virtual-time-budget=10000", f"--print-to-pdf={raw}", str(tmp / "manual.html")],
               check=True, stderr=subprocess.DEVNULL)

# Seitenzahlen-Footer (Deckblatt ausgenommen)
reader = PdfReader(str(raw)); total = len(reader.pages); W, H = A4
buf = io.BytesIO(); c = canvas.Canvas(buf, pagesize=A4)
for i in range(total):
    if i >= 1:
        c.setStrokeColor(Color(.894, .894, .969)); c.setLineWidth(.5); c.line(50, 34, W - 50, 34)
        c.setFont("Helvetica", 8); c.setFillColor(Color(.42, .45, .50))
        c.drawString(50, 22, f"RAG Wissensdatenbank · Handbuch V{VERSION}")
        c.drawRightString(W - 50, 22, f"Seite {i+1} von {total}")
    c.showPage()
c.save(); buf.seek(0)
overlay = PdfReader(buf); writer = PdfWriter()
for i, page in enumerate(reader.pages):
    page.merge_page(overlay.pages[i]); writer.add_page(page)
writer.add_metadata({"/Title": f"RAG Wissensdatenbank – Handbuch V{VERSION}",
                     "/Author": "Tech-IT Consulting", "/Subject": "Installation & Bedienung"})
with open(OUT, "wb") as f: writer.write(f)
print(f"Fertig: {OUT} ({total} Seiten)")
