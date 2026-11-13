// Serveur du calendrier annuel : lit la feuille Google publiée en CSV et génère le
// calendrier à la volée, en SVG ou en PNG.
//
//   GET /calendrier/2027/calendrier.png         image PNG, tous les organisateurs
//   GET /calendrier/2027/bearn/calendrier.png   Béarn et organisateurs communs (Club)
//   GET /calendrier/…/calendrier.svg            même chose en SVG, pour Illustrator
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const cal = require('./calendrier.js');

const ICI = __dirname;
const FICHIER_CONFIG = path.join(ICI, 'config.json');
if (!fs.existsSync(FICHIER_CONFIG)) {
  console.error('config.json absent : copier config.example.json en config.json et y mettre le lien de la feuille.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(FICHIER_CONFIG, 'utf8'));
const PORT = Number(process.env.PORT) || config.port || 8642;
const HOTE = process.env.HOST || config.hote || '127.0.0.1';
const CACHE_MS = (config.cacheSecondes ?? 300) * 1000;
const LARGEUR_PNG = config.largeurPng || 2400;

// Réglages de base : ceux du moteur, complétés par config.json.
const BASE = Object.assign(cal.cloner(cal.DEFAUT), config.reglages || {});
BASE.couleurs = {};
for (const [nom, c] of Object.entries((config.reglages || {}).couleurs || {})) {
  const n = cal.normCouleur(c);
  if (n) BASE.couleurs[nom] = n;
}

// Le rendu PNG n'utilise que les polices du dossier polices/, pour donner la même image
// sur toutes les machines. Liberation Sans a les mêmes métriques qu'Arial.
const DOSSIER_POLICES = path.join(ICI, 'polices');
const POLICES = fs.readdirSync(DOSSIER_POLICES)
  .filter(f => /\.(ttf|otf)$/i.test(f))
  .map(f => path.join(DOSSIER_POLICES, f));

// ---------------------------------------------------------------- lecture de la feuille

function telecharger(url, sauts = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'calendrier-annuel' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && sauts < 5) {
        res.resume();
        resolve(telecharger(new URL(res.headers.location, url).href, sauts + 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`la feuille a répondu ${res.statusCode}`));
        return;
      }
      const morceaux = [];
      res.on('data', c => morceaux.push(c));
      res.on('end', () => resolve(Buffer.concat(morceaux).toString('utf8')));
    });
    req.setTimeout(10000, () => req.destroy(new Error('la feuille ne répond pas')));
    req.on('error', reject);
  });
}

const feuille = { csv: null, date: 0, enCours: null };

// Renvoie le CSV, relu au plus une fois par période de cache. Si Google ne répond pas,
// la dernière version lue sert encore.
function lireFeuille() {
  if (feuille.csv !== null && Date.now() - feuille.date < CACHE_MS) {
    return Promise.resolve(feuille.csv);
  }
  if (!feuille.enCours) {
    feuille.enCours = telecharger(config.source)
      .then(t => {
        t = t.replace(/^﻿/, '');
        if (/^\s*<(!doctype|html)/i.test(t)) throw new Error('la source renvoie une page web, pas un CSV');
        Object.assign(feuille, { csv: t, date: Date.now(), enCours: null });
        rendus.clear();
        return t;
      })
      .catch(e => {
        feuille.enCours = null;
        if (feuille.csv !== null) {
          console.error(`Feuille illisible (${e.message}) : dernière version utilisée.`);
          return feuille.csv;
        }
        throw e;
      });
  }
  return feuille.enCours;
}

// ---------------------------------------------------------------- rendu

const rendus = new Map(); // URL → image, vidé à chaque nouvelle lecture de la feuille

function enCache(cle, fabriquer) {
  if (rendus.has(cle)) return rendus.get(cle);
  const valeur = fabriquer();
  if (rendus.size >= 50) rendus.delete(rendus.keys().next().value);
  rendus.set(cle, valeur);
  return valeur;
}

