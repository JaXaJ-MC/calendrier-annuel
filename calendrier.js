// Moteur du calendrier annuel : lecture du CSV et dessin du SVG.
'use strict';

// ---------------------------------------------------------------- constantes

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const LETTRES = ['L', 'M', 'M', 'J', 'V', 'S', 'D']; // semaine commençant le lundi
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const FORMATS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594] };
// Couleurs bien distinctes les unes des autres, lisibles avec un texte blanc ou foncé.
const PALETTE = ['#2E86AB', '#D1495B', '#6A994E', '#F3A712', '#8E5BA8', '#00A6A6',
  '#E4572E', '#3D5A80', '#7FB800', '#C2185B', '#FF8C42', '#8D6E63', '#5C6B73', '#F06292'];
const RANGS = {
  '1er': 1, '1re': 1, '1ere': 1, 'premier': 1, 'premiere': 1,
  '2e': 2, '2eme': 2, 'deuxieme': 2, 'second': 2, 'seconde': 2,
  '3e': 3, '3eme': 3, 'troisieme': 3,
  '4e': 4, '4eme': 4, 'quatrieme': 4,
  '5e': 5, '5eme': 5, 'cinquieme': 5,
  'dernier': -1, 'derniere': -1, 'avant-dernier': -2, 'avant-derniere': -2,
  'chaque': 0, 'tous les': 0, 'toutes les': 0,
};

// Réglages par défaut, complétés par ceux de config.json.
const DEFAUT = {
  annee: 'auto', // « auto » : année en cours ; « suivante » : année prochaine ; ou 2027
  format: 'A3',
  orientation: 'paysage',
  marge: 12,
  police: 'Arial',
  couleurTexte: '#1F2933',
  couleurAccent: '#1F3A5F',
  couleurWE: '#E3E7EC',
  couleurFerie: '#FDE2CF',
  weekends: true,
  feries: true,
  semaines: true,
  legende: true,
  couleurs: {},
  organisateur: '', // filtre : n'afficher que cet organisateur (et les communs) ; vide : tous
  communs: [], // organisateurs toujours affichés, même filtré (le Club)
};

// ---------------------------------------------------------------- outils

