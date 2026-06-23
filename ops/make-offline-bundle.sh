#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Erzeugt ein vollstaendiges Offline-Installations-Bundle der RAG Wissensdatenbank.
# Auf dem QUELL-Server (mit laufendem Stack) im Stack-Verzeichnis ausfuehren:
#
#   cd /opt/rag
#   bash make-offline-bundle.sh [--with-data] [-o /pfad/bundle.tar.gz]
#
#   --with-data   auch den Qdrant-Index (eingelesene Wissensbasis) mitnehmen.
#                 Ohne diese Option startet das Ziel mit leerer Wissensbasis.
#
# Ergebnis: ein einzelnes .tar.gz, das auf einen beliebigen (auch offline)
# Server kopiert und dort mit install-offline.sh installiert wird.
# ---------------------------------------------------------------------------
set -euo pipefail

STACK_DIR="$(pwd)"
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="${COMPOSE_PROJECT:-rag}"          # Volume-Praefix der Quelle (rag_models, rag_qdrant_storage)
BACKEND_IMAGE="rag-backend:latest"
QDRANT_IMAGE="qdrant/qdrant:latest"
WITH_DATA=0
OUT="rag-wissensdatenbank-offline-$(date +%Y%m%d).tar.gz"

while [ $# -gt 0 ]; do
  case "$1" in
    --with-data) WITH_DATA=1 ;;
    -o) shift; OUT="$1" ;;
    *) echo "Unbekannte Option: $1"; exit 1 ;;
  esac; shift
done

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
echo "==> Arbeitsverzeichnis: $WORK"

echo "==> Docker-Images exportieren ($BACKEND_IMAGE, $QDRANT_IMAGE)…"
docker save "$BACKEND_IMAGE" "$QDRANT_IMAGE" | gzip > "$WORK/images.tar.gz"

echo "==> Modell-Volume exportieren (${PROJECT}_models, ~4 GB)…"
docker run --rm -v "${PROJECT}_models":/v -v "$WORK":/out alpine \
  tar czf /out/models.tar.gz -C /v .

if [ "$WITH_DATA" = "1" ]; then
  echo "==> Qdrant-Index exportieren (${PROJECT}_qdrant_storage)…"
  docker run --rm -v "${PROJECT}_qdrant_storage":/v -v "$WORK":/out alpine \
    tar czf /out/qdrant-data.tar.gz -C /v .
fi

echo "==> Anwendungscode beilegen (ohne Secrets)…"
mkdir -p "$WORK/backend"
# Code mitnehmen, aber NICHT die instanz-spezifischen/geheimen Dateien
tar -C "$STACK_DIR/backend" \
    --exclude='config.json' --exclude='users.json' \
    --exclude='__pycache__' --exclude='*.pyc' \
    -cf - . | tar -C "$WORK/backend" -xf -

echo "==> Compose + Installer + Vorlagen beilegen…"
cp "$SELF_DIR/docker-compose.offline.yml" "$WORK/docker-compose.yml"
cp "$SELF_DIR/install-offline.sh"         "$WORK/install-offline.sh"
[ -f "$STACK_DIR/.env.example" ] && cp "$STACK_DIR/.env.example" "$WORK/.env.example"
[ -f "$SELF_DIR/../INSTALL.md" ] && cp "$SELF_DIR/../INSTALL.md" "$WORK/INSTALL.md"

echo "==> Bundle packen → $OUT"
tar czf "$OUT" -C "$WORK" .
echo "==> Fertig: $OUT ($(du -h "$OUT" | cut -f1))"
echo "    Auf den Zielserver kopieren, entpacken, dann: bash install-offline.sh"
