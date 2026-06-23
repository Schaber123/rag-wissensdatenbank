# RAG Wissensdatenbank (Tech-IT Consulting)

**V1.0** · Stand: 2026-06-23

Interner Wissens-Chat: stellt Fragen zu Dokumenten und beantwortet sie ausschließlich
aus den hinterlegten Quellen (Retrieval-Augmented Generation). Mehrere LLM-Engines
wählbar (lokal auf dem Mac via Ollama, OpenAI, Claude, Gemini).

**Dokumentation:** [📘 Handbuch (PDF)](docs/RAG-Wissensdatenbank-Handbuch-V1.0.pdf) · [Installation](INSTALL.md) · [Bedienungsanleitung](BEDIENUNGSANLEITUNG.md) · [Changelog](CHANGELOG.md)
Das gebrandete PDF-Handbuch wird mit [`docs/build-handbuch.py`](docs/build-handbuch.py) aus den Markdown-Quellen erzeugt.
Version: [`backend/version.py`](backend/version.py) (Single Source of Truth) · `GET /api/version`.

> Diese Doku enthält **keine Secrets**. API-Keys und das SMB-Passwort liegen ausschließlich
> in `config.json` / `.env` auf dem Server (siehe „Sicherheit").

---

## 0. Stand & nächste Schritte (zuletzt: 2026-06-22)

**Funktioniert / fertig:**
- **Authentifizierung + Nutzer/Gruppen + ordnerbasierte Datenrechte** *(neu, 2026-06-22)* — siehe Abschnitt 10.
  Login (User/Passwort, **bcrypt**), optional **TOTP-2FA**; Admin verwaltet Nutzer & Gruppen unter `admin.html`.
  Gruppen geben **Ordner-Präfixe** frei; jeder Nutzer durchsucht/öffnet nur seine Ordner (ACL über
  Qdrant-Payload `path_prefixes`). Admin sieht alles. Upload für alle (nur in erlaubte Ordner), Engine-/SMB-/
  Such-Einstellungen + Voll-Reindex **admin-only**.
- Multi-Engine-Chat (lokal Mac/Ollama, OpenAI, Claude, Gemini) mit **SSE-Streaming**, **Multi-Turn-Verlauf**, **Markdown**.
- **Inkrementelles Indexieren** (Signatur Größe+mtime) + Voll-Neuaufbau, **asynchron** (kein „Load failed" mehr).
- **Starkes Embedding** (`intfloat/multilingual-e5-large`, 1024 Dim) — findet auch natürlichsprachliche Fragen
  zuverlässig (z. B. „Wie startet man die Cforce 820?" → echte Startanleitung S.69; mit MiniLM lag die auf Rang 144).
  Preis: langsamerer Voll-Neuaufbau (~15–20 Min, single-core) und ~0,5–1 s mehr pro Frage. Einmal-/Inkrement-Aufwand.
- **Hybrid-Suche + Reranking** *(neu)*: dense (MiniLM) **+** sparse BM25, per **RRF-Fusion** zusammengeführt,
  danach **Cross-Encoder-Reranking** (mehrsprachig). Findet Eigennamen/Nummern/Fachbegriffe deutlich besser.
  Per Settings ab-/zuschaltbar (`hybrid`, `rerank`, `candidates`, `rerank_model`), mit Dense-Fallback.
- **Quellen** relevanzgefiltert (jetzt **relativer** Score-Abstand, skalenunabhängig), nach Score sortiert, **anklickbar**.
- **Seitengenaue Quellen** *(neu)*: PDFs werden seitenweise indiziert, jeder Chunk trägt seine `page`. Die Quelle zeigt
  „· S. N" an und der Link öffnet das PDF direkt auf der Seite (`#page=N`). Gescannte PDFs: OCR pro Seite.
- **Dateitypen:** PDF, Word, Excel, PowerPoint, CSV, Text, Bilder — inkl. **OCR** (Tesseract deu+eng) für Scans.
- **Lokale Engine via Netbird** (Mac `100.94.178.115`), **Ollama-Autostart** (LaunchAgent auf dem Mac).
- API-Keys werden **im Webinterface** verwaltet (config.json); `.env` als leerer Fallback.
- Settings: „Ollama-Modelle abrufen", Hilfetext zu `top_k`, Karte „Suche & Relevanz".

> ⚠️ **Speicher auf der 8-GB-VM (wichtig!):** e5-large ist RAM-hungrig. Damit der Voll-Neuaufbau **nicht
> OOM-gekillt** wird, gilt: Embedding läuft mit `parallel=1` + `EMBED_BATCH=16` (nur EIN Modell im RAM statt
> einer ~2-GB-Kopie pro Kern), und der **Reranker-Warmup ist beim Start AUS** (`RERANK_WARMUP=1` aktiviert ihn
> wieder; er lädt sonst beim ersten Chat lazy, ~10 s). Baseline-RAM dann ~3,6 GB, im Betrieb ~4–6 GB. Bei
> Modellwechsel auf etwas noch Größeres unbedingt RAM/Swap im Blick behalten (`free -m`, `dmesg | grep -i oom`).
> **SMB-Robustheit:** Weil das Embedding pro Datei Minuten dauern kann, lief die SMB-Session ab → Folge-Downloads
> scheiterten. Behoben durch Reconnect-Retry (`smb_read_retry`).
>
> ⚠️ **Deploy der Hybrid-Suche:** neues Collection-Schema (benannte Vektoren `dense` + sparse `bm25`) →
> **Voll-Neuaufbau nötig** und neue Collection `rag_hybrid` (alte `rag_test` bleibt als Rollback liegen).
> `requirements.txt` wurde gepinnt (`qdrant-client>=1.10`, `fastembed>=0.4.2`) → **`docker compose build backend`** nötig.
> Der Reranker (Standard `jinaai/jina-reranker-v2-base-multilingual`) wird beim ersten Einsatz automatisch
> heruntergeladen (~mehrere 100 MB ins `models`-Volume) und beim Start vorgewärmt. Auf der CPU-VM kostet das Reranking
> je Frage ~1–3 s; falls zu langsam → in den Einstellungen abschalten oder `candidates` senken.

**Offene Punkte / mögliche nächste Schritte:**
- [ ] **OpenAI-Key rotieren:** neuen Key in der OpenAI-Konsole erzeugen, alten widerrufen, neuen im Webinterface eintragen
      (aktuell hat OpenAI **keinen** Key → Default-Engine-Frage schlägt fehl, bis Key gesetzt; lokale Engine läuft).
- [ ] **SMB-Passwort** liegt noch im Klartext in `config.json` — optional analog zu den API-Keys in `.env`.
- [ ] **Bilder vom Share:** werden beim Abgleich per OCR mitindiziert — bei Bedarf auf „nur Upload" beschränken.
- [ ] **Retrieval-Qualität:** dank Hybrid + Reranking deutlich verbessert. Falls das Dense-Embedding selbst noch
      limitiert → optional auf `paraphrase-multilingual-mpnet-base-v2` (768 Dim) wechseln (Voll-Neuaufbau nötig).
      `top_k` aktuell 4, `candidates` 20.
- [x] ~~Kein Auth auf der Web-App~~ — **erledigt** (Login + Gruppen/ACL, Abschnitt 10).
- [ ] **Kein TLS:** Passwörter laufen über HTTP (im Netbird/WireGuard-VPN verschlüsselt, im LAN Klartext).
      Später Reverse-Proxy mit TLS davor, dann `COOKIE_SECURE=1` in der `.env`.

**Wie wir weitermachen:** Lokale Arbeitskopie + Git-Historie unter `rag-wissensdatenbank/`. Deploy = `scp` (Reload) bzw.
`docker compose build backend && up -d` bei Dockerfile/requirements-Änderungen. Details unten.

---

## 1. Wo läuft was

| | |
|---|---|
| **Produktivserver** | `vm-rag` — **192.168.1.211** (Debian 13), Zugang: `ssh root@192.168.1.211` |
| **App-Verzeichnis (Server)** | `/opt/rag` (kein Git-Repo) |
| **Lokale Arbeitskopie** | `rag-wissensdatenbank/` im Workspace (Git-Repo, Sicherungs-/Versionsstand) |
| **Web-App** | `http://192.168.1.211` (Port 80) bzw. `:8000`. Im Mesh: vm-rag Netbird-IP `100.94.149.70` |
| **Netbird** | vm-rag: `vm-rag.netbird.selfhosted` / `100.94.149.70` · Management `netbird.techit-consulting.de` |

### Deploy-Modell
Das Backend läuft im Docker-Container `rag-backend` mit `uvicorn --reload`, und
`/opt/rag/backend` ist in den Container gemountet. **Codeänderungen greifen ohne Rebuild**
— einfach die Datei per `scp` ersetzen, uvicorn lädt automatisch neu.
Ein Rebuild ist nur bei Änderung von `requirements.txt` nötig.

```bash
# Backend deployen
scp rag-wissensdatenbank/backend/main.py root@192.168.1.211:/opt/rag/backend/main.py
# Frontend deployen
scp rag-wissensdatenbank/backend/static/* root@192.168.1.211:/opt/rag/backend/static/
# Reload prüfen
ssh root@192.168.1.211 'docker logs --since 20s rag-backend | tail; curl -s localhost:8000/api/status'
```

---

## 2. Architektur

```
Browser ──HTTP──> rag-backend (FastAPI, Port 80/8000)
                    ├── statische Web-UI (static/)
                    ├── Embeddings: fastembed (Modell s.u.)
                    ├── Qdrant (Vektor-DB, Container rag-qdrant, nur localhost:6333/6334)
                    └── LLM-Engines:
                          local  → Ollama auf dem Mac (über Netbird)
                          openai → OpenAI API
                          claude → Anthropic API
                          gemini → Google API
Wissensquelle: SMB-Freigabe auf 192.168.1.5 / "Wissensdatenbank" / Unterordner "Dokumente"
```

- **Docker-Compose:** `/opt/rag/docker-compose.yml` — Services `qdrant`, `backend`, optional `app` (Profil `tools`).
- **Collection:** `rag_hybrid` (benannte Vektoren). Vorher `rag_test` (reines Dense) — bleibt nach dem Wechsel
  unangetastet als Rollback.
  - Dense-Vektor `dense` (Cosine, 384 Dim) **+** Sparse-Vektor `bm25` (`SparseVectorParams(modifier=IDF)`).
  - **Hybrid-Suche:** Qdrant `query_points` mit zwei `Prefetch` (dense + bm25) und `FusionQuery(RRF)` →
    Kandidaten-Pool (`candidates`, Default 20). Danach **Cross-Encoder-Reranking** auf die besten `top_k`.
    Reranker-Score wird per Sigmoid auf 0–1 abgebildet → `rank_sources`/„Relevanz %" bleiben aussagekräftig.
  - Steuerung in `config.json` unter `retrieval`: `hybrid`, `rerank`, `candidates`, `rerank_model`, `top_k`.
    Fällt bei Fehlern automatisch auf Dense-Suche bzw. „ohne Rerank" zurück.
  - **Sparse/BM25-Modell:** `Qdrant/bm25` (fastembed, tokenizer-basiert, kein neuronales Modell → CPU-günstig),
    IDF wird serverseitig von Qdrant gewichtet. Sprache `german` (Stopwords), via `SPARSE_MODEL` änderbar.
  - **Reranker:** Default `jinaai/jina-reranker-v2-base-multilingual` (mehrsprachig). Lazy + Warmup beim Start,
    Fallback-Liste falls nicht unterstützt (`RERANK_FALLBACKS`). Modell/An-Aus über Settings bzw. `RERANK_MODEL`.
- **Embedding-Modell:** `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` (384 Dim, mehrsprachig),
  gesetzt über `EMBED_MODEL` in `docker-compose.yml`.
  - Gewählt wegen Tempo: auf der 4-Core-VM ~**0,01 s/Chunk** statt ~3 s/Chunk bei e5-large (Faktor ~300).
  - `BAAI/bge-m3` wird von dieser fastembed-Version **nicht** unterstützt → lief früher auf dem langsamen
    Fallback `intfloat/multilingual-e5-large`. Das war die Ursache für „hängende"/sehr langsame Indexierungen.
  - **Modellwechsel = anderes Vektorformat** → danach **Voll-Neuaufbau** nötig (`/api/ingest?full=true`).
  - E5-Modelle bräuchten `query:`/`passage:`-Präfixe (`IS_E5` im Code); bei MiniLM aus (korrekt).
- **Chunking:** 1000 Zeichen, 150 Überlappung. PDFs werden **seitenweise** gechunkt (`read_pages`), damit jeder
  Chunk eine `page`-Angabe bekommt (Quelle springt per `#page=N` an die Stelle). Andere Formate: `page=None`.
- **Unterstützte Dateitypen** (`EXTS` / `read_text_bytes`):
  PDF, Word `.docx`, Excel `.xlsx`/`.xls`, PowerPoint `.pptx`, CSV, HTML `.html`/`.htm`, Text `.txt`/`.md`,
  Bilder `.png/.jpg/.jpeg/.tif/.tiff/.bmp/.gif`.
  - **OCR (Tesseract, `deu+eng`):** Bilder werden per OCR ausgelesen; bei PDFs greift OCR als **Fallback**,
    wenn die normale Textextraktion < 50 Zeichen liefert (= vermutlich gescannt). Normale Text-PDFs bleiben schnell.
  - OCR ist CPU-intensiv → gescannte Mehrseiter brauchen auf der VM spürbar Zeit (läuft aber asynchron).
  - **Achtung:** Auch Bilddateien auf dem SMB-Share werden beim Abgleich per OCR indiziert — keine großen
    Bildbestände (Logos/Fotos) in den indizierten Ordner legen, sonst unnötige OCR-Last. Sprache via `OCR_LANG`.
  - Tesseract + Sprachpakete werden im Docker-Image installiert (`backend/Dockerfile`) →
    nach Änderungen an Dockerfile/requirements **`docker compose build backend`** nötig (nicht nur `--reload`).

---

## 3. Backend-Komponenten (`backend/main.py`)

### API-Endpunkte
| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/engines` | Liste verfügbarer Engines (für Chat-Dropdown) |
| POST | `/api/ask` | Frage beantworten (nicht-streamend, Fallback) |
| POST | `/api/ask/stream` | **Frage beantworten, SSE-Streaming** (vom Frontend genutzt) |
| GET | `/api/config` | Einstellungen lesen (Keys maskiert) |
| POST | `/api/config` | Einstellungen speichern (merge) |
| GET | `/api/status` | `{indexing, detail, indexed_chunks}` |
| POST | `/api/ingest?full=<bool>` | SMB abgleichen — inkrementell (default) oder Voll-Neuaufbau |
| GET | `/api/documents` | Indizierte Dokumente + Chunk-Anzahl |
| GET | `/api/document?source=<rel>` | Datei von der SMB-Freigabe abrufen/öffnen (PDF inline). Nur indizierte Quellen erlaubt (kein Path-Traversal) |
| POST | `/api/upload` | Dateien hochladen → auf SMB-Freigabe schreiben + indizieren |
| GET | `/api/ollama/models?url=<url>` | Modelle eines Ollama-Servers auflisten (`/api/tags`) |

### Inkrementelles Indexieren
- **Signatur** je Datei = `Größe-mtime` (aus `smbclient.stat`), gespeichert im Qdrant-Payload-Feld `sig`.
- `ingest_smb(full=False)`:
  1. Dateibestand auf dem Share + Signaturen erfassen (ohne Download).
  2. Bestehende Signaturen aus Qdrant lesen (`indexed_sigs()`).
  3. Entfernte Dateien aus dem Index löschen.
  4. **Nur geänderte/neue Dateien** herunterladen und neu indizieren.
- Rückgabe (in `STATE["result"]`): `{files, added, updated, unchanged, removed, skipped, chunks}`.
- `full=True` verwirft die Collection und liest alles neu.
- **Asynchron:** `/api/ingest` startet die Arbeit in einem Hintergrund-Thread und kehrt sofort zurück
  (`{started:true}`). So blockiert ein großes/langsames Dokument nicht mehr den ganzen Prozess
  (früher: synchroner Ingest → App unerreichbar → Browser „Load failed").
- Fortschritt/Ergebnis live über `/api/status`: `{indexing, detail:"i/n: datei", result, error, indexed_chunks}`.
  Das Frontend pollt alle 3 s und zeigt Fortschritt + Endergebnis; doppelte Starts werden mit HTTP 409 abgelehnt.
- SMB-Verbindung mit `connection_timeout=20`, damit ein nicht erreichbarer Host nicht ewig blockiert.

### Streaming + Multi-Turn
- `/api/ask/stream` liefert **Server-Sent Events**:
  - `event: meta` → `{sources, engine}`
  - `event: delta` → `{text}` (Token-Stücke)
  - `event: error` / `event: done`
- Pro Engine ein Streaming-Generator (`stream_local/claude/openai/gemini`).
  - **local** nutzt Ollama `/api/chat` (streamend, Multi-Turn-fähig).
- **Multi-Turn:** Frontend schickt `history` (letzte 8 Nachrichten) mit; `build_messages()`
  baut daraus die Chat-Messages, Retrieval erfolgt auf die aktuelle Frage.

### Quellen-Anzeige (relevanzgefiltert + anklickbar)
- `rank_sources()` bildet je Quelle den besten Chunk-Score, sortiert absteigend und zeigt nur
  Quellen **nahe am Top-Score** (Abstand ≤ `SOURCE_MARGIN`, Default 0.05; min. 1 Quelle).
  Statt „alle abgerufenen Dokumente" erscheint so die tatsächlich relevante Quelle (bzw. wenige).
- `meta`-Event liefert `sources` als `[{source, score}]`; das Frontend rendert sie als **Links**
  auf `/api/document?source=…` (Dateiname sichtbar, Pfad + Relevanz % im Tooltip).

---

## 4. Frontend (`backend/static/`)

| Datei | Zweck |
|---|---|
| `index.html` / `app.js` | Chat-UI: Streaming-Rendering, **Markdown** (eigener Mini-Renderer, offline), Verlauf (Multi-Turn), „＋ Neuer Chat", Engine-Auswahl, Indexierungs-Banner |
| `settings.html` / `settings.js` | Einstellungen: LLM-Zugänge, SMB-Quelle, Upload (Drag&Drop), Dokumentliste, „Abgleichen / Voll-Neuaufbau", **„Modelle abrufen"** (Ollama) |
| `style.css` | Styling (Dark, Outfit-Font) inkl. Markdown- und Modell-Chip-Styles |

---

## 5. Lokale Engine: Mac als LLM über Netbird

Die lokale Engine spricht **Ollama auf dem Mac** an — auch von extern, solange Mac und vm-rag
im Netbird-Mesh sind.

- **Mac (Ollama-Host):** `mbp-von-markus.netbird.selfhosted` / Netbird-IP **`100.94.178.115`**, LAN `192.168.1.169`.
- **Config-Wert** (`engines.local.ollama_url`): `http://100.94.178.115:11434`
  → **Netbird-IP verwenden, nicht den FQDN** (der löst im Docker-Container nicht auf).
- Installiertes Modell (Stand 2026-06-21): `gemma4:12b-mlx`.
- **Voraussetzung externer Zugriff:** Mac an, Ollama läuft, Netbird verbunden. Sonst im Chat auf OpenAI/Claude/Gemini umschalten.

### Ollama-Autostart auf dem Mac (LaunchAgent)
Datei: `~/Library/LaunchAgents/com.ollama.serve.plist`
- `ProgramArguments`: `/opt/homebrew/bin/ollama serve`
- `EnvironmentVariables`: `OLLAMA_HOST=0.0.0.0` (ans Netzwerk gebunden, sonst nur 127.0.0.1!)
- `RunAtLoad` + `KeepAlive` (Start bei Login, Neustart bei Absturz)
- Logs: `~/.ollama/launchd.{out,err}.log`

```bash
# Verwalten
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ollama.serve.plist   # laden
launchctl bootout    gui/$(id -u)/com.ollama.serve                               # entladen
launchctl print      gui/$(id -u)/com.ollama.serve                               # status
lsof -nP -iTCP:11434 -sTCP:LISTEN                                                # Bind prüfen (sollte *:11434)
```

> Hinweis: Ein LaunchAgent läuft in der **User-Session** (Login nötig). Für Apple-Silicon/Metal
> ist das korrekt. Der Mac muss also eingeloggt bleiben, damit die App ihn extern nutzen kann.

---

## 6. Konfiguration (`/opt/rag/backend/config.json`)

Wird über die Settings-UI bzw. `POST /api/config` gepflegt. Struktur (ohne Werte):
`default_engine`, `retrieval.{top_k,hybrid,rerank,candidates,rerank_model}`,
`engines.{local,claude,openai,gemini}` (`enabled/model/api_key`, local zusätzlich `ollama_url`),
`sources.smb` (`enabled/host/share/path/username/password`).

Stand 2026-06-21: `default_engine = openai`, `top_k = 4`, `hybrid = true`, `rerank = true`,
`candidates = 20`, lokale Engine aktiv auf Netbird-IP, SMB aktiv (192.168.1.5 / Wissensdatenbank / Dokumente).

---

## 7. Typische Aufgaben

```bash
# Inkrementell abgleichen (nur Änderungen)
curl -s -X POST 'http://127.0.0.1:8000/api/ingest'
# Voll-Neuaufbau
curl -s -X POST 'http://127.0.0.1:8000/api/ingest?full=true'
# Ollama-Modelle eines Hosts auflisten
curl -s 'http://127.0.0.1:8000/api/ollama/models?url=http://100.94.178.115:11434'
# Container-Logs
ssh root@192.168.1.211 'docker logs --tail 50 rag-backend'
```

### Troubleshooting lokale Engine
- **„No route to host" (Errno 113):** Ziel-IP nicht erreichbar — falsche IP oder Netbird-Peer nicht verbunden (`netbird status` auf beiden Seiten prüfen, ggf. Access-Control-Policy in der Netbird-Konsole).
- **„Connection refused" (Errno 111):** Host erreichbar, aber Ollama lauscht nur auf 127.0.0.1 → `OLLAMA_HOST=0.0.0.0` setzen und neu starten.
- **FQDN scheitert mit „Name or service not known":** im Docker-Container keine Netbird-DNS → Netbird-IP statt FQDN nutzen.

---

## 8. Sicherheit / offene Punkte

- **API-Keys jetzt via `.env`** (seit 2026-06-21): Keys liegen in `/opt/rag/.env` (Mode 600, nicht eingecheckt),
  werden über `env_file` in den Backend-Container gereicht und vom Code gelesen, wenn in `config.json` kein
  `api_key` steht. `config.json` enthält **keine** API-Keys mehr. Vorlage: `.env.example`.
  - Key ändern/rotieren: Wert in `/opt/rag/.env` setzen, dann `docker restart rag-backend`.
  - **Offen:** Der ursprüngliche OpenAI-Key war im Klartext exponiert → in der OpenAI-Konsole **neuen Key erzeugen + alten widerrufen**, neuen Wert in `.env` eintragen.
- **SMB-Passwort** steht weiterhin im Klartext in `config.json` (gemountetes Volume) — könnte analog in `.env` wandern.
- **Auth vorhanden** (seit 2026-06-22, Abschnitt 10): Login + Gruppen-ACL. **Offen bleibt TLS** — Passwörter laufen
  bis dahin über HTTP (im VPN verschlüsselt, im LAN Klartext). `users.json` (bcrypt-Hashes + TOTP-Secrets) ist gitignored.
- **Ollama an 0.0.0.0** ist im LAN **und** Mesh erreichbar. Bei Bedarf gezielt auf die Netbird-IP binden.

> **Deploy-Tipp:** Nach `scp` der `main.py` greift `--reload` meist automatisch. Hängt ein Request nach
> mehreren schnellen Edits/Recreate (HTTP 000 / Timeout), hilft `docker restart rag-backend`.

---

## 9. Historie

- **2026-06-22 (3):** **Logo austauschbar + größenverstellbar** (Settings → Allgemein → Logo; `/api/branding`
  öffentlich, `POST /api/branding/logo` admin; `branding.js` auf allen Seiten). **Chat-Tabs** wie im Browser
  (mehrere Chats parallel, je Tab eigener Verlauf in `localStorage`, „+"-Tab + ×-Schließen; „Neuer Chat" = neuer
  Tab statt Überschreiben). **Quellen listen jetzt alle relevanten Seiten** je Dokument (z. B. „S. 50, 1, 51",
  beste zuerst) statt nur der Top-Seite — `rank_sources` sammelt Seiten aller relevanten Chunks.
- **2026-06-22 (2):** **Authentifizierung + Nutzer/Gruppen + ordnerbasierte ACL** (Abschnitt 10). Neue
  `backend/auth.py`, Endpoints `/api/login`, `/api/me`, `/api/2fa/*`, `/api/admin/*`; `Depends`-Gating; ACL-Filter
  in der Suche via Payload-Feld `path_prefixes`; UIs `login.html`/`admin.html` + „Mein Konto" in den Settings.
  `requirements.txt` +`bcrypt`/`pyotp`/`qrcode` → `docker compose build backend`; einmaliger **Voll-Reindex** für
  `path_prefixes`.
- **2026-06-22:** Embedding auf **`intfloat/multilingual-e5-large`** umgestellt (NL-Fragen wurden mit MiniLM nicht
  gefunden). Auf der 8-GB-VM nötige Anpassungen: `parallel=1` + `EMBED_BATCH=16`, Reranker-Warmup standardmäßig AUS
  (`RERANK_WARMUP`), SMB-Download mit Reconnect-Retry (`smb_read_retry`) gegen Session-Ablauf bei langsamem Embedding.
  `top_k=8`, `candidates=30`. Collection neu (1024 Dim), 11 Dateien / 342 Chunks.
- **2026-06-21 (3):** **Seitengenaue Quellen** – PDFs seitenweise indiziert (`read_pages`/`ocr_pdf_pages`),
  `page` im Payload, Quelle zeigt „· S. N" und Link öffnet `#page=N`.
- **2026-06-21 (2):** **Hybrid-Suche (dense + BM25, RRF) + Cross-Encoder-Reranking**; neue Collection `rag_hybrid`
  mit benannten Vektoren; `rank_sources` auf relativen Score umgestellt; Settings-Karte „Suche & Relevanz";
  `requirements.txt` gepinnt. → einmaliger Voll-Neuaufbau + `docker compose build backend` nötig.
- **2026-06-21:** Inkrementelles Indexieren, SSE-Streaming, Multi-Turn-Verlauf, Markdown-Chat,
  „Ollama-Modelle abrufen"; lokale Engine über Netbird angebunden; Ollama-Autostart per LaunchAgent.
- Davor: funktionsfähige Basis (Chat, Settings, Upload, SMB-Ingest, 4 Engines).

---

## 10. Authentifizierung & Rechte

**Anmeldung:** `login.html` (öffentlich). User + Passwort (bcrypt), optional **TOTP-2FA** (zweiter Schritt).
Session als zufälliges Token im **HttpOnly-Cookie** `rag_session` (serverseitig im RAM gehalten → Neustart
loggt aus). Geschützte Seiten binden `guard.js` ein (holt `/api/me`, leitet sonst auf Login um). Die echte
Absicherung liegt **server-seitig** an den `/api/*`-Endpoints (FastAPI-`Depends`), nicht im Frontend.

**Rollen & Rechte:**
- **Admin:** sieht alle Dokumente, verwaltet Nutzer & Gruppen (`admin.html`), ändert Engine-/SMB-/Such-Einstellungen,
  startet Voll-Reindex.
- **Normale Nutzer:** chatten + öffnen Quellen **nur in ihren freigegebenen Ordnern**, dürfen **hochladen**
  (nur in erlaubte Ordner), eigenes Passwort/2FA verwalten („Mein Konto" in den Settings).

**Ordner-ACL (Datenrechte):** Jeder Chunk trägt im Qdrant-Payload `path_prefixes` = alle Vorgänger-Verzeichnisse
seines `source` (z. B. `Technik/Maschinen/x.pdf` → `["Technik","Technik/Maschinen"]`). Eine **Gruppe** gibt
Ordner-Präfixe frei; die erlaubten Präfixe eines Nutzers = Vereinigung seiner Gruppen. Die Suche filtert per
`MatchAny` auf `path_prefixes`; Admin = kein Filter. Damit greift die Zugriffskontrolle direkt im Retrieval
**und** beim Datei-Download (`/api/document`) und Upload.

**Erst-Admin (Bootstrap):** beim ersten Start aus `ADMIN_USER`/`ADMIN_PASSWORD` in der `.env`. Fehlt das Passwort,
wird eines generiert und **einmalig ins Log** geschrieben (`docker logs rag-backend`). Danach in „Mein Konto" ändern.

**Speicher:** `backend/users.json` (gitignored, atomar geschrieben) — Nutzer mit bcrypt-Hash + TOTP-Secret, Gruppen
mit Ordnerliste.

```bash
# Ordner anlegen + Gruppe/Nutzer pflegen → in der UI unter admin.html
# Neuer Voll-Reindex nötig, wenn path_prefixes (ACL-Feld) für Altdaten fehlt:
curl -s -b cj.txt -X POST "http://localhost:8000/api/ingest?full=true"
```

**Wichtig:** Nach dem Umbau auf department-spezifische Ordner auf der SMB-Freigabe (z. B. `Geschaeftsfuehrung/`,
`Vertrieb/`, `Technik/`, `Versand/`) einmal **abgleichen/neu indizieren**, damit die Ordner in der
Gruppen-Zuweisung (`/api/admin/folders`) auftauchen.
