#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "╔══════════════════════════════════════╗"
echo "║       Déploiement vers Firebase      ║"
echo "╚══════════════════════════════════════╝"
echo ""

# Check for changes
if git diff --quiet && git diff --cached --quiet; then
  echo "ℹ️  Aucun changement local à commiter."
else
  echo "Fichiers modifiés :"
  git diff --name-only
  git diff --cached --name-only
  echo ""
  read -p "Message de commit (Entrée = date automatique) : " MSG
  MSG="${MSG:-Mise à jour $(date '+%Y-%m-%d %H:%M')}"
  git add -A
  git commit -m "$MSG"
fi

echo ""
echo "⬆  Envoi vers GitHub..."
git push --no-verify origin main

echo ""
echo "✓ Déployé ! L'app sera disponible dans ~1 min :"
echo "  https://agenda-c6346.web.app"
echo ""
echo "Appuie sur Entrée pour fermer..."
read
