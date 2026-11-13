'use strict';
/* Fuehrt die Testmodule aus und zeigt die Ergebnisse. Neue Testdatei: unten in DATEIEN eintragen. */
import { alle } from './framework.js';

const DATEIEN = ['zeit.test.js', 'db.test.js', 'pipeline.test.js'];

const out = document.getElementById('out'), summary = document.getElementById('summary');
let fehler = 0, gut = 0;
for (const d of DATEIEN) {
  try { await import(`./${d}`); }
  catch (e) { fehler++; add('fail', `${d} konnte nicht geladen werden`, e); }
}
let letzte = null;
for (const t of alle) {
  if (t.gruppe !== letzte) { letzte = t.gruppe; const g = document.createElement('li'); g.className = 'grp'; g.textContent = t.gruppe; out.append(g); }
  try { await t.fn(); gut++; add('ok', t.name); }
  catch (e) { fehler++; add('fail', t.name, e); }
}
function add(klasse, text, err) {
  const li = document.createElement('li'); li.className = klasse; li.textContent = text;
  if (err) { const p = document.createElement('pre'); p.textContent = String(err && err.stack || err); li.append(p); }
  out.append(li);
}
summary.className = fehler ? 'rot' : 'gruen';
summary.textContent = fehler ? `ROT: ${fehler} fehlgeschlagen, ${gut} bestanden` : `GRÜN: ${gut} Tests bestanden`;
document.title = `${fehler ? 'ROT' : 'GRÜN'} · Tests`;
