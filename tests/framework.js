'use strict';
/* Minimales Testgeruest: test(name, fn), ok, eq. Kein Fremdcode. */
export const alle = [];
export function test(name, fn) { alle.push({ name, fn, gruppe: currentGroup }); }
let currentGroup = '';
export function gruppe(name) { currentGroup = name; }

export function ok(bedingung, msg = 'Bedingung nicht erfüllt') { if (!bedingung) throw new Error(msg); }
export function eq(ist, soll, msg = 'eq') {
  const a = JSON.stringify(ist), b = JSON.stringify(soll);
  if (a !== b) throw new Error(`${msg}: erwartet ${b}, bekommen ${a}`);
}
export async function wirft(fn, msg = 'wirft') {
  try { await fn(); } catch (e) { return e; }
  throw new Error(`${msg}: kein Fehler geworfen`);
}
/** Module der App mit demselben ?v= laden wie die App selbst (gleiche Instanz wie in den Importen der Module). */
export async function app(modul) {
  const { CONFIG } = await import('../js/config.js');
  return import(`../js/${modul}.js?v=${CONFIG.version}`);
}
