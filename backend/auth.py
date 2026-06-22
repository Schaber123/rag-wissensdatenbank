"""Authentifizierung, Nutzer-/Gruppenverwaltung und ordnerbasierte Datenrechte (ACL).

Speicher: users.json (gitignored) – Nutzer mit bcrypt-Hash + optionalem TOTP-Secret
und Gruppen mit erlaubten Ordner-Praefixen. Sessions liegen im RAM (Token -> Username);
ein Neustart loggt alle aus (fuer ein internes Tool akzeptabel).
"""
import os, json, time, base64, secrets, threading, io
from typing import Optional
import bcrypt
import pyotp
from fastapi import Request, HTTPException, Depends

USERS_PATH   = os.environ.get("USERS_PATH", "/srv/users.json")
COOKIE_NAME  = "rag_session"
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"
SESSION_TTL  = int(os.environ.get("SESSION_TTL", str(30 * 24 * 3600)))  # 30 Tage
PENDING_TTL  = 300   # 5 Min fuer den 2FA-Zwischenschritt
LOCK_AFTER   = 5     # Fehlversuche bis zur Sperre
LOCK_SECONDS = 60    # Sperrdauer pro Username

_file_lock = threading.Lock()
_sessions = {}   # token -> {"user": str, "created": float}
_pending  = {}   # token -> {"user": str, "created": float}  (nach Passwort, vor 2FA)
_fails    = {}   # username -> {"count": int, "until": float}

DEFAULT_STORE = {"groups": {}, "users": {}}


# ---------- Persistenz ----------
def _clone(d): return json.loads(json.dumps(d))

def load_store():
    store = _clone(DEFAULT_STORE)
    if os.path.exists(USERS_PATH):
        try:
            with open(USERS_PATH) as f:
                data = json.load(f)
            store["groups"] = data.get("groups", {})
            store["users"]  = data.get("users", {})
        except Exception:
            pass
    return store

def save_store(store):
    with _file_lock:
        tmp = USERS_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(store, f, indent=2, ensure_ascii=False)
        os.replace(tmp, USERS_PATH)


# ---------- Passwoerter ----------
def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("ascii")

def verify_pw(pw: str, pw_hash: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), pw_hash.encode("ascii"))
    except Exception:
        return False


# ---------- Bootstrap des ersten Admins ----------
def bootstrap_admin():
    store = load_store()
    if store["users"]:
        return
    user = (os.environ.get("ADMIN_USER") or "admin").strip().lower()
    pw   = os.environ.get("ADMIN_PASSWORD")
    generated = False
    if not pw:
        pw = secrets.token_urlsafe(12)
        generated = True
    store["users"][user] = {
        "label": user.capitalize(), "pw_hash": hash_pw(pw), "admin": True,
        "groups": [], "totp_secret": None, "totp_enabled": False,
    }
    save_store(store)
    if generated:
        print(f"[Auth] Erst-Admin '{user}' angelegt. Generiertes Passwort: {pw}", flush=True)
        print("[Auth] Bitte nach dem ersten Login aendern.", flush=True)
    else:
        print(f"[Auth] Erst-Admin '{user}' aus ADMIN_USER/ADMIN_PASSWORD angelegt.", flush=True)


# ---------- ACL: erlaubte Ordner-Praefixe eines Nutzers ----------
def _norm_prefix(p: str) -> str:
    return (p or "").strip().strip("/").replace("\\", "/")

def allowed_prefixes(store, username) -> list:
    """Vereinigung der Ordner-Praefixe aller Gruppen des Nutzers."""
    u = store["users"].get(username) or {}
    out = set()
    for g in u.get("groups", []):
        grp = store["groups"].get(g)
        if not grp:
            continue
        for f in grp.get("folders", []):
            f = _norm_prefix(f)
            if f:
                out.add(f)
    return sorted(out)

