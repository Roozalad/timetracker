'use strict';
/* Ansicht Einstellungen. Paket A: API-Key (eintragen, ersetzen, entfernen) und Info mit Version und
   aufklappbarem Protokoll. Paket E ergaenzt Toepfe und Daten als weitere Abschnitte (siehe unten). */
import { CONFIG } from './config.js?v=0.1.0';
import { getKey, setKey, removeKey, keyEnde } from './key.js?v=0.1.0';
import { logText, abonniereLog, leereLog, log } from './log.js?v=0.1.0';

function abschnitt(titel) {
  const s = document.createElement('section'); s.className = 'abschnitt';
  const h = document.createElement('h2'); h.textContent = titel; s.append(h);
  return s;
}
function knopf(text, onClick) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'knopf'; b.textContent = text;
  b.addEventListener('click', onClick); return b;
}

/** root: Container #settings-body. ctx: { schluesselGeaendert() } wird nach Eintragen/Ersetzen/Entfernen gerufen. */
export function initSettings(root, ctx = {}) {
  // ---- Abschnitt API-Key
  const key = abschnitt('API-Key');
  const info = document.createElement('div'); info.className = 'info';
  const zeile = document.createElement('div'); zeile.className = 'keyrow';
  const eingabe = document.createElement('input');
  eingabe.type = 'password'; eingabe.autocomplete = 'off'; eingabe.autocapitalize = 'off';
  eingabe.setAttribute('autocorrect', 'off'); eingabe.spellcheck = false; eingabe.placeholder = 'sk-...';
  eingabe.setAttribute('aria-label', 'OpenAI API-Key');
  const speichern = knopf('Speichern', () => {
    const v = eingabe.value.trim();
    if (!v) return;
    if (!setKey(v)) { info.textContent = 'Speichern fehlgeschlagen (lokaler Speicher gesperrt?).'; return; }
    eingabe.value = ''; log('Key gespeichert'); zeigeKey(); if (ctx.schluesselGeaendert) ctx.schluesselGeaendert();
  });
  const entfernen = knopf('Entfernen', () => {
    removeKey(); log('Key entfernt'); zeigeKey(); if (ctx.schluesselGeaendert) ctx.schluesselGeaendert();
  });
  zeile.append(eingabe, speichern, entfernen);
  const hinweis = document.createElement('div'); hinweis.className = 'info';
  hinweis.textContent = 'Der Key liegt nur in diesem Browser. Er ist nie im Code, im Export oder im Protokoll.';
  key.append(info, zeile, hinweis);
  function zeigeKey() {
    const k = getKey();
    info.textContent = k ? `Key gespeichert (…${keyEnde()}). Zum Ersetzen neuen Key eintragen.` : 'Kein Key eingetragen.';
    speichern.textContent = k ? 'Ersetzen' : 'Speichern';
    entfernen.hidden = !k;
  }

  // ---- Abschnitt Info (Version, Protokoll)
  const infoS = abschnitt('Info');
  const ver = document.createElement('div'); ver.className = 'info';
  ver.textContent = `Version ${CONFIG.version}`;
  const det = document.createElement('details');
  const sum = document.createElement('summary'); sum.textContent = 'Protokoll';
  const pre = document.createElement('pre'); pre.className = 'log';
  const leeren = knopf('Protokoll leeren', () => leereLog());
  det.append(sum, pre, leeren);
  infoS.append(ver, det);
  const zeigeLog = () => { pre.textContent = logText(); };
  abonniereLog(() => { if (det.open) zeigeLog(); });
  det.addEventListener('toggle', zeigeLog);

  // Reihenfolge: Paket E setzt "Toepfe" davor und "Daten" (Export, Import, Alles loeschen) zwischen Key und Info.
  root.append(key, infoS);
  zeigeKey();
  return { zeige() { zeigeKey(); if (det.open) zeigeLog(); } };
}
