'use strict';
/* Service Worker (Abschnitt 10): haelt die Dateien der App vor, damit sie ohne Netz startet.
   VERSION steht in derselben Such-und-Ersetzen-Runde wie CONFIG.version und alle ?v= (siehe js/config.js).
   Regeln:
   - Der Zwischenspeicher traegt die Version. Er wird bei der Installation vollstaendig gefuellt (alles oder nichts)
     und danach nie mehr veraendert. So laufen nie Dateien zweier Versionen gemischt.
   - Beim Aktivieren werden alle anderen Zwischenspeicher dieser App geloescht.
   - Startseite: Netz zuerst (3 s), Rueckfall auf den Zwischenspeicher. Eine neue Fassung erreicht die Nutzerin damit schon
     beim ersten Start mit Netz, ohne auf die Aktivierung des neuen Service Workers zu warten. Die Antwort wird nicht
     gespeichert (sonst verwiese die gespeicherte Startseite auf Dateien, die der Zwischenspeicher nicht hat).
   - Alle anderen Dateien: nur aus dem Zwischenspeicher, mit exakt der URL samt ?v=. Fehlt etwas, geht die Anfrage ans Netz
     (ohne zu speichern). Eine neue Seite findet ihre neuen ?v=-URLs nie beim alten Stand.
   - Fremde Adressen (api.openai.com) und alles ausser GET beruehrt dieser Worker nicht. sw.js selbst nie aus dem Speicher. */
const VERSION = '0.4.0';
const PRAEFIX = 'zeiterfassung-';
const CACHE = PRAEFIX + VERSION;
const NETZ_ZEIT_MS = 3000;

// Dateien, die die Seite mit ?v= anfragt (index.html: style.css, js/main.js; die Module importieren sich mit ?v=)
const MIT_VERSION = [
  'style.css',
  'js/main.js',
  'js/aktionen.js', 'js/categorize.js', 'js/config.js', 'js/dauerspeicher.js', 'js/db.js', 'js/key.js', 'js/log.js',
  'js/pipeline.js', 'js/recorder.js', 'js/segments.js', 'js/sicherung.js', 'js/stats.js', 'js/transcribe.js',
  'js/ui-korrektur.js', 'js/ui-record.js', 'js/ui-settings.js', 'js/ui-stats.js', 'js/zeit.js', 'js/zuordnen.js',
];
// Dateien ohne ?v=
const OHNE_VERSION = [
  './', 'index.html', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png',
];
const URLS = [...OHNE_VERSION, ...MIT_VERSION.map((p) => `${p}?v=${VERSION}`)];

self.addEventListener('install', (ev) => { ev.waitUntil(vorhalten()); });

async function vorhalten() {
  const gab = await caches.has(CACHE);
  const cache = await caches.open(CACHE);
  try {
    await Promise.all(URLS.map(async (u) => {
      const antwort = await fetch(new Request(u, { cache: 'reload' })); // am HTTP-Zwischenspeicher vorbei
      if (!antwort.ok) throw new Error(`${u}: ${antwort.status}`);
      await cache.put(u, antwort);
    }));
  } catch (e) {
    if (!gab) await caches.delete(CACHE); // halbfertigen Speicher nie stehen lassen; der alte Worker bleibt aktiv
    throw e;
  }
}

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith(PRAEFIX) && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (d.typ === 'version' && ev.ports && ev.ports[0]) ev.ports[0].postMessage({ version: VERSION });
  else if (d.typ === 'uebernehmen') self.skipWaiting(); // nur die Seite derselben Version schickt das (main.js)
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;       // api.openai.com und alles Fremde: nie ueber den Speicher
  if (url.pathname.endsWith('/sw.js')) return;           // sich selbst nie aus dem Speicher
  if (req.mode === 'navigate') {
    const basis = new URL('./', self.location).pathname;
    if (url.pathname === basis || url.pathname === `${basis}index.html`) ev.respondWith(startseite(req, url));
    return;                                               // Test- und Pruefseiten: ganz normal ueber das Netz
  }
  ev.respondWith(ausSpeicher(req));
});

function mitZeitgrenze(p, ms) {
  return new Promise((ok, nein) => { const t = setTimeout(() => nein(new Error('Zeit')), ms); p.then((x) => { clearTimeout(t); ok(x); }, (e) => { clearTimeout(t); nein(e); }); });
}

async function startseite(req, url) {
  try {
    const antwort = await mitZeitgrenze(fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }), NETZ_ZEIT_MS);
    if (antwort.ok && !antwort.redirected) return antwort;
  } catch (_) { /* kein Netz oder zu langsam: Rueckfall */ }
  const cache = await caches.open(CACHE);
  return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('./')) || (await cache.match('index.html')) || Response.error();
}

async function ausSpeicher(req) {
  const cache = await caches.open(CACHE);
  const treffer = await cache.match(req); // exakt: ?v= gehoert zur URL
  if (treffer) return treffer;
  try { return await fetch(req); } catch (_) { return Response.error(); }
}
