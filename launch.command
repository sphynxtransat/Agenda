#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "🔄 Mise à jour depuis GitHub..."
git pull --quiet && echo "✓ À jour" || echo "⚠️  Pas de connexion, version locale utilisée"
echo ""

cd "$DIR/shared/web"

# Kill any existing server on port 8080
lsof -ti:8080 | xargs kill -9 2>/dev/null

echo "▶ Démarrage du serveur local..."
python3 -m http.server 8080 &
SERVER_PID=$!

sleep 0.6
open http://localhost:8080
echo "✓ App ouverte sur http://localhost:8080"
echo "  Ferme cette fenêtre pour arrêter le serveur."
echo ""

wait $SERVER_PID
