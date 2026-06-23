# Changelog

Alle nennenswerten Änderungen an der **RAG Wissensdatenbank**.
Format nach [Keep a Changelog](https://keepachangelog.com/de/).
Versionsschema: **Major.Minor** (Anzeige als `V1.0`) – z. B. `V1.0`, `V1.1`, `V2.0`.

Die Version ist in [`backend/version.py`](backend/version.py) hinterlegt
(Single Source of Truth), wird im Footer der Oberfläche angezeigt und ist
über `GET /api/version` abrufbar.

## [1.0] – 2026-06-23

Erste offizielle Version.

### Funktionen
- **RAG-Chat**: beantwortet Fragen ausschließlich aus den hinterlegten Dokumenten.
- **LLM-Engines**: Lokal (Ollama/Mac), OpenAI, Anthropic Claude, Google Gemini – pro Chat wählbar.
- **Suche**: Hybrid (semantisch + BM25) mit Cross-Encoder-Reranking, Embedding `e5-large`.
- **Dokumenttypen**: PDF, Word, Excel, PowerPoint, CSV, HTML, Text, Bilder – inkl. OCR (deu/eng) und seitengenauer PDF-Quellen.
- **Quellen**: SMB-Freigabe-Anbindung (Windows-Dateiserver, NAS, Samba), inkrementelles + asynchrones Indexieren, Upload per Drag & Drop.
- **Chat**: Multi-Turn, SSE-Streaming, Markdown, anklickbare Quellen, mehrere Chat-Tabs.
- **Benutzer**: Login (bcrypt), optional 2FA (TOTP), Gruppen mit Ordner-ACL.
- **Spracheingabe** (Mikrofon): lokal via Whisper (lokale Engine) bzw. Web Speech API (Cloud-Engine).
- **Light-/Dark-Mode**.
- **Lizenzierung** (Produkt `RAGW`): Offline-HMAC-Prüfung, 30 Tage Test + 10 Tage Kulanz, danach Sperre.
- **Konfiguration** komplett im Webinterface (Engines/Schlüssel, Suche & Relevanz, Lizenz, Logo).
- **Versionsanzeige** im Footer, `GET /api/version`.

### Betrieb
- Docker-Stack (Backend + Qdrant).
- Online- und Offline-Installation (Bundle-Tooling in [`ops/`](ops/), siehe [INSTALL.md](INSTALL.md)).
- HTTPS über Reverse-Proxy (z. B. `rag.lan` via Nginx Proxy Manager) – Voraussetzung für die Spracheingabe.
- Gebrandetes **PDF-Handbuch** (Installation + Bedienung) in [`docs/`](docs/), erzeugt via [`docs/build-handbuch.py`](docs/build-handbuch.py).

[1.0]: https://example.invalid/releases/v1.0
