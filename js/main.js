'use strict';
/* Start, Navigation, Verdrahtung. */
import { CONFIG } from './config.js?v=0.4.1';
import { log } from './log.js?v=0.4.1';
import * as db from './db.js?v=0.4.1';
import * as pipeline from './pipeline.js?v=0.4.1';
import { zuordnen } from './zuordnen.js?v=0.4.1';
import { fordereAn } from './dauerspeicher.js?v=0.4.1';
import { initRecord } from './ui-record.js?v=0.4.1';
import { initStats } from './ui-stats.js?v=0.4.1';
import { initSettings } from './ui-settings.js?v=0.4.1';

const $ = (id) => document.getElementById(id);

/** Service Worker (Abschnitt 10). Eine neue Version wartet, bis diese Seite dieselbe Version hat wie der wartende Worker:
    erst dann uebernimmt er (skipWaiting), sonst beim naechsten Start. So laeuft nie Seite und Speicher in zwei Versionen. */
function frageVersion(w) {
  return new Promise((ok) => {
    const k = new MessageChannel(), t = setTimeout(() => ok(null), 3000);
    k.port1.onmessage = (e) => { clearTimeout(t); ok(e.data && e.data.version); };
    try { w.postMessage({ typ: 'version' }, [k.port2]); } catch (_) { clearTimeout(t); ok(null); }
  });
}
async function registriereOffline() {
  if (!('serviceWorker' in navigator)) { log('Service Worker: nicht verfügbar'); return; }
  try {
    const reg = await navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' });
    log(`Service Worker registriert (Scope ${new URL(reg.scope).pathname})`);
    const pruefe = async (w) => {
      const v = await frageVersion(w);
      if (v === CONFIG.version) { log(`Service Worker ${v} übernimmt`); w.postMessage({ typ: 'uebernehmen' }); }
      else log(`Service Worker ${v || '?'} wartet auf den nächsten Start`);
    };
    if (reg.waiting && navigator.serviceWorker.controller) pruefe(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) pruefe(w); });
    });
    // iOS prueft nur beim Kaltstart auf eine neue sw.js: bei Rueckkehr in den Vordergrund (hoechstens alle 10 min) nachsehen
    let zuletzt = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || Date.now() - zuletzt < 600000) return;
      zuletzt = Date.now(); reg.update().catch(() => {});
    });
  } catch (e) { log(`Service Worker nicht registriert: ${(e && e.message) || e}`); }
}

async function start() {
  $('jsver').textContent = `js ${CONFIG.version}`;
  log(`start v${CONFIG.version} ${navigator.userAgent}`);
  log(`standalone=${window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches} mediaRecorder=${typeof MediaRecorder !== 'undefined'}`);

  let dbFehler = null;
  try { await db.oeffneDb(); } catch (e) { dbFehler = e; log(`IndexedDB nicht nutzbar: ${e && e.message}`); }
  fordereAn(); // dauerhafter Speicher: Ergebnis im Protokoll und unter Einstellungen > Info

  pipeline.registriereZuordnung(zuordnen); // Schritt 3: Zuordnung mit categorize, Segmente speichern

  // Navigation
  const ansichten = {};
  const zeigeAnsicht = (name, ziel) => {
    for (const [n, a] of Object.entries(ansichten)) a.sec.hidden = n !== name;
    for (const b of document.querySelectorAll('.nav button')) {
      if (b.dataset.view === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    ansichten[name].api.zeige();
    if (ziel && ansichten[name].api.springe) ansichten[name].api.springe(ziel);
  };
  const ctx = { zeigeAnsicht, dbFehler };
  ansichten.record = { sec: $('view-record'), api: initRecord($('view-record'), ctx) };
  ansichten.stats = { sec: $('view-stats'), api: initStats($('stats-body')) };
  ansichten.settings = { sec: $('view-settings'), api: initSettings($('settings-body'), { schluesselGeaendert: pipeline.schluesselGeaendert }) };
  for (const b of document.querySelectorAll('.nav button')) b.addEventListener('click', () => zeigeAnsicht(b.dataset.view));
  zeigeAnsicht('record'); // die App startet immer in Aufnahme

  // Schlange anstossen: Start, Rueckkehr in den Vordergrund, Netz wieder da (Knopfdruck: ui-record)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { pipeline.starte('sichtbar'); ansichten.record.api.zeige(); } });
  window.addEventListener('online', () => pipeline.starte('online'));
  window.addEventListener('pageshow', (e) => { if (e.persisted) pipeline.starte('pageshow'); });
  if (!dbFehler) pipeline.starte('start');
  registriereOffline();
}

start().catch((e) => { try { log(`Startfehler: ${e && e.message}`); } catch (_) {} console.error(e); });
