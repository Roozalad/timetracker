'use strict';
/* Protokoll: neueste Zeile oben, im Speicher und (zur Nachschau am Geraet) in localStorage.
   Hier landen nie Key, Transkripttext oder Audio. */
import { CONFIG } from './config.js?v=0.5.0';

const abonnenten = new Set();
let zeilen = [];
let storageName = CONFIG.logStorage;

function laden() {
  try {
    const s = localStorage.getItem(storageName);
    const a = s ? JSON.parse(s) : [];
    zeilen = Array.isArray(a) ? a.filter((z) => typeof z === 'string').slice(0, CONFIG.logMaxZeilen) : [];
  } catch (_) { zeilen = []; }
}
function sichern() { try { localStorage.setItem(storageName, JSON.stringify(zeilen)); } catch (_) {} }
laden();

export function log(msg) {
  const t = new Date().toLocaleTimeString('de-DE');
  zeilen.unshift(`${t} ${msg}`);
  if (zeilen.length > CONFIG.logMaxZeilen) zeilen.length = CONFIG.logMaxZeilen;
  sichern();
  try { console.log(msg); } catch (_) {}
  for (const f of abonnenten) { try { f(); } catch (_) {} }
}
export function logText() { return zeilen.join('\n'); }
export function abonniereLog(fn) { abonnenten.add(fn); return () => abonnenten.delete(fn); }
export function leereLog() { zeilen = []; sichern(); for (const f of abonnenten) { try { f(); } catch (_) {} } }
/** Nur fuer Tests: anderen Speichernamen benutzen, damit das echte Protokoll unberuehrt bleibt. */
export function _logSpeicherName(name) { storageName = name; laden(); }