function png(svg, largeur) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: largeur },
    background: '#ffffff',
    font: {
      fontFiles: POLICES,
      loadSystemFonts: false,
      defaultFontFamily: 'Liberation Sans',
      sansSerifFamily: 'Liberation Sans',
    },
  });
  return resvg.render().asPng();
}

// ---------------------------------------------------------------- HTTP

const AIDE = `Calendrier JaXaJ MC

/calendrier/<année>/calendrier.png                  tous les événements
/calendrier/<année>/<organisateur>/calendrier.png   un organisateur et le Club
/calendrier/<année>/…/calendrier.svg                même chose en SVG

<année> : 2027, auto (année en cours) ou suivante.
Exemple : /calendrier/suivante/bearn/calendrier.png
`;

function envoyer(req, res, code, type, corps, entetes = {}) {
  res.writeHead(code, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-cache' }, entetes));
  res.end(req.method === 'HEAD' ? undefined : corps);
}

// Seuls le chemin et le format sont lus : aucun paramètre d'URL n'est pris en compte,
// et l'année est bornée, pour que personne ne puisse faire générer n'importe quoi.
const ANNEES_AVANT = 2, ANNEES_APRES = 5;

async function traiter(req, res) {
  const url = new URL(req.url, 'http://serveur');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return envoyer(req, res, 405, 'text/plain; charset=utf-8', 'Méthode non autorisée');
  }
  if (url.pathname === '/' || url.pathname === '/calendrier' || url.pathname === '/calendrier/') {
    return envoyer(req, res, 200, 'text/plain; charset=utf-8', AIDE);
  }

  // /calendrier/<année>[/<organisateur>]/calendrier.<png|svg>
  const m = url.pathname.match(/^\/calendrier\/([^/]+)(?:\/([^/]+))?\/calendrier\.(svg|png)$/);
  if (!m) return envoyer(req, res, 404, 'text/plain; charset=utf-8', 'Introuvable');
  const [, segAnnee, segOrga, ext] = m;

  const maintenant = new Date().getFullYear();
  const min = maintenant - ANNEES_AVANT, max = maintenant + ANNEES_APRES;
  if (!/^(\d{4}|auto|suivante)$/.test(segAnnee) || (/^\d{4}$/.test(segAnnee) && (+segAnnee < min || +segAnnee > max))) {
    return envoyer(req, res, 404, 'text/plain; charset=utf-8',
      `Année non reconnue : de ${min} à ${max}, « auto » ou « suivante ».`);
  }

  const csv = await lireFeuille();
  const reglages = cal.cloner(BASE);
  reglages.annee = segAnnee;
  if (segOrga !== undefined) {
    const demande = cal.slug(decodeURIComponent(segOrga));
    const connus = cal.organisateurs(csv);
    if (!connus.some(o => o.slug === demande)) {
      return envoyer(req, res, 404, 'text/plain; charset=utf-8',
        `Organisateur inconnu. Organisateurs de la feuille : ${connus.map(o => o.slug).join(', ')}.`);
    }
    reglages.organisateur = demande;
  }

  const annee = cal.anneeEffective(reglages.annee);
  const image = enCache(`${ext}|${annee}|${reglages.organisateur}`, () => {
    const { svg } = cal.construire(reglages, csv);
    return ext === 'svg' ? '<?xml version="1.0" encoding="UTF-8"?>\n' + svg : png(svg, LARGEUR_PNG);
  });
  return envoyer(req, res, 200, ext === 'svg' ? 'image/svg+xml; charset=utf-8' : 'image/png', image,
    { 'Cache-Control': `public, max-age=${Math.round(CACHE_MS / 1000)}` });
}

http.createServer((req, res) => {
  traiter(req, res).catch(e => {
    console.error(e);
    if (!res.headersSent) envoyer(req, res, 502, 'text/plain; charset=utf-8', `Calendrier indisponible : ${e.message}`);
  });
}).listen(PORT, HOTE, () => {
  console.log(`Calendrier : http://${HOTE === '0.0.0.0' ? 'localhost' : HOTE}:${PORT}/`);
});
