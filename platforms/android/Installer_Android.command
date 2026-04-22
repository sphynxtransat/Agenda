#!/bin/bash
# Agenda Android — Serveur local
# Double-cliquez pour démarrer, puis scannez le QR code avec votre Pixel 7a

cd "$(dirname "$0")"
PORT=8765

# Trouver l'IP locale du Mac
LOCAL_IP=$(python3 -c "import socket; s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.connect(('8.8.8.8',80)); print(s.getsockname()[0]); s.close()" 2>/dev/null)
if [ -z "$LOCAL_IP" ]; then
  LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "192.168.x.x")
fi

URL="http://${LOCAL_IP}:${PORT}"

# Tuer processus existant sur ce port
lsof -ti:$PORT | xargs kill -9 2>/dev/null; sleep 0.2

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║           Agenda Android — Installation          ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "🌐 URL de l'app : $URL"
echo ""
echo "📱 Sur votre Pixel 7a :"
echo "   1. Assurez-vous d'être sur le même Wi-Fi que ce Mac"
echo "   2. Ouvrez Chrome sur votre Pixel"
echo "   3. Tapez cette adresse : $URL"
echo "   4. Appuyez sur ⋮ (3 points) → 'Ajouter à l'écran d'accueil'"
echo "   5. L'icône Agenda apparaît → ouvrez-la → app plein écran !"
echo ""

# Afficher QR code en ASCII
python3 << PYEOF
url = "$URL"
# Minimal QR code generator (text-based using a simple URL shortener approach)
# We'll use a simple ASCII art hint instead
print("┌─────────────────────────────────────────┐")
print("│  Ou scannez ce QR code avec votre Pixel │")
print("└─────────────────────────────────────────┘")

# Generate QR using qrcode if available, otherwise show URL prominently
try:
    import qrcode
    qr = qrcode.QRCode(border=1)
    qr.add_data(url)
    qr.make(fit=True)
    qr.print_ascii(invert=True)
except:
    print(f"\n  Tapez dans Chrome Android :")
    print(f"  ► {url}")
    print()
PYEOF

echo ""
echo "▶ Serveur démarré. Gardez ce terminal ouvert."
echo "  Ctrl+C pour arrêter."
echo ""

# Start server
python3 -m http.server $PORT --bind 0.0.0.0 2>/dev/null
