import os, io, json, uuid, urllib.request, threading, mimetypes
from urllib.parse import quote
from typing import Optional, List
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse, StreamingResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from fastembed import TextEmbedding
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue

QDRANT    = os.environ.get("QDRANT_URL", "http://qdrant:6333")
COLL      = os.environ.get("COLLECTION", "rag_test")
CACHE     = os.environ.get("FASTEMBED_CACHE", "/models")
PREFERRED = os.environ.get("EMBED_MODEL", "BAAI/bge-m3")
FALLBACK  = "intfloat/multilingual-e5-large"
CONFIG_PATH = os.environ.get("CONFIG_PATH", "/srv/config.json")
IMG_EXTS = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".gif")
EXTS = (".md", ".txt", ".pdf", ".docx", ".xlsx", ".xls", ".csv", ".pptx") + IMG_EXTS
OCR_LANG = os.environ.get("OCR_LANG", "deu+eng")

DEFAULTS = {
    "default_engine": "local",
    "retrieval": {"top_k": 4},
    "engines": {
        "local":  {"enabled": True,  "ollama_url": os.environ.get("OLLAMA_URL", "http://192.168.1.193:11434"),
                   "model": os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")},
        "claude": {"enabled": False, "api_key": "", "model": "claude-opus-4-8"},
        "openai": {"enabled": False, "api_key": "", "model": "gpt-4o"},
        "gemini": {"enabled": False, "api_key": "", "model": "gemini-2.0-flash"},
    },
    "sources": {"smb": {"enabled": False, "host": "192.168.1.5", "share": "", "path": "", "username": "", "password": ""}},
}
ENV_KEYS = {"claude": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY", "gemini": "GOOGLE_API_KEY"}
LABELS   = {"local": "Lokal · Mac", "claude": "Claude (Anthropic)", "openai": "ChatGPT (OpenAI)", "gemini": "Google Gemini"}
ORDER    = ["local", "claude", "openai", "gemini"]
_lock = threading.Lock()
STATE = {"indexing": False, "detail": "", "result": None, "error": None}
_state_lock = threading.Lock()
def set_indexing(on, detail=""):
    with _state_lock:
        STATE["indexing"] = bool(on); STATE["detail"] = detail

SYSTEM = ("Du bist ein praeziser Wissens-Assistent fuer Tech-IT Consulting. Beantworte die Frage "
          "AUSSCHLIESSLICH anhand des bereitgestellten Kontexts auf Deutsch. Wenn die Antwort nicht "
          "im Kontext steht, sage das ehrlich. Erfinde nichts.")

def _clone(d): return json.loads(json.dumps(d))
def deep_merge(base, ov):
    out = _clone(base)
    for k, v in ov.items():
        out[k] = deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out
def load_raw():
    cfg = _clone(DEFAULTS)
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH) as f: cfg = deep_merge(cfg, json.load(f))
        except Exception: pass
    return cfg
def load_config():
    cfg = load_raw()
    for e, env in ENV_KEYS.items():
        if not cfg["engines"][e].get("api_key") and os.environ.get(env):
            cfg["engines"][e]["api_key"] = os.environ[env]
    return cfg
def save_config(cfg):
    with _lock:
        with open(CONFIG_PATH, "w") as f: json.dump(cfg, f, indent=2, ensure_ascii=False)
def engine_key(cfg, e): return cfg["engines"][e].get("api_key") or os.environ.get(ENV_KEYS.get(e, ""), "")
def engine_available(cfg, e):
    en = cfg["engines"][e]
    return False if not en.get("enabled") else (True if e == "local" else bool(engine_key(cfg, e)))

def pick_model():
    s = {m["model"] for m in TextEmbedding.list_supported_models()}
    return PREFERRED if PREFERRED in s else FALLBACK
MODEL = pick_model()
EMB   = TextEmbedding(model_name=MODEL, cache_dir=CACHE)
IS_E5 = "e5" in MODEL.lower()
def emb_query(t):
    x = f"query: {t}" if IS_E5 else t
    return list(EMB.embed([x]))[0].tolist()
def emb_passages(texts):
    xs = [f"passage: {t}" for t in texts] if IS_E5 else list(texts)
    return [v.tolist() for v in EMB.embed(xs)]
DIM = len(emb_query("test"))
qc = QdrantClient(url=QDRANT)
def ensure_collection():
    if not qc.collection_exists(COLL):
        qc.create_collection(COLL, vectors_config=VectorParams(size=DIM, distance=Distance.COSINE))
def retrieve(q, k):
    return qc.query_points(COLL, query=emb_query(q), limit=k, with_payload=True).points

SOURCE_MARGIN = float(os.environ.get("SOURCE_MARGIN", "0.05"))
def rank_sources(hits):
    """Quellen nach bestem Chunk-Score, nur die relevanten (nahe am Top-Score), min. 1."""
    best = {}
    for h in hits:
        src = h.payload.get("source", "?")
        best[src] = max(best.get(src, 0.0), float(h.score))
    ranked = sorted(best.items(), key=lambda x: -x[1])
    if not ranked: return []
    top = ranked[0][1]
    return [{"source": s, "score": round(sc, 3)} for s, sc in ranked if sc >= top - SOURCE_MARGIN]

def ocr_image_bytes(data):
    import pytesseract
    from PIL import Image
    return pytesseract.image_to_string(Image.open(io.BytesIO(data)), lang=OCR_LANG)

def ocr_pdf_bytes(data, dpi=200):
    """Gescanntes PDF: jede Seite rendern und per Tesseract OCR auslesen."""
    import fitz  # PyMuPDF
    import pytesseract
    from PIL import Image
    parts = []
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        for page in doc:
            pix = page.get_pixmap(dpi=dpi)
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            parts.append(pytesseract.image_to_string(img, lang=OCR_LANG))
    finally:
        doc.close()
    return "\n".join(parts)

def read_text_bytes(name, data):
    ext = ("." + name.lower().rsplit(".", 1)[-1]) if "." in name else ""
    try:
        if ext in (".md", ".txt"): return data.decode("utf-8", "ignore")
        if ext == ".pdf":
            from pypdf import PdfReader
            txt = "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(data)).pages)
            if len(txt.strip()) < 50:  # kaum Text -> vermutlich gescannt -> OCR
                try: txt = ocr_pdf_bytes(data)
                except Exception as ex: print(f"[OCR-Warn] {name}: {ex}")
            return txt
        if ext == ".docx":
            import docx
            d = docx.Document(io.BytesIO(data)); parts = [p.text for p in d.paragraphs]
            for t in d.tables:
                for row in t.rows: parts.append(" | ".join(c.text for c in row.cells))
            return "\n".join(parts)
        if ext == ".xlsx":
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
            parts = []
            for ws in wb.worksheets:
                parts.append(f"# {ws.title}")
                for row in ws.iter_rows(values_only=True):
                    cells = [str(c) for c in row if c not in (None, "")]
                    if cells: parts.append(" | ".join(cells))
            return "\n".join(parts)
        if ext == ".xls":
            import xlrd
            book = xlrd.open_workbook(file_contents=data); parts = []
            for sh in book.sheets():
                parts.append(f"# {sh.name}")
                for r in range(sh.nrows):
                    cells = [str(sh.cell_value(r, c)) for c in range(sh.ncols) if sh.cell_value(r, c) not in ("", None)]
                    if cells: parts.append(" | ".join(cells))
            return "\n".join(parts)
        if ext == ".csv":
            import csv as _csv
            text = data.decode("utf-8", "ignore")
            try: delim = _csv.Sniffer().sniff(text[:2048], delimiters=",;\t|").delimiter
            except Exception: delim = ";" if text[:2048].count(";") >= text[:2048].count(",") else ","
            rows = _csv.reader(io.StringIO(text), delimiter=delim)
            return "\n".join(" | ".join(c for c in row if c) for row in rows if any(row))
        if ext == ".pptx":
            from pptx import Presentation
            prs = Presentation(io.BytesIO(data)); parts = []
            for i, slide in enumerate(prs.slides, 1):
                parts.append(f"# Folie {i}")
                for shape in slide.shapes:
                    if shape.has_text_frame:
                        for p in shape.text_frame.paragraphs:
                            t = "".join(run.text for run in p.runs)
                            if t.strip(): parts.append(t)
                    if shape.has_table:
                        for row in shape.table.rows:
                            parts.append(" | ".join(c.text for c in row.cells))
            return "\n".join(parts)
        if ext in IMG_EXTS:
            try: return ocr_image_bytes(data)
            except Exception as ex: print(f"[OCR-Warn] {name}: {ex}")
    except Exception as ex: print(f"[Warn] {name}: {ex}")
    return ""

def chunk(text, size=1000, overlap=150):
    text = text.strip(); out, i = [], 0
    while i < len(text):
        piece = text[i:i+size].strip()
        if piece: out.append(piece)
        i += size - overlap
    return out

def delete_source(rel):
    qc.delete(COLL, points_selector=Filter(must=[FieldCondition(key="source", match=MatchValue(value=rel))]))

def index_file(rel, data, sig=None):
    ensure_collection()
    delete_source(rel)
    chs = chunk(read_text_bytes(rel, data))
    if not chs: return 0
    tenant = rel.split("/")[0] if "/" in rel else "qnap"
    pts = [PointStruct(id=str(uuid.uuid4()), vector=v, payload={"text": ch, "source": rel, "tenant": tenant, "sig": sig})
           for ch, v in zip(chs, emb_passages(chs))]
    for i in range(0, len(pts), 256): qc.upsert(COLL, points=pts[i:i+256])
    return len(pts)

def indexed_sigs():
    """Liefert {source: sig} der bereits indizierten Dateien (Signatur = groesse-mtime)."""
    ensure_collection(); out = {}; off = None
    try:
        while True:
            pts, off = qc.scroll(COLL, limit=256, offset=off, with_payload=["source", "sig"])
            for p in pts:
                src = p.payload.get("source")
                if src and src not in out: out[src] = p.payload.get("sig")
            if off is None: break
    except Exception: pass
    return out

def smb_connect(s):
    import smbclient
    smbclient.reset_connection_cache()
    smbclient.register_session(s["host"].strip(), username=s["username"], password=s.get("password", ""),
                               connection_timeout=20)
    host = s["host"].strip(); share = s["share"].strip().strip("\\/")
    sub = (s.get("path") or "").strip().strip("\\/").replace("/", "\\")
    root = f"\\\\{host}\\{share}"
    base = root + ("\\" + sub if sub else "")
    return smbclient, root, base, sub

def file_sig(stat):
    """Signatur aus Groesse + Aenderungszeit – erkennt geaenderte Dateien ohne Download."""
    return f"{getattr(stat, 'st_size', 0)}-{int(getattr(stat, 'st_mtime', 0))}"

def ingest_smb(full=False):
    cfg = load_config(); s = cfg["sources"]["smb"]
    if not s.get("enabled"): raise ValueError("SMB-Quelle ist nicht aktiviert.")
    if not s.get("share") or not s.get("username"): raise ValueError("Share-Name und Benutzername muessen gesetzt sein.")
    smbclient, root, base, sub = smb_connect(s)

    # 1) Aktuellen Dateibestand auf dem Share inkl. Signatur erfassen (ohne Inhalt zu laden)
    set_indexing(True, "Dateiliste wird gelesen…")
    current = {}  # rel -> sig
    for dp, _d, files in smbclient.walk(base):
        for fn in files:
            if fn.lower().endswith(EXTS):
                full_p = dp + "\\" + fn
                rel = full_p[len(root):].strip("\\").replace("\\", "/")
                try: current[rel] = file_sig(smbclient.stat(full_p))
                except Exception: current[rel] = None

    # 2) Voll-Reindex: Collection neu aufbauen. Sonst: bestehende Signaturen vergleichen
    if full:
        if qc.collection_exists(COLL): qc.delete_collection(COLL)
        qc.create_collection(COLL, vectors_config=VectorParams(size=DIM, distance=Distance.COSINE))
        existing = {}
    else:
        existing = indexed_sigs()

    # 3) Entfernte Dateien aus dem Index loeschen
    removed = [rel for rel in existing if rel not in current]
    for rel in removed: delete_source(rel)

    # 4) Nur geaenderte/neue Dateien herunterladen und neu indizieren
    to_index = [rel for rel, sig in current.items() if full or existing.get(rel) != sig]
    unchanged = len(current) - len(to_index)
    added = updated = skipped = chunks = 0
    for i, rel in enumerate(to_index, 1):
        set_indexing(True, f"{i}/{len(to_index)}: {rel}")
        full_p = root + "\\" + rel.replace("/", "\\")
        try:
            with smbclient.open_file(full_p, mode="rb") as fd: data = fd.read()
        except Exception as ex:
            print(f"[Warn] {rel}: {ex}"); skipped += 1; continue
        was_known = rel in existing
        n = index_file(rel, data, current.get(rel))
        chunks += n
        if not n: skipped += 1
        elif was_known: updated += 1
        else: added += 1

    return {"files": len(current), "added": added, "updated": updated, "unchanged": unchanged,
            "removed": len(removed), "skipped": skipped, "chunks": chunks}

def indexed_count():
    try: return qc.count(COLL).count
    except Exception: return 0

def list_documents():
    ensure_collection(); srcs = {}; off = None
    try:
        while True:
            pts, off = qc.scroll(COLL, limit=256, offset=off, with_payload=["source"])
            for p in pts:
                src = p.payload.get("source", "?"); srcs[src] = srcs.get(src, 0) + 1
            if off is None: break
    except Exception: pass
    return [{"source": k, "chunks": srcs[k]} for k in sorted(srcs)]

def gen_local(cfg, q, ctx):
    en = cfg["engines"]["local"]
    body = json.dumps({"model": en["model"], "prompt": f"Kontext:\n{ctx}\n\nFrage: {q}\n\nAntwort:", "system": SYSTEM, "stream": False}).encode()
    req = urllib.request.Request(en["ollama_url"] + "/api/generate", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r: return json.load(r)["response"].strip()
def gen_claude(cfg, q, ctx):
    import anthropic
    en = cfg["engines"]["claude"]; client = anthropic.Anthropic(api_key=engine_key(cfg, "claude"))
    msg = client.messages.create(model=en["model"], max_tokens=1024, system=SYSTEM,
            messages=[{"role": "user", "content": f"Kontext:\n{ctx}\n\nFrage: {q}"}])
    return "".join(b.text for b in msg.content if b.type == "text").strip()
def gen_openai(cfg, q, ctx):
    from openai import OpenAI
    en = cfg["engines"]["openai"]; client = OpenAI(api_key=engine_key(cfg, "openai"))
    r = client.chat.completions.create(model=en["model"], max_tokens=1024,
            messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": f"Kontext:\n{ctx}\n\nFrage: {q}"}])
    return (r.choices[0].message.content or "").strip()
def gen_gemini(cfg, q, ctx):
    from google import genai
    en = cfg["engines"]["gemini"]; client = genai.Client(api_key=engine_key(cfg, "gemini"))
    return (client.models.generate_content(model=en["model"], contents=f"{SYSTEM}\n\nKontext:\n{ctx}\n\nFrage: {q}").text or "").strip()
GENERATORS = {"local": gen_local, "claude": gen_claude, "openai": gen_openai, "gemini": gen_gemini}

# ---- Multi-Turn: Verlauf in Chat-Nachrichten umwandeln ----
HISTORY_TURNS = 8  # wie viele vorherige Nachrichten in den Kontext genommen werden
def build_messages(history, q, ctx):
    msgs = [{"role": "system", "content": SYSTEM}]
    for h in (history or [])[-HISTORY_TURNS:]:
        content = (h.get("content") or "").strip()
        role = h.get("role")
        if not content: continue
        if role == "user": msgs.append({"role": "user", "content": content})
        elif role in ("assistant", "bot"): msgs.append({"role": "assistant", "content": content})
    msgs.append({"role": "user", "content": f"Kontext:\n{ctx}\n\nFrage: {q}"})
    return msgs

def _flatten(messages):
    lines = []
    for m in messages:
        if m["role"] == "system": lines.append(m["content"])
        elif m["role"] == "user": lines.append(f"Frage/Nutzer:\n{m['content']}")
        else: lines.append(f"Assistent:\n{m['content']}")
    return "\n\n".join(lines)

# ---- Streaming-Generatoren: liefern Text-Stuecke (Deltas) ----
def stream_local(cfg, messages):
    en = cfg["engines"]["local"]
    body = json.dumps({"model": en["model"], "messages": messages, "stream": True}).encode()
    req = urllib.request.Request(en["ollama_url"] + "/api/chat", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        for line in r:
            line = line.strip()
            if not line: continue
            try: obj = json.loads(line)
            except Exception: continue
            piece = (obj.get("message") or {}).get("content", "")
            if piece: yield piece
            if obj.get("done"): break
def stream_claude(cfg, messages):
    import anthropic
    en = cfg["engines"]["claude"]; client = anthropic.Anthropic(api_key=engine_key(cfg, "claude"))
    sys = messages[0]["content"] if messages and messages[0]["role"] == "system" else SYSTEM
    msgs = [m for m in messages if m["role"] != "system"]
    with client.messages.stream(model=en["model"], max_tokens=1024, system=sys, messages=msgs) as s:
        for text in s.text_stream: yield text
def stream_openai(cfg, messages):
    from openai import OpenAI
    en = cfg["engines"]["openai"]; client = OpenAI(api_key=engine_key(cfg, "openai"))
    s = client.chat.completions.create(model=en["model"], messages=messages, stream=True)
    for ch in s:
        d = ch.choices[0].delta.content if ch.choices else None
        if d: yield d
def stream_gemini(cfg, messages):
    from google import genai
    en = cfg["engines"]["gemini"]; client = genai.Client(api_key=engine_key(cfg, "gemini"))
    for ch in client.models.generate_content_stream(model=en["model"], contents=_flatten(messages)):
        if getattr(ch, "text", None): yield ch.text
STREAMERS = {"local": stream_local, "claude": stream_claude, "openai": stream_openai, "gemini": stream_gemini}

def sse(event, data):
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

app = FastAPI(title="Tech-IT Wissens-Chat")
class AskReq(BaseModel):
    question: str
    engine: Optional[str] = None
    history: Optional[List[dict]] = None
class ConfigIn(BaseModel):
    default_engine: Optional[str] = None
    retrieval: Optional[dict] = None
    engines: Optional[dict] = None
    sources: Optional[dict] = None

@app.get("/api/engines")
def engines():
    cfg = load_config(); out = []
    for e in ORDER:
        en = cfg["engines"][e]
        label = LABELS[e] + (f" ({en['model']})" if e == "local" else "")
        out.append({"id": e, "label": label, "available": engine_available(cfg, e), "default": cfg["default_engine"] == e})
    return out

@app.get("/api/ollama/models")
def ollama_models(url: str = ""):
    url = (url or "").strip().rstrip("/")
    if not url:
        return JSONResponse({"error": "Keine Ollama-URL angegeben."}, status_code=400)
    try:
        req = urllib.request.Request(url + "/api/tags")
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.load(r)
        models = sorted(m.get("name") for m in data.get("models", []) if m.get("name"))
        return {"models": models}
    except Exception as ex:
        return JSONResponse({"error": f"Ollama unter '{url}' nicht erreichbar: {ex}"}, status_code=400)

@app.post("/api/ask")
def ask(r: AskReq):
    cfg = load_config(); e = r.engine or cfg["default_engine"]
    if e not in GENERATORS or not engine_available(cfg, e):
        return JSONResponse({"error": f"Engine '{e}' ist nicht verfuegbar (in Einstellungen aktivieren / Schluessel hinterlegen)."}, status_code=400)
    hits = retrieve(r.question, int(cfg["retrieval"].get("top_k", 4)))
    context = "\n\n".join(f"[Quelle: {h.payload['source']}]\n{h.payload['text']}" for h in hits)
    sources = sorted({h.payload["source"] for h in hits})
    try: answer = GENERATORS[e](cfg, r.question, context)
    except Exception as ex: return JSONResponse({"error": f"Fehler bei Engine '{LABELS.get(e, e)}': {ex}"}, status_code=500)
    return {"answer": answer, "sources": sources, "engine": LABELS[e]}

@app.post("/api/ask/stream")
def ask_stream(r: AskReq):
    cfg = load_config(); e = r.engine or cfg["default_engine"]
    if e not in STREAMERS or not engine_available(cfg, e):
        def err():
            yield sse("error", {"error": f"Engine '{e}' ist nicht verfuegbar (in Einstellungen aktivieren / Schluessel hinterlegen)."})
        return StreamingResponse(err(), media_type="text/event-stream")
    hits = retrieve(r.question, int(cfg["retrieval"].get("top_k", 4)))
    context = "\n\n".join(f"[Quelle: {h.payload['source']}]\n{h.payload['text']}" for h in hits)
    sources = rank_sources(hits)
    messages = build_messages(r.history, r.question, context)
    def gen():
        yield sse("meta", {"sources": sources, "engine": LABELS[e]})
        try:
            for piece in STREAMERS[e](cfg, messages):
                yield sse("delta", {"text": piece})
        except Exception as ex:
            yield sse("error", {"error": f"Fehler bei Engine '{LABELS.get(e, e)}': {ex}"})
        yield sse("done", {})
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.get("/api/config")
def get_config():
    cfg = load_config(); raw = load_raw()
    out = {"default_engine": cfg["default_engine"], "retrieval": cfg["retrieval"], "engines": {}, "indexed_chunks": indexed_count()}
    for e in ORDER:
        en = cfg["engines"][e]; item = {"enabled": en.get("enabled", False), "model": en.get("model", ""), "label": LABELS[e]}
        if e == "local": item["ollama_url"] = en.get("ollama_url", "")
        else:
            item["has_key"] = bool(engine_key(cfg, e))
            # key_from_env anhand der Rohdaten (vor Env-Merge) bestimmen: kein Key in der Datei, aber in der Umgebung
            item["key_from_env"] = bool(not raw["engines"][e].get("api_key") and os.environ.get(ENV_KEYS.get(e, "")))
        out["engines"][e] = item
    s = cfg["sources"]["smb"]
    out["sources"] = {"smb": {"enabled": s.get("enabled", False), "host": s.get("host", ""), "share": s.get("share", ""),
                              "path": s.get("path", ""), "username": s.get("username", ""), "has_password": bool(s.get("password"))}}
    return out

@app.post("/api/config")
def set_config(c: ConfigIn):
    cfg = load_raw()
    if c.default_engine: cfg["default_engine"] = c.default_engine
    if c.retrieval: cfg["retrieval"].update(c.retrieval)
    if c.engines:
        for e, vals in c.engines.items():
            if e not in cfg["engines"]: continue
            tgt = cfg["engines"][e]
            if "enabled" in vals: tgt["enabled"] = bool(vals["enabled"])
            if vals.get("model"): tgt["model"] = vals["model"]
            if e == "local" and vals.get("ollama_url"): tgt["ollama_url"] = vals["ollama_url"]
            if vals.get("api_key"): tgt["api_key"] = vals["api_key"]
    if c.sources and "smb" in c.sources:
        smb = c.sources["smb"]; tgt = cfg["sources"]["smb"]
        if "enabled" in smb: tgt["enabled"] = bool(smb["enabled"])
        for f in ("host", "share", "path", "username"):
            if f in smb: tgt[f] = smb[f]
        if smb.get("password"): tgt["password"] = smb["password"]
    save_config(cfg)
    return {"ok": True}

@app.get("/api/status")
def api_status():
    with _state_lock: st = dict(STATE)
    st["indexed_chunks"] = indexed_count(); return st

@app.post("/api/ingest")
def api_ingest(full: bool = False):
    # Asynchron: im Hintergrund-Thread starten, sofort zurueckkehren.
    # Fortschritt + Ergebnis holt das Frontend ueber /api/status.
    with _state_lock:
        if STATE["indexing"]:
            return JSONResponse({"error": "Es laeuft bereits eine Indexierung."}, status_code=409)
        STATE["indexing"] = True
        STATE["detail"] = "Start…"
        STATE["result"] = None
        STATE["error"] = None
    def worker():
        try:
            res = ingest_smb(full=full)
            with _state_lock: STATE["result"] = {"full": full, **res}
        except Exception as ex:
            with _state_lock: STATE["error"] = str(ex)
        finally:
            set_indexing(False)
    threading.Thread(target=worker, daemon=True).start()
    return {"ok": True, "started": True, "full": full}

@app.get("/api/documents")
def api_documents():
    docs = list_documents()
    return {"documents": docs, "total_chunks": sum(d["chunks"] for d in docs)}

@app.get("/api/document")
def api_document(source: str):
    # Nur tatsaechlich indizierte Quellen erlauben -> kein Path-Traversal
    known = {d["source"] for d in list_documents()}
    if source not in known:
        return JSONResponse({"error": "Unbekannte Quelle."}, status_code=404)
    cfg = load_config(); s = cfg["sources"]["smb"]
    try:
        smbclient, root, base, sub = smb_connect(s)
        full = root + "\\" + source.replace("/", "\\")
        with smbclient.open_file(full, mode="rb") as fd: data = fd.read()
    except Exception as ex:
        return JSONResponse({"error": f"Datei nicht abrufbar: {ex}"}, status_code=502)
    name = source.rsplit("/", 1)[-1]
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
    # PDF/Text inline im Browser, Office-Dateien laden herunter
    disp = "inline" if ctype in ("application/pdf", "text/plain") else "attachment"
    headers = {"Content-Disposition": f"{disp}; filename*=UTF-8''{quote(name)}"}
    return Response(content=data, media_type=ctype, headers=headers)

@app.post("/api/upload")
async def api_upload(files: List[UploadFile] = File(...)):
    cfg = load_config(); s = cfg["sources"]["smb"]
    if not s.get("share") or not s.get("username"):
        return JSONResponse({"error": "SMB-Quelle ist nicht konfiguriert (Share/Benutzer fehlen)."}, status_code=400)
    try: smbclient, root, base, sub = smb_connect(s)
    except Exception as ex: return JSONResponse({"error": f"SMB-Verbindung fehlgeschlagen: {ex}"}, status_code=400)
    results = []
    for uf in files:
        name = os.path.basename(uf.filename or "")
        if not name.lower().endswith(EXTS):
            results.append({"file": name, "error": "Dateityp nicht unterstuetzt"}); continue
        data = await uf.read()
        dest = base + "\\" + name
        try:
            with smbclient.open_file(dest, mode="wb") as fd: fd.write(data)
        except Exception as ex:
            results.append({"file": name, "error": f"Schreiben auf QNAP fehlgeschlagen: {ex}"}); continue
        rel = (sub.replace("\\", "/") + "/" if sub else "") + name
        try: sig = file_sig(smbclient.stat(dest))
        except Exception: sig = None
        try: results.append({"file": name, "chunks": index_file(rel, data, sig)})
        except Exception as ex: results.append({"file": name, "error": f"Indexierung fehlgeschlagen: {ex}"})
    return {"ok": True, "results": results, "indexed_chunks": indexed_count()}

app.mount("/", StaticFiles(directory="static", html=True), name="static")
