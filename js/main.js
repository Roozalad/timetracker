'use strict';
/* Start, Navigation, Verdrahtung. */
import { CONFIG } from './config.js?v=0.3.0';
import { log } from './log.js?v=0.3.0';
import * as db from './db.js?v=0.3.0';
import * as pipeline from './pipeline.js?v=0.3.0';
import { zuordnen } from './zuordnen.js?v=0.3.0';
import { initRecord } from './ui-record.js?v=0.3.0';
import { initStats } from './ui-stats.js?v=0.3.0';
import { initSettings } from './ui-settings.js?v=0.3.0';

const $ = (id) => document.getElementById(id);

async function start() {
  $('jsver').textContent = `js ${CONFIG.version}`;
  log(`start v${CONFIG.version} ${navigator.userAgent}`);
  log(`standalone=${window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches} mediaRecorder=${typeof MediaRecorder !== 'undefined'}`);

  let dbFehler = null;
  try { await db.oeffneDb(); } catch (e) { dbFehler = e; log(`IndexedDB nicht nutzbar: ${e && e.message}`); }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) {}

  pipeline.registriereZuordnung(zuordnen); // Schritt 3: Zuordnung mit categorize, Segmente speichern

  // Navigation
  const ansichten = {};
  const zeigeAnsicht = (name) => {
    for (const [n, a] of Object.entries(ansichten)) a.sec.hidden = n !== name;
    for (const b of document.querySelectorAll('.nav button')) {
      if (b.dataset.view === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    ansichten[name].api.zeige();
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
}

start().catch((e) => { try { log(`Startfehler: ${e && e.message}`); } catch (_) {} console.error(e); });