const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’`]/g, "'").toLowerCase().trim();
const MOIS_N = MOIS.map(norm);
const pad = n => String(n).padStart(2, '0');
const cle = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const f = x => Math.round(x * 100) / 100;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const largeur = (t, taille, gras) => String(t).length * taille * (gras ? 0.58 : 0.52);

function couper(t, taille, max, gras) {
  t = String(t);
  if (largeur(t, taille, gras) <= max) return t;
  const n = Math.floor(max / (taille * (gras ? 0.58 : 0.52))) - 1;
  return n <= 0 ? '' : t.slice(0, n).trimEnd() + '…';
}

function lisible(hex) {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.62 ? '#1f2933' : '#ffffff';
}

// ---------------------------------------------------------------- calendrier

function paques(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const g = Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return new Date(y, Math.floor(n / 31) - 1, (n % 31) + 1);
}

function feries(y) {
  const p = paques(y);
  const apres = n => new Date(y, p.getMonth(), p.getDate() + n);
  return new Map([
    [new Date(y, 0, 1), "Jour de l'an"],
    [apres(1), 'Lundi de Pâques'],
    [new Date(y, 4, 1), 'Fête du Travail'],
    [new Date(y, 4, 8), 'Victoire 1945'],
    [apres(39), 'Ascension'],
    [apres(50), 'Lundi de Pentecôte'],
    [new Date(y, 6, 14), 'Fête nationale'],
    [new Date(y, 7, 15), 'Assomption'],
    [new Date(y, 10, 1), 'Toussaint'],
    [new Date(y, 10, 11), 'Armistice'],
    [new Date(y, 11, 25), 'Noël'],
  ].map(([d, nom]) => [cle(d), nom]));
}

function semaineISO(dt) {
  const d = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const debut = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - debut) / 864e5 + 1) / 7);
}

// ---------------------------------------------------------------- lecture du CSV

function decouper(ligne, sep) {
  const out = [];
  let cur = '', guill = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (guill) {
      if (c === '"') {
        if (ligne[i + 1] === '"') { cur += '"'; i++; } else guill = false;
      } else cur += c;
    } else if (c === '"') guill = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function lireMois(t) {
  return t.replace(/\b(et|de|du)\b|d'/g, ' ').split(/[\s,;]+/).filter(Boolean).map(x => {
    x = x.replace(/\.$/, '');
    if (/^\d{1,2}$/.test(x) && +x >= 1 && +x <= 12) return +x - 1;
    const i = MOIS_N.findIndex(n => x.length >= 3 && n.startsWith(x));
    if (i < 0) throw new Error(`mois « ${x} » inconnu`);
    return i;
  });
}

function lireDate(t, annee) {
  t = t.trim();
  let m, y, mo, d;
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    [y, mo, d] = [+m[1], +m[2] - 1, +m[3]];
  } else if ((m = t.match(/^(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2}|\d{4}))?$/))) {
    y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : annee;
    [mo, d] = [+m[2] - 1, +m[1]];
  } else if ((m = t.match(/^(?:(?:lun|mar|mer|jeu|ven|sam|dim)[a-z]*\.? )?(1er|\d{1,2}) ([a-z]+)\.?(?: (\d{4}))?$/))) {
    const i = MOIS_N.findIndex(n => m[2].length >= 3 && n.startsWith(m[2]));
    if (i < 0) return null;
    [d, mo, y] = [m[1] === '1er' ? 1 : +m[1], i, m[3] ? +m[3] : annee];
  } else return null;
  const dt = new Date(y, mo, d);
  if (dt.getMonth() !== mo || dt.getDate() !== d) throw new Error(`date « ${t} » invalide`);
  return dt;
}

// « weekend » : le samedi et le dimanche qui suit ; le « 2e week-end » est celui du 2e samedi.
const RE_JOUR = '(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|weekend)s?';

function interpreter(brut, annee) {
  let q = norm(brut).replace(/\s+/g, ' ').replace(/week[- ]?end/g, 'weekend');
  if (!q) throw new Error('colonne « quand » vide');
  let sauf = null, seul = null, m;
  if ((m = q.match(/^(.*?) sauf (.+)$/))) { q = m[1]; sauf = lireMois(m[2]); }
  q = q.replace(/^(le|la) /, '')
    .replace(/ (de chaque mois|chaque mois|du mois|de tous les mois|tous les mois)$/, '');
  // « dernier samedi de janvier », « 1er samedi d'avril », « 2e vendredi en mars »
  if ((m = q.match(new RegExp(`^(.+? ${RE_JOUR}) (?:de |d'|du mois de |du mois d'|en )(.+)$`)))) {
    q = m[1];
    seul = lireMois(m[3]);
  }

  // Période
  const morceaux = q.split(/ ?\.\. ?| au /);
  if (morceaux.length > 2) throw new Error(`« ${brut.trim()} » : une seule période par ligne`);
  if (morceaux.length === 2) {
    const [a, b] = morceaux.map(x => x.trim());
    const fin = lireDate(b, annee);
    if (!fin) throw new Error(`fin de période « ${b} » non reconnue`);
    const debut = /^(1er|\d{1,2})$/.test(a)
      ? new Date(fin.getFullYear(), fin.getMonth(), a === '1er' ? 1 : +a)
      : lireDate(a, annee);
    if (!debut) throw new Error(`début de période « ${a} » non reconnu`);
    if (debut > fin) throw new Error(`« ${brut.trim()} » : la fin précède le début`);
    if ((fin - debut) / 864e5 > 370) throw new Error(`« ${brut.trim()} » : période de plus d'un an`);
    const jours = [];
    for (let d = debut; d <= fin; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) jours.push(d);
    return { jours, debuts: jours.map((_, i) => i === 0) };
  }

  // Journée
  const d = lireDate(q, annee);
  if (d) return { jours: [d], debuts: [true] };

  // Règle récurrente, mensuelle ou annuelle
  m = q.match(new RegExp(`^(.+?) ${RE_JOUR}$`));
  if (m && m[1] in RANGS) {
    const rang = RANGS[m[1]], we = m[2] === 'weekend';
    const jw = we ? 6 : JOURS.indexOf(m[2]);
    const jours = [], debuts = [];
    for (let mo = 0; mo < 12; mo++) {
      if (sauf && sauf.includes(mo)) continue;
      if (seul && !seul.includes(mo)) continue;
      const liste = [];
      const nb = new Date(annee, mo + 1, 0).getDate();
      for (let j = 1; j <= nb; j++) {
        const dt = new Date(annee, mo, j);
        if (dt.getDay() === jw) liste.push(dt);
      }
      const choisis = rang === 0 ? liste
        : [rang > 0 ? liste[rang - 1] : liste[liste.length + rang]].filter(Boolean);
      for (const x of choisis) {
        jours.push(x);
        debuts.push(true);
        if (we) {
          jours.push(new Date(x.getFullYear(), x.getMonth(), x.getDate() + 1));
          debuts.push(false);
        }
      }
    }
    // mensuel : la règle vaut pour plusieurs mois (« 2e vendredi »), pas pour un mois
    // précis de l'année (« dernier samedi de janvier »)
    return { jours, debuts, recurrent: true, mensuel: !seul };
  }
  throw new Error(`« ${brut.trim()} » non reconnu`);
}

