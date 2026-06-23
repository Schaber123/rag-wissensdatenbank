#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Installiert die RAG Wissensdatenbank aus einem Offline-Bundle.
# Auf dem ZIEL-Server im entpackten Bundle-Verzeichnis ausfuehren:
#
#   tar xzf rag-wissensdatenbank-offline-*.tar.gz
#   bash install-offline.sh
#
# Voraussetzung: Docker + Docker-Compose-Plugin sind installiert.
# ---------------------------------------------------------------------------
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECT="rag-wissensdatenbank"   # muss zum 'name:' in docker-compose.yml passen

command -v docker >/dev/null || { echo "FEHLER: Docker ist nicht installiert."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "FEHLER: 'docker compose' fehlt."; exit 1; }

echo "==> Docker-Images laden…"
gunzip -c "$HERE/images.tar.gz" | docker load

echo "==> Volumes anlegen…"
docker volume create "${PROJECT}_models" >/dev/null
docker volume create "${PROJECT}_qdrant_storage" >/dev/null

echo "==> Modelle einspielen (~4 GB, dauert kurz)…"
docker run --rm -v "${PROJECT}_models":/v -v "$HERE":/in alpine \
  sh -c "tar xzf /in/models.tar.gz -C /v"

if [ -f "$HERE/qdrant-data.tar.gz" ]; then
  echo "==> Qdrant-Index einspielen…"
  docker run --rm -v "${PROJECT}_qdrant_storage":/v -v "$HERE":/in alpine \
    sh -c "tar xzf /in/qdrant-data.tar.gz -C /v"
fi

if [ ! -f "$HERE/.env" ]; then
  cp "$HERE/.env.example" "$HERE/.env" 2>/dev/null || touch "$HERE/.env"
  echo
  echo "!! WICHTIG: Bitte $HERE/.env ausfuellen, bevor du fortfaehrst:"
  echo "   - ADMIN_USER / ADMIN_PASSWORD (Erst-Admin)"
  echo "   - RAG_LICENSE_SECRET (Produkt-Secret aus dem Lizenz Admin)"
  echo "   - OLLAMA_URL (falls lokale LLM-Engine genutzt wird)"
  echo "   - ggf. API-Keys (OPENAI_API_KEY etc.)"
  echo
  read -r -p "Enter druecken, wenn .env fertig ist (Strg+C zum Abbrechen)… " _
fi

echo "==> Stack starten…"
docker compose -f "$HERE/docker-compose.yml" up -d

echo
echo "==> Fertig. Web-UI: http://<server>  (Port 80, alternativ :8000)"
echo "    Danach: anmelden (Admin aus .env), Engines/SMB konfigurieren,"
echo "    Lizenzschluessel eintragen, Dokumente indizieren."
