#!/bin/bash
# Passe jaxaj.maxo2.eu en HTTPS avec un certificat Let's Encrypt. À lancer en root :
#   sudo bash ~/calendrier-deploy/https-dedibox.sh
# Relançable. acme.sh (client ACME en shell, le certbot de Debian 10 est trop ancien)
# est installé dans /root/.acme.sh et renouvelle le certificat tout seul par cron.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
ACME_V=3.1.6
ACME_HOME=/root/.acme.sh
ACME="$ACME_HOME/acme.sh --home $ACME_HOME"
DOMAINE=jaxaj.maxo2.eu
WWW=/home/jaxaj/www
SSL=/etc/nginx/ssl/$DOMAINE

[ "$(id -u)" = 0 ] || { echo "À lancer avec sudo." >&2; exit 1; }
[ -d "$WWW" ] || { echo "$WWW absent : lancer d'abord installer-dedibox.sh." >&2; exit 1; }

echo "1/4 acme.sh $ACME_V"
if [ ! -x "$ACME_HOME/acme.sh" ]; then
  T=$(mktemp -d)
  tar -xzf "$SRC/acme.sh-$ACME_V.tar.gz" -C "$T"
  (cd "$T/acme.sh-$ACME_V" && ./acme.sh --install --home "$ACME_HOME" --no-profile)
  rm -rf "$T"
fi
$ACME --set-default-ca --server letsencrypt

echo "2/4 Certificat Let's Encrypt pour $DOMAINE"
code=0
$ACME --issue -d "$DOMAINE" -w "$WWW" --keylength ec-256 || code=$?
case $code in
  0) ;;
  2) echo "    certificat déjà valide, pas de renouvellement nécessaire" ;;
  *) echo "Échec de l'obtention du certificat (code $code)." >&2; exit 1 ;;
esac

echo "3/4 Installation du certificat dans $SSL"
install -d -m 700 "$SSL"
$ACME --install-cert -d "$DOMAINE" --ecc \
  --key-file "$SSL/key.pem" \
  --fullchain-file "$SSL/fullchain.pem" \
  --reloadcmd "systemctl reload nginx"

echo "4/4 nginx en HTTPS"
bash "$SRC/installer-dedibox.sh"

echo
echo "Renouvellement automatique :"
crontab -l 2>/dev/null | grep acme.sh || echo "  ATTENTION : aucune tâche cron acme.sh trouvée"