// Forme d'un nom utilisable dans une URL : « Béarn » → « bearn ».
const slug = t => norm(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function separateur(lignes) {
  const premiere = lignes.find(l => l.trim() && !l.trim().startsWith('#')) || '';
  return premiere.includes(';') ? ';' : premiere.includes('\t') ? '\t' : ',';
}

// Organisateurs présents dans la feuille, toutes années confondues.
function organisateurs(csv) {
  const lignes = csv.split(/\r?\n/), sep = separateur(lignes), noms = new Map();
  lignes.forEach((l, i) => {
    if (!l.trim() || l.trim().startsWith('#')) return;
    const champs = decouper(l, sep);
    if (['quand', 'date', 'dates'].includes(norm(champs[0] || ''))) return;
    const nom = (champs[2] || '').trim() || 'Autre';
    if (!noms.has(slug(nom))) noms.set(slug(nom), nom);
  });
  return [...noms].map(([cle, nom]) => ({ slug: cle, nom }));
}

function analyser(csv, annee) {
  const evenements = [], erreurs = [];
  const lignes = csv.split(/\r?\n/);
  const sep = separateur(lignes);
  lignes.forEach((l, i) => {
    if (!l.trim() || l.trim().startsWith('#')) return;
    const champs = decouper(l, sep);
    const quand = champs[0] || '';
    if (['quand', 'date', 'dates'].includes(norm(quand))) return;
    if (!champs.some(Boolean)) return; // ligne vide d'un tableur : « ;;; »
    try {
      const r = interpreter(quand, annee);
      const garder = r.jours.map(d => d.getFullYear() === annee);
      const jours = r.jours.filter((_, j) => garder[j]);
      const debuts = r.debuts.filter((_, j) => garder[j]);
      let couleur = (champs[3] || '').trim();
      if (couleur && !/^#?[0-9a-f]{6}$/i.test(couleur)) {
        erreurs.push(`Ligne ${i + 1} : couleur « ${couleur} » ignorée (format attendu : #RRGGBB)`);
        couleur = '';
      }
      if (couleur && couleur[0] !== '#') couleur = '#' + couleur;
      if (jours.length) {
        evenements.push({
          quand: quand.trim(),
          libelle: champs[1] || '',
          cat: (champs[2] || '').trim() || 'Autre',
          couleur: couleur.toUpperCase(),
          jours,
          debuts,
          mensuel: !!r.mensuel,
        });
      }
    } catch (e) {
      erreurs.push(`Ligne ${i + 1} : ${e.message}`);
    }
  });
  return { evenements, erreurs };
}

// Clé de couleur : la couleur de l'organisateur (3e colonne), sauf pour un événement
// qui porte sa propre couleur dans le CSV.
const cleCouleur = ev => ev.couleur ? 'l:' + ev.libelle : 'c:' + ev.cat;

function cles(evenements, choix) {
  const liste = new Map();
  for (const ev of evenements) {
    const k = cleCouleur(ev);
    if (!liste.has(k)) liste.set(k, { k, propre: !!ev.couleur, nom: ev.couleur ? ev.libelle : ev.cat, csv: '' });
    if (ev.couleur && !liste.get(k).csv) liste.get(k).csv = ev.couleur;
  }
  // les organisateurs d'abord, puis les couleurs propres
  const tri = [...liste.values()].sort((a, b) => a.propre - b.propre);
  let p = 0;
  for (const e of tri) {
    const auto = PALETTE[p++ % PALETTE.length];
    e.couleur = e.csv || (!e.propre && choix[e.nom]) || auto;
  }
  return tri;
}

// Rendez-vous mensuels, regroupés par libellé, pour la légende.
function mensuels(evenements) {
  const m = new Map();
  for (const ev of evenements) {
    if (!ev.mensuel || ev.couleur) continue;
    const k = ev.cat + '\u0001' + ev.libelle;
    if (!m.has(k)) m.set(k, { ev, regles: [] });
    const e = m.get(k);
    if (!e.regles.includes(ev.quand)) e.regles.push(ev.quand);
  }
  return [...m.values()];
}

function teinte(hex, t = 0.6) {
  const n = parseInt(hex.slice(1), 16);
  return '#' + [16, 8, 0].map(s => {
    const c = (n >> s) & 255;
    return Math.round(c + (255 - c) * t).toString(16).padStart(2, '0');
  }).join('').toUpperCase();
}

// ---------------------------------------------------------------- dessin SVG

function anneeEffective(v, maintenant = new Date()) {
  const n = norm(v);
  if (n === 'suivante') return maintenant.getFullYear() + 1;
  const a = Math.trunc(+v);
  return Number.isInteger(a) && a >= 1900 && a <= 2200 ? a : maintenant.getFullYear();
}

function construire(s, csv) {
  const A = anneeEffective(s.annee);
  let [W, H] = FORMATS[s.format] || FORMATS.A3;
  if (s.orientation === 'portrait') [W, H] = [H, W];
  const u = Math.min(W, H) / 297; // 1 sur un A3
  const M = Math.max(0, +s.marge || 0);
  const C = {
    texte: s.couleurTexte, accent: s.couleurAccent, we: s.couleurWE, ferie: s.couleurFerie,
    grille: '#c9ced6', doux: '#7b8794',
  };
  const police = /\s/.test(s.police.trim()) ? `'${s.police.trim()}'` : (s.police.trim() || 'Arial');
  const famille = `${police}, Helvetica, Arial, 'Liberation Sans', sans-serif`;

  const tout = analyser(csv, A);
  const erreurs = tout.erreurs;
  const filtre = slug(s.organisateur || '');
  const communs = (s.communs || []).map(slug);
  const evenements = filtre
    ? tout.evenements.filter(e => slug(e.cat) === filtre || communs.includes(slug(e.cat)))
    : tout.evenements;
  const nomFiltre = filtre ? ((organisateurs(csv).find(o => o.slug === filtre) || {}).nom || s.organisateur) : '';
  const lesCles = cles(evenements, s.couleurs);
  const parCle = new Map(lesCles.map(e => [e.k, e.couleur]));
  // Un rendez-vous mensuel prend une teinte claire de la couleur de son organisateur,
  // avec un liseré de la couleur pleine.
  const base = ev => parCle.get(cleCouleur(ev));
  const clair = ev => ev.mensuel && !ev.couleur;
  const couleur = ev => clair(ev) ? teinte(base(ev)) : base(ev);
  const mens = mensuels(evenements);
  const fer = s.feries ? feries(A) : new Map();

  const parJour = new Map();
  for (const ev of evenements) {
    ev.jours.forEach((d, i) => {
      const k = cle(d);
      if (!parJour.has(k)) parJour.set(k, []);
      parJour.get(k).push({ ev, debut: ev.debuts[i] || d.getDate() === 1 });
    });
  }

  const G = { titre: [], cases: [], evenements: [], grille: [], jours: [], entetes: [], legende: [] };
  const T = (x, y, t, taille, o = {}) =>
    `<text x="${f(x)}" y="${f(y)}" font-family="${esc(famille)}" font-size="${f(taille)}"` +
    (o.ancre ? ` text-anchor="${o.ancre}"` : '') +
    (o.gras ? ' font-weight="700"' : '') +
    (o.italique ? ' font-style="italic"' : '') +
    ` fill="${o.fill || C.texte}">${esc(t)}</text>`;
  const R = (x, y, w, h, fill, stroke) =>
    `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill}"` +
    (stroke ? ` stroke="${stroke}" stroke-width="${f(0.2 * u)}"` : '') + '/>';

  // Titre, fixe : « Calendrier JaXaJ MC [organisateur] année »
  let y = M;
  const titre = ['Calendrier JaXaJ MC', nomFiltre, A].filter(Boolean).join(' ');
  const ts = 10 * u;
  G.titre.push(T(M, y + ts * 0.78, titre, ts, { gras: true, fill: C.accent }));
  y += ts + 5 * u;

  const o = { s, A, W, H, u, M, C, T, R, G, couleur, base, clair, fer, parJour, lesCles, mens };
  const bas = legende(o);
  const zone = { x: M, y, w: W - 2 * M, h: H - M - bas.h - y };
  grille(o, zone);
  bas.dessiner(zone.y + zone.h);

  const groupe = (id, a) => a.length ? `<g id="${id}">\n${a.join('\n')}\n</g>\n` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">\n` +
    `<rect id="page" x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>\n` +
    Object.entries(G).map(([id, a]) => groupe(id, a)).join('') + '</svg>\n';
  return { svg, erreurs, lesCles, W, H, A, trop: zone.h < 120 * u };
}

// Planning mural : 12 colonnes, 31 lignes, libellés dans les cases.
function grille(o, z) {
  const { s, A, u, C, T, R, G, couleur, base, clair, fer, parJour } = o;
  const hh = 7 * u;
  const cw = z.w / 12, rh = (z.h - hh) / 31;
  const ms = Math.min(4.2 * u, cw * 0.14);
  const fs = Math.min(rh * 0.55, 3.4 * u, cw * 0.09);
  const dz = fs * 2.7;
  for (let m = 0; m < 12; m++) {
    const x = z.x + m * cw;
    G.entetes.push(T(x + cw / 2, z.y + hh * 0.62, cap(MOIS[m]), ms, { ancre: 'middle', gras: true, fill: C.accent }));
    const nb = new Date(A, m + 1, 0).getDate();
    for (let d = 1; d <= nb; d++) {
      const dt = new Date(A, m, d), k = cle(dt), wd = (dt.getDay() + 6) % 7, we = wd >= 5;
      const ry = z.y + hh + (d - 1) * rh, ligne = ry + rh / 2 + fs * 0.35;
      const evs = parJour.get(k) || [], fe = fer.get(k);
      const lundi = s.semaines && wd === 0;
      const reserve = lundi ? fs * 2 : 0;
      G.cases.push(R(x, ry, cw, rh, fe ? C.ferie : (we && s.weekends ? C.we : '#ffffff')));
      const ex = x + dz, sw = (cw - dz) / Math.max(1, evs.length);
      evs.forEach((e, i) => {
        const col = couleur(e.ev);
        G.evenements.push(R(ex + i * sw, ry, sw, rh, col));
        const lis = clair(e.ev) ? Math.min(1.2 * u, sw / 4) : 0;
        if (lis) G.evenements.push(R(ex + i * sw, ry, lis, rh, base(e.ev)));
        if (e.debut && e.ev.libelle) {
          const t = couper(e.ev.libelle, fs * 0.9, sw - 1.6 * u - lis - reserve);
          if (t) G.jours.push(T(ex + i * sw + lis + 0.8 * u, ligne, t, fs * 0.9, { fill: lisible(col) }));
        }
      });
      if (fe && !evs.length) {
        const t = couper(fe, fs * 0.85, cw - dz - 1.6 * u - reserve);
        if (t) G.jours.push(T(ex + 0.8 * u, ligne, t, fs * 0.85, { italique: true, fill: C.doux }));
      }
      G.grille.push(R(x, ry, cw, rh, 'none', C.grille));
      G.jours.push(T(x + 0.7 * u, ligne, LETTRES[wd], fs, { gras: we, fill: we ? C.accent : C.doux }));
      G.jours.push(T(x + dz - 0.7 * u, ligne, d, fs, { ancre: 'end', gras: true }));
      if (lundi) {
        const fill = evs.length ? lisible(couleur(evs[evs.length - 1].ev)) : C.doux;
        G.jours.push(T(x + cw - 0.7 * u, ligne, 'S' + semaineISO(dt), fs * 0.7, { ancre: 'end', fill }));
      }
    }
  }
}

// Légende sous la grille. Renvoie la hauteur réservée et de quoi la dessiner.
function legende(o) {
  const { s, W, u, M, C, T, R, G, lesCles, mens, base } = o;
  const larg = W - 2 * M;
  const ls = 3.2 * u, sq = 4 * u, ligneLeg = 6.5 * u;

  const items = [];
  if (s.legende) {
    if (s.weekends) items.push({ fill: C.we, label: 'Week-end' });
    if (s.feries) items.push({ fill: C.ferie, label: 'Jour férié' });
    lesCles.forEach(e => items.push({ fill: e.couleur, label: e.nom }));
    mens.forEach(m => items.push({
      fill: teinte(base(m.ev)), barre: base(m.ev),
      // préfixer l'organisateur si le libellé ne le porte pas déjà
      label: (norm(m.ev.libelle).startsWith(norm(m.ev.cat)) ? '' : `${m.ev.cat} - `) +
        `${m.ev.libelle} (${m.regles.join(' et ')})`,
    }));
  }
  let lignes = items.length ? 1 : 0, cx = 0;
  const pos = items.map(it => {
    const w = sq + 1.5 * u + largeur(it.label, ls) + 7 * u;
    if (cx + w > larg && cx > 0) { lignes++; cx = 0; }
    const p = { x: cx, l: lignes - 1 };
    cx += w;
    return p;
  });
  const hLeg = lignes * ligneLeg;

  return {
    h: hLeg ? 5 * u + hLeg : 0,
    dessiner(y0) {
      const y = y0 + 5 * u;
      items.forEach((it, i) => {
        const x = M + pos[i].x, yy = y + pos[i].l * ligneLeg;
        G.legende.push(R(x, yy, sq, sq, it.fill, C.grille));
        if (it.barre) G.legende.push(R(x, yy, sq * 0.3, sq, it.barre));
        G.legende.push(T(x + sq + 1.5 * u, yy + sq / 2 + ls * 0.35, couper(it.label, ls, larg - sq - 2 * u), ls));
      });
    },
  };
}


// ---------------------------------------------------------------- paramètres d'URL

function normCouleur(v) {
  const m = String(v).trim().match(/^#?([0-9a-f]{6})$/i);
  return m ? '#' + m[1].toUpperCase() : null;
}

function cloner(o) { return JSON.parse(JSON.stringify(o)); }

module.exports = { DEFAUT, FORMATS, construire, analyser, organisateurs, slug, anneeEffective, normCouleur, cloner };
