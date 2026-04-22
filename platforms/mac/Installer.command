#!/bin/bash
cd "$(dirname "$0")"

echo "╔══════════════════════════════════════╗"
echo "║       Installation d'Agenda          ║"
echo "╚══════════════════════════════════════╝"
echo ""

APP="AgendaApp.app"
DEST="/Applications/AgendaApp.app"

if [ ! -d "$APP" ]; then
  echo "❌  AgendaApp.app introuvable dans ce dossier."
  read -p "Appuyez sur Entrée pour fermer…"; exit 1
fi

echo "🔧  Correction des permissions…"
chmod +x "$APP/Contents/MacOS/Agenda"

echo "🔓  Suppression de la quarantaine Apple…"
xattr -rd com.apple.quarantine "$APP" 2>/dev/null || true

echo "🗑   Suppression de l'ancienne version…"
rm -rf "$DEST"

echo "📂  Copie dans /Applications…"
cp -R "$APP" /Applications/
echo "    ✓ Copié dans /Applications"

echo "🔨  Compilation Swift (première fois uniquement ~15s)…"
SWIFT_SRC="$DEST/Contents/Resources/AppMain.swift"
BINARY="$DEST/Contents/MacOS/AgendaBinary"

if ! command -v swiftc &>/dev/null; then
  echo "    ⚠ swiftc introuvable — installation des outils Xcode requise"
  xcode-select --install 2>/dev/null
  echo "    Relancez cet installeur après l'installation des outils Xcode."
  read -p "Appuyez sur Entrée pour fermer…"; exit 1
fi

swiftc "$SWIFT_SRC" -framework WebKit -framework Cocoa -O -o "$BINARY" 2>/tmp/agenda_err.txt
if [ $? -ne 0 ]; then
  echo "❌  Erreur de compilation :"
  cat /tmp/agenda_err.txt | head -10
  read -p "Appuyez sur Entrée pour fermer…"; exit 1
fi
chmod +x "$BINARY"
echo "    ✓ Compilation réussie"

echo ""
echo "🚀  Lancement d'Agenda…"
open "$DEST"

echo ""
echo "✅  Agenda est installé et lancé !"
sleep 3
