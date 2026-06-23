"""
license.py
----------
Offline-Lizenzvalidierung fuer die RAG-App (Wissens-Chat).

Key-Format: RAGW-AAAAA-BBBBB-CCCCC-DDDDD
  Payload (15 base32-Zeichen = 9 Bytes):
    Bytes 0-3  uint32 BE  customer_id
    Bytes 4-7  uint32 BE  Tage seit 2020-01-01 (Ablaufdatum)
    Byte  8    uint8      license_type (0=standard/zeitlimitiert, 1=lifetime)
  Checksum (5 base32-Zeichen = 3 Bytes aus HMAC-SHA256):
    hmac.new(SECRET, payload_bytes, sha256).digest()[:3]

Identisches Schema wie die anderen Tech-IT-Produkte (PBXL, ERNG).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import struct
from dataclasses import dataclass, field
from datetime import date, timedelta

_EPOCH       = date(2020, 1, 1)
_TRIAL_DAYS  = 30
_GRACE_DAYS  = 10

# -- App-Identitaet --------------------------------------------------------------
_APP_PREFIX     = "RAGW"
_DEFAULT_SECRET = b"<secret aus dem Admin-Tool>"


def _get_secret() -> bytes:
    raw = os.environ.get("RAG_LICENSE_SECRET", "")
    if raw:
        return raw.encode()
    return _DEFAULT_SECRET


@dataclass
class LicenseInfo:
    status: str = "no_key"
    # valid | trial | trial_expired | expired | invalid | no_key
    valid: bool = False
    customer_id: int = 0
    expiry_date: date = field(default_factory=lambda: date(2020, 1, 1))
    license_type: int = 0
    trial_days_remaining: int = 0
    grace_days_remaining: int = 0
    locked: bool = False
    error: str = ""


def decode_license(key: str, secret: bytes | None = None) -> LicenseInfo:
    if secret is None:
        secret = _get_secret()
    key = key.strip().upper().replace(" ", "")
    if not key:
        return LicenseInfo(status="no_key", error="Kein Lizenzschluessel angegeben.")

    parts = key.split("-")
    if len(parts) != 5 or parts[0] != _APP_PREFIX:
        return LicenseInfo(status="invalid", error="Ungueltiges Format oder falsches Produkt.")

    payload_b32  = "".join(parts[1:4])
    checksum_b32 = parts[4]

    try:
        padding       = (8 - len(payload_b32) % 8) % 8
        payload_bytes = base64.b32decode(payload_b32 + "=" * padding)
    except Exception:
        return LicenseInfo(status="invalid", error="Schluessel konnte nicht dekodiert werden.")

    if len(payload_bytes) < 9:
        return LicenseInfo(status="invalid", error="Schluessel zu kurz.")

    expected_mac = hmac.new(secret, payload_bytes[:9], hashlib.sha256).digest()[:3]
    try:
        chk_padding = (8 - len(checksum_b32) % 8) % 8
        given_mac   = base64.b32decode(checksum_b32 + "=" * chk_padding)[:3]
    except Exception:
        return LicenseInfo(status="invalid", error="Pruefsumme ungueltig.")

    if not hmac.compare_digest(expected_mac, given_mac):
        return LicenseInfo(status="invalid", error="Ungueltiger Schluessel (Signatur stimmt nicht).")

    customer_id, expiry_days, license_type = struct.unpack(">IIB", payload_bytes[:9])
    expiry = _EPOCH + timedelta(days=expiry_days)

    if license_type == 1:
        return LicenseInfo(
            status="valid", valid=True,
            customer_id=customer_id, expiry_date=date(9999, 12, 31), license_type=1,
        )

    if date.today() > expiry:
        return LicenseInfo(
            status="expired", valid=False,
            customer_id=customer_id, expiry_date=expiry, license_type=license_type,
            error=f"Lizenz abgelaufen am {expiry.strftime('%d.%m.%Y')}.",
        )

    return LicenseInfo(
        status="valid", valid=True,
        customer_id=customer_id, expiry_date=expiry, license_type=license_type,
    )


def get_license_status(lic: dict) -> LicenseInfo:
    """Bestimmt den Lizenz-Status aus dem license-Dict der config.json."""
    today = date.today()
    license_key = (lic.get("key") or "").strip()

    # Trial-Daten immer berechnen (Fallback fuer ungueltige/abgelaufene Keys)
    try:
        trial_start = date.fromisoformat(lic.get("trial_start", ""))
    except (ValueError, TypeError):
        trial_start = today
    trial_end  = trial_start + timedelta(days=_TRIAL_DAYS)
    lock_date  = trial_end + timedelta(days=_GRACE_DAYS)

    if license_key:
        info = decode_license(license_key)
        if info.valid:
            return info  # Gueltige Lizenz -> kein Lock

        if info.status == "expired":
            exp_lock = info.expiry_date + timedelta(days=_GRACE_DAYS)
            grace    = max(0, (exp_lock - today).days)
            return LicenseInfo(
                status="expired", valid=False,
                customer_id=info.customer_id, expiry_date=info.expiry_date,
                license_type=info.license_type,
                grace_days_remaining=grace, locked=(today > exp_lock),
                error=info.error,
            )

        # Ungueltiger Key -> Trial-Kulanz als Fallback
        grace = max(0, (lock_date - today).days)
        return LicenseInfo(
            status="invalid", valid=False,
            grace_days_remaining=grace, locked=(today > lock_date),
            error=info.error,
        )

    # Kein Key -> Trial-Logik
    if today <= trial_end:
        return LicenseInfo(
            status="trial", valid=True,
            trial_days_remaining=(trial_end - today).days,
        )

    grace = max(0, (lock_date - today).days)
    return LicenseInfo(
        status="trial_expired", valid=False,
        grace_days_remaining=grace, locked=(today > lock_date),
        error="Testzeitraum abgelaufen. Bitte Lizenzschluessel eingeben.",
    )
