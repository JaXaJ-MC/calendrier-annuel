#!/bin/bash
# Lance le serveur du calendrier sur ce Mac et ouvre l'image de l'année prochaine.
cd "$(dirname "$0")" || exit 1
if [ ! -d node_modules ]; then
  echo "Première utilisation : installation des dépendances…"
  npm install --omit=dev || exit 1
fi
PORT=$(node -p "require('./config.json').port || 8642")
node serveur.js &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
sleep 1
open "http://127.0.0.1:$PORT/calendrier/suivante/calendrier.png"
echo "Laisser cette fenêtre ouverte pendant l'utilisation ; la fermer arrête le serveur."
wait $PID
