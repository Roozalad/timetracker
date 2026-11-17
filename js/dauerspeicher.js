'use strict';
/* Dauerhafter Speicher (Abschnitt 10): beim Start navigator.storage.persist() anfordern und das Ergebnis merken.
   Unter iOS entscheidet das System; die App zeigt nur an, was zurueckkommt. */
import { log } from './log.js?v=0.5.0';

let stand = null; // true | false | null (unbekannt)
const abonnenten = new Set();

export async function fordereAn() {
  try {
    const s = typeof navigator !== 'undefined' && navigator.storage;
    if (!s || typeof s.persist !== 'function') { log('Dauerhafter Speicher: nicht unterstützt'); return stand; }
    let ja = typeof s.persisted === 'function' ? await s.persisted() : false;
    if (ja === true) log('Dauerhafter Speicher: bereits gewährt');
    else { ja = await s.persist(); log(`Dauerhafter Speicher: ${ja === true ? 'gewährt' : 'nicht gewährt'}`); }
    stand = ja === true;
  } catch (e) { log(`Dauerhafter Speicher: Anfrage fehlgeschlagen (${(e && e.name) || 'Fehler'})`); stand = null; }
  for (const f of abonnenten) { try { f(); } catch (_) {} }
  return stand;
}
export function dauerhaft() { return stand; }
export function dauerhaftText() { return stand === true ? 'ja' : stand === false ? 'nein' : 'unbekannt'; }
export function abonniereDauer(fn) { abonnenten.add(fn); return () => abonnenten.delete(fn); }
