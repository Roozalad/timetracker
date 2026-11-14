'use strict';
/* Prueft, dass die Dateiliste in sw.js vollstaendig ist: jede Datei, die index.html, das Manifest und (rekursiv) die
   Module laden, steht mit exakt der angefragten URL (samt ?v=) in der Liste, und es steht nichts darin, was die
   App nicht laedt. Die Quelltexte werden per fetch gelesen (tests.html erlaubt connect-src 'self'). */
import { test, gruppe, ok, eq } from './framework.js';
import { app } from './framework.js';

const { CONFIG } = await app('config');
const BASIS = new URL('../', import.meta.url);        // App-Wurzel
const rel = (u) => u.pathname.slice(BASIS.pathname.length) + u.search;
const text = async (u) => {
  for (let versuch = 1; ; versuch++) { // ein Wiederholungsversuch gegen sporadische Verbindungsabbrueche des einfachen Testservers
    try { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(`${u}: ${r.status}`); return await r.text(); }
    catch (e) { if (versuch >= 3) throw e; }
  }
};

// ---- was die App laedt
const indexText = await text(new URL('index.html', BASIS));
const doc = new DOMParser().parseFromString(indexText, 'text/html');
const verlangt = new Set(['./', 'index.html']);
const einstiege = [], indexVersionen = [];
for (const e of doc.querySelectorAll('link[href], script[src], img[src]')) {
  const u = new URL(e.getAttribute('href') || e.getAttribute('src'), BASIS);
  verlangt.add(rel(u));
  if (/\.(css|js)$/.test(u.pathname) && u.search) indexVersionen.push(u.search);
  if (u.pathname.endsWith('.js')) einstiege.push(u);
}
const manifestLink = doc.querySelector('link[rel="manifest"]');
const manifest = JSON.parse(await text(new URL(manifestLink.getAttribute('href'), BASIS)));
for (const i of manifest.icons || []) verlangt.add(rel(new URL(i.src, BASIS)));

const importe = []; // { von, spez, ziel }
const besucht = new Set();
async function durchsuche(u) {
  const schluessel = rel(u);
  if (besucht.has(schluessel)) return;
  besucht.add(schluessel); verlangt.add(schluessel);
  const quelltext = await text(u);
  const re = /(?:^|[\s;}])(?:import|export)\s*(?:[^'"`;]*?\sfrom\s*)?(['"])([^'"]+)\1|\bimport\s*\(\s*(['"])([^'"]+)\3\s*\)/g;
  let m;
  while ((m = re.exec(quelltext))) {
    const spez = m[2] || m[4];
    if (!spez.startsWith('.')) continue;
    const ziel = new URL(spez, u);
    importe.push({ von: schluessel, spez, ziel });
    await durchsuche(ziel);
  }
  if (/\bimport\s*\(\s*[^'"\s)]/.test(quelltext)) importe.push({ von: schluessel, spez: '(dynamisch, nicht prüfbar)', ziel: null });
}
for (const u of einstiege) await durchsuche(u);

// ---- was sw.js hat
const swText = await text(new URL('sw.js', BASIS));
const liste = (name) => {
  const m = new RegExp(String.raw`const ${name} = \[([\s\S]*?)\];`).exec(swText);
  if (!m) throw new Error(`${name} fehlt in sw.js`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};
const swVersion = (/const VERSION = '([^']+)'/.exec(swText) || [])[1];
const swUrls = [...liste('OHNE_VERSION'), ...liste('MIT_VERSION').map((p) => `${p}?v=${swVersion}`)];

gruppe('Service Worker: Dateiliste und Version');
test('sw.js: VERSION gleich CONFIG.version', () => eq(swVersion, CONFIG.version));
test('index.html: alle ?v= gleich CONFIG.version', () => {
  ok(indexVersionen.length >= 2, 'weniger ?v= als erwartet');
  for (const x of indexVersionen) eq(x, `?v=${CONFIG.version}`, 'index.html');
});
test('jeder Import eines Moduls trägt ?v= der aktuellen Version', () => {
  ok(importe.length > 20, `nur ${importe.length} Importe gefunden, Erkennung kaputt?`);
  const schlecht = importe.filter((i) => !i.ziel || new URL(i.ziel).search !== `?v=${CONFIG.version}`).map((i) => `${i.von}: ${i.spez}`);
  eq(schlecht, []);
});
test('die Erkennung findet die bekannten Module', () => {
  for (const p of ['js/main.js', 'js/config.js', 'js/db.js', 'js/ui-record.js', 'js/sicherung.js', 'js/dauerspeicher.js']) ok(verlangt.has(`${p}?v=${CONFIG.version}`), p);
});
test('Liste in sw.js enthält jede geladene Datei', () => {
  const fehlt = [...verlangt].filter((p) => !swUrls.includes(p));
  eq(fehlt, []);
});
test('Liste in sw.js enthält nichts, was die App nicht lädt', () => {
  const zuviel = swUrls.filter((p) => !verlangt.has(p));
  eq(zuviel, []);
});
test('keine Test- oder Prüfseiten in der Liste', () => {
  eq(swUrls.filter((p) => /tests?\.html|prompt-test|testdaten|^tests\//.test(p)), []);
});
test('keine doppelten Einträge in der Liste', () => eq(new Set(swUrls).size, swUrls.length));
test('jede Datei der Liste ist erreichbar', async () => {
  const kaputt = [];
  for (const p of swUrls) { try { const r = await fetch(new URL(p, BASIS), { cache: 'no-store' }); if (!r.ok) kaputt.push(`${p}: ${r.status}`); } catch (e) { kaputt.push(`${p}: ${e.message}`); } }
  eq(kaputt, []);
});
