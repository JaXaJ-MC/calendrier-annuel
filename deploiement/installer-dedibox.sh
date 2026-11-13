#!/bin/bash
# Installe ou met à jour le calendrier JaXaJ sur la Dédibox. À lancer en root :
#   sudo bash ~/calendrier-deploy/installer-dedibox.sh
# Relançable : il met à jour le code et redémarre le service.
#
# - utilisateur jaxaj (créé s'il n'existe pas), qui sert jaxaj.maxo2.eu
# - Node dans /opt, application dans /home/jaxaj/calendrier
# - service systemd calendrier-jaxaj, qui écoute sur 127.0.0.1:8642
# - nginx : jaxaj.maxo2.eu sert /home/jaxaj/www et envoie /calendrier/ au service ;
#   en HTTPS si le certificat existe (voir https-dedibox.sh)
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
NODE_V=v24.22.3
NODE_DIR=/opt/node-$NODE_V-linux-x64
UTIL=jaxaj
HOME_J=/home/$UTIL
APP=$HOME_J/calendrier
WWW=$HOME_J/www
SERVICE=calendrier-jaxaj
DOMAINE=jaxaj.maxo2.eu
SSL=/etc/nginx/ssl/$DOMAINE
CONF=/etc/nginx/sites-available/JaXaJ.conf
MARQUE='# Géré par installer-dedibox.sh (calendrier JaXaJ)'

[ "$(id -u)" = 0 ] || { echo "À lancer avec sudo." >&2; exit 1; }

echo "1/6 Utilisateur $UTIL"
if id "$UTIL" >/dev/null 2>&1; then
  echo "    existe déjà"
else
  adduser --disabled-password --gecos "JaXaJ MC" "$UTIL"
fi

echo "2/6 Node $NODE_V dans /opt"
if [ ! -x "$NODE_DIR/bin/node" ]; then
  tar -xJf "$SRC/node-$NODE_V-linux-x64.tar.xz" -C /opt
  chown -R root:root "$NODE_DIR"
fi
"$NODE_DIR/bin/node" -v

echo "3/6 Application dans $APP"
install -d -o "$UTIL" -g "$UTIL" "$APP" "$APP/polices"
for f in calendrier.js serveur.js config.json package.json package-lock.json; do
  install -o "$UTIL" -g "$UTIL" -m 644 "$SRC/app/$f" "$APP/$f"
done
install -o "$UTIL" -g "$UTIL" -m 644 "$SRC"/app/polices/* "$APP/polices/"
sudo -u "$UTIL" -H env PATH="$NODE_DIR/bin:/usr/bin:/bin" \
  sh -c "cd '$APP' && npm ci --omit=dev --no-audit --no-fund --loglevel=error"

echo "4/6 Pages statiques dans $WWW"
install -d -o "$UTIL" -g "$UTIL" "$WWW"
if [ ! -e "$WWW/index.html" ]; then
  install -o "$UTIL" -g "$UTIL" -m 644 "$SRC/index.html" "$WWW/index.html"
fi

echo "5/6 Service systemd $SERVICE"
cat > /etc/systemd/system/$SERVICE.service <<UNIT
[Unit]
Description=Calendrier JaXaJ MC (images PNG et SVG)
After=network-online.target
Wants=network-online.target

[Service]
User=$UTIL
Group=$UTIL
WorkingDirectory=$APP
ExecStart=$NODE_DIR/bin/node serveur.js
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"

echo "6/6 nginx pour $DOMAINE"
if [ -e "$CONF" ] && ! grep -qF "$MARQUE" "$CONF"; then
  SAUVE="/root/JaXaJ.conf.avant-calendrier-$(date +%Y%m%d-%H%M%S)"
  cp -a "$CONF" "$SAUVE"
  echo "    ancienne configuration sauvegardée dans $SAUVE"
fi
PRECEDENT=$(mktemp)
[ -e "$CONF" ] && cp -a "$CONF" "$PRECEDENT"
LOCATIONS=$(cat <<BLOC
    root $WWW;
    index index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }

    # Images générées par le service $SERVICE
    location /calendrier/ {
        limit_except GET { deny all; }
        limit_req zone=calendrier_jaxaj burst=20 nodelay;
        proxy_pass http://127.0.0.1:8642;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
BLOC
)
if [ -s "$SSL/fullchain.pem" ] && [ -s "$SSL/key.pem" ]; then
  echo "    certificat présent : HTTPS, et HTTP redirigé vers HTTPS"
  cat > "$CONF" <<NGINX
$MARQUE
# Au plus 5 images par seconde et par adresse, avec une marge de 20.
limit_req_zone \$binary_remote_addr zone=calendrier_jaxaj:1m rate=5r/s;

server {
    listen 80;
    listen [::]:80;
    server_name $DOMAINE;

    # Renouvellement du certificat par acme.sh
    location /.well-known/acme-challenge/ {
        root $WWW;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAINE;

    ssl_certificate $SSL/fullchain.pem;
    ssl_certificate_key $SSL/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:ssl_jaxaj:1m;
    ssl_session_timeout 1d;

$LOCATIONS
}
NGINX
else
  cat > "$CONF" <<NGINX
$MARQUE
# Au plus 5 images par seconde et par adresse, avec une marge de 20.
limit_req_zone \$binary_remote_addr zone=calendrier_jaxaj:1m rate=5r/s;

server {
    listen 80;
    listen [::]:80;
    server_name $DOMAINE;

$LOCATIONS
}
NGINX
fi
ln -sf "$CONF" /etc/nginx/sites-enabled/JaXaJ.conf
if nginx -t 2>/dev/null; then
  systemctl reload nginx
else
  nginx -t || true
  echo "Configuration nginx refusée : retour à la précédente." >&2
  if [ -s "$PRECEDENT" ]; then cp -a "$PRECEDENT" "$CONF"; else rm -f "$CONF"; fi
  rm -f "$PRECEDENT"
  exit 1
fi
rm -f "$PRECEDENT"

echo
echo "Vérification :"
sleep 2
systemctl --no-pager --lines=0 status "$SERVICE" | head -3
if [ -s "$SSL/fullchain.pem" ]; then
  curl -sS -o /dev/null -w "  image via nginx : %{http_code} %{content_type}\n" \
    --resolve "$DOMAINE:443:127.0.0.1" "https://$DOMAINE/calendrier/auto/calendrier.png"
else
  curl -sS -o /dev/null -w "  image via nginx : %{http_code} %{content_type}\n" \
    -H "Host: $DOMAINE" http://127.0.0.1/calendrier/auto/calendrier.png
fi