def source_allowed(store, user, src: str) -> bool:
    """Darf der Nutzer diese Quelle sehen? Admin: immer. Sonst: ein erlaubter Praefix
    muss Verzeichnis von src oder dessen Vorgaenger sein."""
    if user.get("admin"):
        return True
    src = _norm_prefix(src)
    allowed = allowed_prefixes(load_store(), user["username"]) if "username" in user else []
    for p in allowed:
        if src == p or src.startswith(p + "/"):
            return True
    return False


# ---------- Sessions ----------
def _gc():
    now = time.time()
    for tok in [t for t, s in _sessions.items() if now - s["created"] > SESSION_TTL]:
        _sessions.pop(tok, None)
    for tok in [t for t, s in _pending.items() if now - s["created"] > PENDING_TTL]:
        _pending.pop(tok, None)

def create_session(username) -> str:
    _gc()
    tok = secrets.token_urlsafe(32)
    _sessions[tok] = {"user": username, "created": time.time()}
    return tok

def create_pending(username) -> str:
    _gc()
    tok = secrets.token_urlsafe(24)
    _pending[tok] = {"user": username, "created": time.time()}
    return tok

def consume_pending(tok) -> Optional[str]:
    s = _pending.pop(tok, None)
    if not s or time.time() - s["created"] > PENDING_TTL:
        return None
    return s["user"]

def destroy_session(tok):
    _sessions.pop(tok, None)

def set_cookie(resp, tok):
    resp.set_cookie(COOKIE_NAME, tok, httponly=True, samesite="lax",
                    secure=COOKIE_SECURE, max_age=SESSION_TTL, path="/")

def clear_cookie(resp):
    resp.delete_cookie(COOKIE_NAME, path="/")


# ---------- Brute-Force-Bremse ----------
def is_locked(username) -> bool:
    f = _fails.get(username)
    return bool(f and f["count"] >= LOCK_AFTER and time.time() < f["until"])

def note_fail(username):
    f = _fails.setdefault(username, {"count": 0, "until": 0})
    f["count"] += 1
    if f["count"] >= LOCK_AFTER:
        f["until"] = time.time() + LOCK_SECONDS

def note_success(username):
    _fails.pop(username, None)


# ---------- TOTP ----------
def new_totp_secret() -> str:
    return pyotp.random_base32()

def totp_uri(secret, username, issuer="Tech-IT Wissens-Chat") -> str:
    return pyotp.totp.TOTP(secret).provisioning_uri(name=username, issuer_name=issuer)

def totp_verify(secret, code) -> bool:
    if not secret or not code:
        return False
    try:
        return pyotp.TOTP(secret).verify(str(code).strip(), valid_window=1)
    except Exception:
        return False

def qr_png_base64(uri) -> str:
    """QR-Code als data:-URI (PNG, base64) zum Einbetten im <img>."""
    import qrcode
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


# ---------- FastAPI-Dependencies ----------
def _user_from_request(request: Request) -> Optional[dict]:
    tok = request.cookies.get(COOKIE_NAME)
    if not tok:
        return None
    s = _sessions.get(tok)
    if not s or time.time() - s["created"] > SESSION_TTL:
        _sessions.pop(tok, None)
        return None
    store = load_store()
    u = store["users"].get(s["user"])
    if not u:
        return None
    return {"username": s["user"], "label": u.get("label", s["user"]),
            "admin": bool(u.get("admin")), "groups": u.get("groups", []),
            "totp_enabled": bool(u.get("totp_enabled")),
            "folders": allowed_prefixes(store, s["user"])}

def require_user(request: Request) -> dict:
    u = _user_from_request(request)
    if not u:
        raise HTTPException(status_code=401, detail="Nicht angemeldet.")
    return u

def require_admin(request: Request) -> dict:
    u = require_user(request)
    if not u["admin"]:
        raise HTTPException(status_code=403, detail="Adminrechte erforderlich.")
    return u
