# Calendrier annuel

Génère à la volée le calendrier de l'année, en PNG ou en SVG, à partir d'une feuille Google Sheets publiée en CSV. L'adresse de l'image ne change pas : l'image affichée est toujours celle de la feuille du moment, au cache près.

## Lancer

Copier `config.example.json` en `config.json` et y mettre le lien de la feuille (clé `source`). `config.json` n'est pas versionné : le lien publié donne accès en lecture à la feuille.

Sur un Mac : double-cliquer sur `Ouvrir le calendrier.command`. Il installe les dépendances la première fois, démarre le serveur et ouvre l'image de l'année prochaine.

Ailleurs : `npm install --omit=dev` puis `npm start` (Node 16 ou plus).

Avec Docker : `docker build -t calendrier-annuel .` puis `docker run -d -p 8642:8642 calendrier-annuel`.

Le serveur relit `config.json` au démarrage : le redémarrer après une modification.

## Adresses

| Adresse | Contenu |
|---|---|
| `/calendrier/` | aide : la liste des adresses |
| `/calendrier/2027/calendrier.png` | l'image PNG de 2027, tous les organisateurs |
| `/calendrier/2027/bearn/calendrier.png` | les événements du Béarn et des organisateurs communs (le Club) |
| `/calendrier/…/calendrier.svg` | la même chose en SVG, à retoucher dans Illustrator |

L'année vaut `2027`, `auto` (année en cours) ou `suivante` (année prochaine) : `/calendrier/suivante/calendrier.png` montre toujours l'année à venir sans jamais changer de lien. Une année chiffrée est acceptée de deux ans avant à cinq ans après l'année en cours. L'organisateur s'écrit comme dans la feuille, sans accent ni majuscule : `bearn`, `euskadi`. Une année ou un organisateur inconnu renvoie une erreur 404 qui donne les valeurs possibles.

Le titre est fixe : « Calendrier JaXaJ MC », suivi de l'organisateur filtré puis de l'année.

Aucun paramètre d'URL n'est lu : tout ce qui suit un `?` est ignoré. La présentation (format, couleurs, largeur du PNG…) se règle uniquement dans `config.json`, pour que personne ne puisse faire générer autre chose que les images prévues.

Pour afficher l'image sur un site : `<img src="https://jaxaj.maxo2.eu/calendrier/2027/bearn/calendrier.png" alt="Calendrier Béarn 2027">`.

## La feuille

Colonnes `quand`, `libellé`, `organisateur` et, facultative, `couleur` (`#RRGGBB`). Une ligne dont la première cellule commence par `#` est ignorée.

La colonne `quand` accepte une date (`2027-03-13`, `13/03/2027`, `13 mars`), une période (`2027-09-10..2027-09-12`, `10/04 au 11/04`), une règle mensuelle (`2e vendredi`, `dernier vendredi sauf juillet, août`, `chaque mardi`), une règle annuelle (`dernier samedi de janvier`, `1er samedi d'avril`) ou un week-end (`2e week-end de janvier`, compté à partir de son samedi). Les dates sans année et les règles valent pour toutes les années.

Chaque organisateur a sa couleur. Un rendez-vous mensuel en prend une teinte claire, bordée de la couleur pleine. Une couleur en 4e colonne s'impose et donne à l'événement sa propre ligne de légende.

Pour publier la feuille : Fichier › Partager › Publier sur le Web, format CSV. Le lien obtenu va dans `config.json`, clé `source`.

## config.json

Modèle : `config.example.json`.

| Clé | Rôle |
|---|---|
| `source` | lien de la feuille publiée en CSV |
| `hote`, `port` | adresse d'écoute ; les variables d'environnement `HOST` et `PORT` les remplacent (le Dockerfile met `HOST=0.0.0.0`) |
| `cacheSecondes` | durée pendant laquelle la feuille et les images restent en cache ; c'est le délai maximal avant qu'une modification de la feuille apparaisse, auquel s'ajoute celui de Google (quelques minutes) |
| `largeurPng` | largeur du PNG en pixels |
| `reglages` | présentation : `format` (`A4` à `A1`), `orientation` (`paysage`, `portrait`), `marge` (mm), `weekends`, `feries`, `semaines`, `legende` (`true`/`false`), `couleurTexte`, `couleurAccent`, `couleurWE`, `couleurFerie`, `police` (SVG) ; `couleurs` associe un organisateur à sa couleur ; `communs` liste les organisateurs affichés avec chacun des autres (`["Club"]`) |

Si Google ne répond pas, le serveur continue de servir la dernière version lue de la feuille.

## Fichiers

- `calendrier.js` : lecture de la feuille et dessin du SVG.
- `serveur.js` : serveur HTTP, cache et rendu PNG avec resvg.
- `polices/` : polices du rendu PNG. Liberation Sans a les mêmes métriques qu'Arial ; licence SIL OFL dans `LICENCE-Liberation.txt`. Une police ajoutée ici est utilisable par le réglage `police`.

## Déploiement sur la Dédibox

`deploiement/installer-dedibox.sh` installe ou met à jour le calendrier sur la Dédibox : utilisateur `jaxaj`, Node dans `/opt`, application dans `/home/jaxaj/calendrier`, service systemd `calendrier-jaxaj` sur `127.0.0.1:8642`, et nginx qui sert `jaxaj.maxo2.eu` depuis `/home/jaxaj/www` en envoyant `/calendrier/` au service, avec au plus 5 images par seconde et par adresse. Il attend à côté de lui un dossier `app/` (les fichiers de l'application et `polices/`), `index.html` et l'archive de Node. Il se lance en root : `sudo bash ~/calendrier-deploy/installer-dedibox.sh`. La configuration nginx qu'il remplace est sauvegardée dans `/root`.

`deploiement/https-dedibox.sh` passe `jaxaj.maxo2.eu` en HTTPS : il installe acme.sh dans `/root/.acme.sh` (le certbot de Debian 10 est trop ancien), obtient un certificat Let's Encrypt par la méthode webroot, l'installe dans `/etc/nginx/ssl/jaxaj.maxo2.eu`, puis relance `installer-dedibox.sh`, qui écrit la configuration HTTPS dès que le certificat existe et redirige HTTP vers HTTPS. acme.sh renouvelle le certificat par cron et recharge nginx. Il attend à côté de lui l'archive `acme.sh-3.1.6.tar.gz`. Il se lance en root : `sudo bash ~/calendrier-deploy/https-dedibox.sh`.
