# Installation – RAG Wissensdatenbank

**V1.0 · Stand: 2026-06-23**

Die Anwendung ist ein Docker-Stack aus zwei Containern:

- **rag-backend** – FastAPI + Web-UI (statisch eingebaut), Embedding/Reranking, Whisper.
- **rag-qdrant** – Vektordatenbank (Qdrant).

Modelle (Embedding `e5-large` ~2 GB, Reranker, Whisper) liegen im Volume `models`,
die eingelesene Wissensbasis im Volume `qdrant_storage`. Persistente Einstellungen
(`config.json`, `users.json`) liegen im gemounteten `backend/`-Verzeichnis.

Es gibt zwei Installationswege – je nachdem, ob der Zielserver Internet hat.

---

## Variante A – Zielserver hat Internet (Online)

Kein Export vom Quell-Server nötig.

1. Ordner `rag-wissensdatenbank/` auf den Zielserver kopieren (mindestens
   `backend/` und `docker-compose.yml`).
2. `.env` anlegen:
   ```bash
   cp .env.example .env && nano .env      # Admin, RAG_LICENSE_SECRET, ggf. Keys
   ```
3. Bauen und starten (lädt Images + Modelle automatisch, erster Start dauert):
   ```bash
   docker compose up -d --build
   ```
4. Web-UI öffnen (Port 80, alt. `:8000`), als Admin anmelden, Engines/SMB
   konfigurieren, **Lizenzschlüssel** unter *Einstellungen → Allgemein → Lizenz*
   eintragen, Dokumente indizieren.

---

## Variante B – Zielserver offline / air-gapped

Hier wird auf dem **Quell-Server** (mit laufendem Stack) ein Bundle erzeugt, das
Images **und** Modelle enthält – auf dem Ziel wird nichts heruntergeladen.

### 1. Bundle erzeugen (auf dem Quell-Server, z. B. vm-rag)
```bash
cd /opt/rag
# Skripte aus dem Repo hierher kopieren (einmalig), dann:
bash make-offline-bundle.sh                 # leere Wissensbasis
bash make-offline-bundle.sh --with-data     # inkl. vorhandenem Qdrant-Index
```
Ergebnis: `rag-wissensdatenbank-offline-JJJJMMTT.tar.gz` (~5 GB).

### 2. Auf den Zielserver kopieren & installieren
```bash
# z. B. per USB/scp auf den Zielserver bringen, dann dort:
tar xzf rag-wissensdatenbank-offline-*.tar.gz
nano .env.example   # bei Bedarf, wird als .env übernommen
bash install-offline.sh
```
Das Skript lädt die Images (`docker load`), spielt die Modelle ins Volume,
fragt nach der ausgefüllten `.env` und startet den Stack.

**Voraussetzung am Ziel:** Docker + Docker-Compose-Plugin sind installiert
(diese müssen auf einem komplett offline System vorab eingerichtet sein).

---

## Nach der Installation

- **Lizenz:** Ohne gültigen Schlüssel läuft die App 30 Tage Test + 10 Tage Kulanz,
  danach ist der Chat gesperrt. Schlüssel im Lizenz Admin (Produkt **RAGW**)
  ausstellen und in den Einstellungen eintragen. `RAG_LICENSE_SECRET` in der `.env`
  muss dem Produkt-Secret entsprechen.
- **Lokale Engine:** `OLLAMA_URL` muss auf ein vom Server erreichbares Ollama zeigen.
  Ohne lokales Ollama eine Cloud-Engine (OpenAI/Claude/Gemini) im Webinterface nutzen.
- **Mikrofon/Spracheingabe:** funktioniert nur über **HTTPS** (sicherer Kontext) –
  also hinter einem TLS-Reverse-Proxy (z. B. Nginx Proxy Manager / Caddy) betreiben.
- **QNAP/SMB:** optional, für den automatischen Dokumenten-Abgleich.
