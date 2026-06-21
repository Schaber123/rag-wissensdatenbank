# RAG / Wissens-Chat (Tech-IT Consulting)

Interner Wissens-Chat: stellt Fragen zu Dokumenten und beantwortet sie ausschließlich
aus den hinterlegten Quellen (Retrieval-Augmented Generation). Mehrere LLM-Engines
wählbar (lokal auf dem Mac via Ollama, OpenAI, Claude, Gemini).

> Diese Doku enthält **keine Secrets**. API-Keys und das SMB-Passwort liegen ausschließlich
> in `config.json` auf dem Server (siehe „Sicherheit").

---

## 1. Wo läuft was

| | |
|---|---|
| **Produktivserver** | `vm-rag` — **192.168.1.211** (Debian 13), Zugang: `ssh root@192.168.1.211` |
| **App-Verzeichnis (Server)** | `/opt/rag` (kein Git-Repo) |
| **Lokale Arbeitskopie** | `rag-app/` im Workspace (Git-Repo, Sicherungs-/Versionsstand) |
| **Web-App** | `http://192.168.1.211` (Port 80) bzw. `:8000`. Im Mesh: vm-rag Netbird-IP `100.94.149.70` |
| **Netbird** | vm-rag: `vm-rag.netbird.selfhosted` / `100.94.149.70` · Management `netbird.techit-consulting.de` |

### Deploy-Modell
Das Backend läuft im Docker-Container `rag-backend` mit `uvicorn --reload`, und
`/opt/rag/backend` ist in den Container gemountet. **Codeänderungen greifen ohne Rebuild**
— einfach die Datei per `scp` ersetzen, uvicorn lädt automatisch neu.
Ein Rebuild ist nur bei Änderung von `requirements.txt` nötig.

```bash
# Backend deployen
scp rag-app/backend/main.py root@192.168.1.211:/opt/rag/backend/main.py
# Frontend deployen
scp rag-app/backend/static/* root@192.168.1.211:/opt/rag/backend/static/
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
Wissensquelle: SMB-Share auf QNAP 192.168.1.5 / "Wissensdatenbank" / Unterordner "Dokumente"
```

- **Docker-Compose:** `/opt/rag/docker-compose.yml` — Services `qdrant`, `backend`, optional `app` (Profil `tools`).
- **Collection:** `rag_test` (Cosine).
- **Embedding-Modell:** `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` (384 Dim, mehrsprachig),
  gesetzt über `EMBED_MODEL` in `docker-compose.yml`.
  - Gewählt wegen Tempo: auf der 4-Core-VM ~**0,01 s/Chunk** statt ~3 s/Chunk bei e5-large (Faktor ~300).
  - `BAAI/bge-m3` wird von dieser fastembed-Version **nicht** unterstützt → lief früher auf dem langsamen
    Fallback `intfloat/multilingual-e5-large`. Das war die Ursache für „hängende"/sehr langsame Indexierungen.
  - **Modellwechsel = anderes Vektorformat** → danach **Voll-Neuaufbau** nötig (`/api/ingest?full=true`).
  - E5-Modelle bräuchten `query:`/`passage:`-Präfixe (`IS_E5` im Code); bei MiniLM aus (korrekt).
- **Chunking:** 1000 Zeichen, 150 Überlappung.
- **Unterstützte Dateitypen** (`EXTS` / `read_text_bytes`):
  PDF, Word `.docx`, Excel `.xlsx`/`.xls`, PowerPoint `.pptx`, CSV, Text `.txt`/`.md`,
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
| GET | `/api/document?source=<rel>` | Datei vom QNAP abrufen/öffnen (PDF inline). Nur indizierte Quellen erlaubt (kein Path-Traversal) |
| POST | `/api/upload` | Dateien hochladen → auf QNAP schreiben + indizieren |
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
`default_engine`, `retrieval.top_k`, `engines.{local,claude,openai,gemini}`
(`enabled/model/api_key`, local zusätzlich `ollama_url`), `sources.smb`
(`enabled/host/share/path/username/password`).

Stand 2026-06-21: `default_engine = openai`, `top_k = 4`, lokale Engine aktiv auf Netbird-IP,
SMB aktiv (QNAP 192.168.1.5 / Wissensdatenbank / Dokumente).

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
- **Kein Auth** auf der Web-App — jeder im erreichbaren Netz kann sie nutzen. Für externen Betrieb ggf. Zugriffsschutz vorsehen.
- **Ollama an 0.0.0.0** ist im LAN **und** Mesh erreichbar. Bei Bedarf gezielt auf die Netbird-IP binden.

> **Deploy-Tipp:** Nach `scp` der `main.py` greift `--reload` meist automatisch. Hängt ein Request nach
> mehreren schnellen Edits/Recreate (HTTP 000 / Timeout), hilft `docker restart rag-backend`.

---

## 9. Historie

- **2026-06-21:** Inkrementelles Indexieren, SSE-Streaming, Multi-Turn-Verlauf, Markdown-Chat,
  „Ollama-Modelle abrufen"; lokale Engine über Netbird angebunden; Ollama-Autostart per LaunchAgent.
- Davor: funktionsfähige Basis (Chat, Settings, Upload, SMB-Ingest, 4 Engines).
