'use strict';
/* Ansicht Einstellungen. Paket A: API-Key (eintragen, ersetzen, entfernen) und Info mit Version und aufklappbarem
   Protokoll. Paket E: Toepfe (Liste, Anlegen, Bearbeiten, Reihenfolge, Archiv, Unterpunkte) und Daten (Export,
   Import, Alles loeschen). baueExport und pruefeImport sind ohne Seite pruefbar (tests/einstellungen.test.js). */
import { CONFIG } from './config.js?v=0.4.0';
import { getKey, setKey, removeKey, keyEnde } from './key.js?v=0.4.0';
import { logText, abonniereLog, leereLog, log } from './log.js?v=0.4.0';
import { frage } from './ui-korrektur.js?v=0.4.0';
import { ueberlappungen, UNKLAR } from './segments.js?v=0.4.0';
import * as db from './db.js?v=0.4.0';
import { dauerhaftText, abonniereDauer } from './dauerspeicher.js?v=0.4.0';

export const EXPORT_APP = 'zeiterfassung';
export const EXPORT_FORMAT = 1;
/** localStorage-Name des Zeitpunkts (Millisekunden als Text) des letzten Exports; Paket G liest ihn. */
export const LETZTER_EXPORT = 'zeiterfassung.letzterExport';
export const HINWEIS_KI = 'Diese Stichworte gehen an die KI. Der Name oben bleibt auf dem Gerät.';
export const FARBEN = ['#4C9F70', '#3B82C4', '#D97B29', '#8E5BB5', '#C0392B', '#16A3A3', '#B5833A', '#6B7280'];
const STATI = ['wartet_transkription', 'wartet_zuordnung', 'fertig', 'fehler'];
const NAME_MAX = 60;
const TOPF_FELDER = ['id', 'name', 'hinweise', 'farbe', 'bezahlt', 'unter', 'archiviert', 'reihenfolge'];
const EINTRAG_FELDER = ['id', 'zeit', 'status', 'transkript', 'fensterStart', 'angekuendigt', 'stimmung', 'unklar', 'promptVersion', 'fehler'];
const SEGMENT_FELDER = ['id', 'eintragId', 'topfId', 'unterId', 'start', 'ende', 'text', 'quelle', 'zeitQuelle'];

const pick = (o, felder) => { const r = {}; for (const f of felder) r[f] = o[f] === undefined ? null : o[f]; return r; };

/** Export-Datei als Text aus einem Bestand (db.bestandLesen). Enthaelt nie Key und nie Audio: audioId fehlt. */
export function baueExport(b, jetzt = Date.now()) {
  const d = {
    app: EXPORT_APP, format: EXPORT_FORMAT, version: CONFIG.version, exportiert: new Date(jetzt).toISOString(),
    toepfe: b.toepfe.map((t) => ({ ...pick(t, TOPF_FELDER), unter: (t.unter || []).map((u) => ({ ...u })) })),
    eintraege: b.eintraege.map((e) => pick(e, EINTRAG_FELDER)),
    segmente: b.segmente.map((s) => pick(s, SEGMENT_FELDER)),
  };
  return JSON.stringify(d, null, 2);
}

/** Prueft eine Export-Datei (Text) und liefert { toepfe, eintraege, segmente }. Wirft mit deutscher Meldung, wenn
    etwas nicht stimmt. Geschrieben wird hier nichts; das macht der Aufrufer nach der Rueckfrage. */
export function pruefeImport(text) {
  const weh = (m) => { throw new Error(`Die Datei passt nicht: ${m}. Es wurde nichts geändert.`); };
  let d = null;
  try { d = JSON.parse(String(text == null ? '' : text)); } catch (_) { weh('kein gültiges JSON'); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) weh('keine Export-Datei');
  if (d.app !== EXPORT_APP) weh('keine Export-Datei dieser App');
  if (d.format !== EXPORT_FORMAT) weh(`Format ${d.format} wird nicht unterstützt`);
  for (const k of ['toepfe', 'eintraege', 'segmente']) if (!Array.isArray(d[k])) weh(`Feld „${k}“ fehlt`);

  // Toepfe und Unterpunkte
  const topfIds = new Set(), unterIds = new Set(), unterVon = {};
  const toepfe = d.toepfe.map((t, i) => {
    const nr = `Topf ${i + 1}`;
    if (!t || typeof t !== 'object') weh(`${nr} ist leer`);
    if (typeof t.id !== 'string' || !/^t\d+$/.test(t.id)) weh(`${nr}: Kennung ungültig`);
    if (topfIds.has(t.id)) weh(`Kennung ${t.id} kommt doppelt vor`);
    topfIds.add(t.id);
    if (typeof t.name !== 'string' || !t.name.trim() || t.name.length > NAME_MAX) weh(`${t.id}: Name fehlt`);
    if (t.hinweise != null && typeof t.hinweise !== 'string') weh(`${t.id}: Hinweise ungültig`);
    if (typeof t.farbe !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(t.farbe)) weh(`${t.id}: Farbe ungültig`);
    const bezahlt = t.bezahlt === undefined ? null : t.bezahlt;
    if (![true, false, null].includes(bezahlt)) weh(`${t.id}: bezahlt ungültig`);
    if (typeof t.archiviert !== 'boolean') weh(`${t.id}: archiviert fehlt`);
    if (!Number.isFinite(t.reihenfolge)) weh(`${t.id}: Reihenfolge fehlt`);
    if (!Array.isArray(t.unter)) weh(`${t.id}: Unterpunkte fehlen`);
    unterVon[t.id] = new Set();
    const unter = t.unter.map((u) => {
      if (!u || typeof u.id !== 'string' || !/^u\d+$/.test(u.id)) weh(`${t.id}: Unterpunkt-Kennung ungültig`);
      if (unterIds.has(u.id)) weh(`Unterpunkt-Kennung ${u.id} kommt doppelt vor`);
      unterIds.add(u.id); unterVon[t.id].add(u.id);
      if (typeof u.name !== 'string' || !u.name.trim() || u.name.length > NAME_MAX) weh(`${t.id}/${u.id}: Name fehlt`);
      return { id: u.id, name: u.name, ...(typeof u.archiviert === 'boolean' ? { archiviert: u.archiviert } : {}) };
    });
    return {
      id: t.id, name: t.name, hinweise: t.hinweise == null ? '' : t.hinweise, farbe: t.farbe, bezahlt,
      unter, archiviert: t.archiviert, reihenfolge: t.reihenfolge,
    };
  });

  // Eintraege (Audio gibt es in der Datei nicht)
  const eintragIds = new Set();
  const eintraege = d.eintraege.map((e) => {
    if (!e || !Number.isInteger(e.id) || eintragIds.has(e.id)) weh('Eintrag ohne oder mit doppelter Kennung');
    eintragIds.add(e.id);
    if (!Number.isFinite(e.zeit)) weh(`Eintrag ${e.id}: Zeit fehlt`);
    if (!STATI.includes(e.status)) weh(`Eintrag ${e.id}: Status ungültig`);
    return { ...pick(e, EINTRAG_FELDER), audioId: null };
  });

  // Segmente: Herkunft, Topf und Unterpunkt, Zeiten, keine Überlappung
  const segIds = new Set();
  const segmente = d.segmente.map((s) => {
    const nr = `Segment ${s && s.id}`;
    if (!s || !Number.isInteger(s.id) || segIds.has(s.id)) weh('Segment ohne oder mit doppelter Kennung');
    segIds.add(s.id);
    if (!(s.eintragId == null || Number.isInteger(s.eintragId))) weh(`${nr}: Herkunft ungültig`);
    if (!(s.topfId === UNKLAR || topfIds.has(s.topfId))) weh(`${nr}: Topf „${s.topfId}“ unbekannt`);
    if (s.unterId != null && (s.topfId === UNKLAR || !unterVon[s.topfId].has(s.unterId))) weh(`${nr}: Unterpunkt passt nicht zum Topf`);
    if (!Number.isFinite(s.start) || !Number.isFinite(s.ende) || s.start >= s.ende) weh(`${nr}: Zeiten ungültig`);
    if (!['ki', 'manuell'].includes(s.quelle)) weh(`${nr}: Quelle ungültig`);
    if (!['genannt', 'geschaetzt'].includes(s.zeitQuelle)) weh(`${nr}: Zeitquelle ungültig`);
    if (typeof s.text !== 'string') weh(`${nr}: Text fehlt`);
    return pick(s, SEGMENT_FELDER);
  });
  if (ueberlappungen(segmente).length) weh('Segmente überlappen sich');

  return { toepfe, eintraege, segmente };
}

const bezahltText = (b) => (b === true ? 'bezahlt' : b === false ? 'unbezahlt' : 'keine Angabe');
const datumDatei = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
function liesText(datei) {
  if (typeof datei.text === 'function') return datei.text();
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error);
    r.readAsText(datei);
  });
}

function el(tag, klasse, text) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text != null) e.textContent = text;
  return e;
}
function abschnitt(titel) {
  const s = document.createElement('section'); s.className = 'abschnitt';
  const h = document.createElement('h2'); h.textContent = titel; s.append(h);
  return s;
}
function knopf(text, onClick, klasse = 'knopf') {
  const b = document.createElement('button'); b.type = 'button'; b.className = klasse; b.textContent = text;
  b.addEventListener('click', onClick); return b;
}
function meldung() { const m = el('div', 'einst-meldung'); m.hidden = true; return m; }
function zeigeMeldung(m, text, ok = false) { m.hidden = !text; m.textContent = text || ''; m.classList.toggle('einst-ok', !!ok); }
function feld(titel, inhalt) { const d = el('div', 'feld'); d.append(el('div', 'feld-titel', titel), inhalt); return d; }

/** root: Container #settings-body. ctx: { schluesselGeaendert() } wird nach Eintragen/Ersetzen/Entfernen gerufen. */
export function initSettings(root, ctx = {}) {
  // ---- Abschnitt Toepfe (Paket E)
  const topfS = abschnitt('Töpfe');
  const topfMeldung = meldung();
  const listeBox = el('div');
  const archivBox = el('div');
  const neuName = document.createElement('input');
  neuName.type = 'text'; neuName.maxLength = NAME_MAX; neuName.autocomplete = 'off';
  neuName.placeholder = 'Name des neuen Topfs'; neuName.setAttribute('aria-label', 'Name des neuen Topfs');
  neuName.addEventListener('keydown', (e) => { if (e.key === 'Enter') anlegen(); });
  topfS.append(el('div', 'info', 'Töpfe ordnen die Tätigkeiten zu. Archivierte bleiben in alten Auswertungen, gehen aber nicht mehr an die KI.'),
    topfMeldung, listeBox, el('div', 'feld-titel', 'Neuer Topf'), el('div', 'einst-neu', ''), archivBox);
  topfS.querySelector('.einst-neu').append(neuName, knopf('Anlegen', anlegen, 'knopf primaer'));

  const st = { toepfe: [], zaehl: { topf: {}, unter: {} }, offen: null, entwurf: null, meldung: '', archivOffen: false };

  async function laden() {
    try {
      const [t, z] = await Promise.all([db.listToepfe(), db.zaehleSegmente()]);
      st.toepfe = t; st.zaehl = z;
      zeigeMeldung(topfMeldung, '');
    } catch (e) {
      zeigeMeldung(topfMeldung, `Töpfe konnten nicht gelesen werden: ${(e && e.message) || 'unbekannter Fehler'}`);
    }
    zeichneToepfe();
  }

  function zeichneToepfe() {
    listeBox.textContent = ''; archivBox.textContent = '';
    const aktive = st.toepfe.filter((t) => !t.archiviert);
    const archiv = st.toepfe.filter((t) => t.archiviert);
    if (!aktive.length) listeBox.append(el('p', 'info', 'Keine aktiven Töpfe.'));
    const ul = el('ul', 'topf-liste');
    aktive.forEach((t, i) => ul.append(topfEintrag(t, i, aktive.length)));
    listeBox.append(ul);
    if (archiv.length) {
      const det = document.createElement('details'); det.className = 'archiv'; det.open = st.archivOffen;
      det.addEventListener('toggle', () => { st.archivOffen = det.open; });
      const sum = document.createElement('summary'); sum.textContent = `Archiviert (${archiv.length})`;
      const aul = el('ul', 'topf-liste');
      archiv.forEach((t) => aul.append(topfEintrag(t, -1, 0)));
      det.append(sum, aul);
      archivBox.append(det);
    }
  }

  function topfEintrag(t, i, n) {
    const li = el('li', t.archiviert ? 'topf-eintrag archiviert-zeile' : 'topf-eintrag');
    const zeile = el('div', 'topf-zeile');
    const auswahl = document.createElement('button');
    auswahl.type = 'button'; auswahl.className = 'topf-auswahl';
    auswahl.setAttribute('aria-expanded', String(st.offen === t.id));
    const punkt = el('span', 'punkt'); punkt.style.background = t.farbe;
    auswahl.append(punkt, el('span', 'topf-name', t.name), el('span', 'topf-meta', bezahltText(t.bezahlt)));
    auswahl.addEventListener('click', () => oeffnen(st.offen === t.id ? null : t.id));
    zeile.append(auswahl);
    if (!t.archiviert) {
      const hoch = knopf('▲', () => verschiebe(t.id, -1), 'knopf-pfeil');
      hoch.setAttribute('aria-label', `${t.name} nach oben`); hoch.disabled = i === 0;
      const runter = knopf('▼', () => verschiebe(t.id, 1), 'knopf-pfeil');
      runter.setAttribute('aria-label', `${t.name} nach unten`); runter.disabled = i === n - 1;
      zeile.append(hoch, runter);
    }
    li.append(zeile);
    if (st.offen === t.id && st.entwurf) li.append(editor());
    return li;
  }

  function oeffnen(id) {
    const t = id ? st.toepfe.find((x) => x.id === id) : null;
    st.offen = t ? t.id : null;
    st.entwurf = t ? JSON.parse(JSON.stringify(t)) : null;
    st.meldung = '';
    zeichneToepfe();
  }

  /** Reihenfolge: aktive Töpfe neu nummerieren, den Eintrag um eine Stelle verschieben. */
  async function verschiebe(id, richtung) {
    const aktive = st.toepfe.filter((t) => !t.archiviert);
    const i = aktive.findIndex((t) => t.id === id), j = i + richtung;
    if (i < 0 || j < 0 || j >= aktive.length) return;
    const neu = aktive.slice();
    [neu[i], neu[j]] = [neu[j], neu[i]];
    try {
      await db.toepfeSpeichern(neu.map((t, k) => ({ ...t, reihenfolge: k + 1 })));
      log(`Topf ${id} verschoben`);
    } catch (e) {
      zeigeMeldung(topfMeldung, `Verschieben fehlgeschlagen: ${(e && e.message) || ''}`);
    }
    await laden();
  }

  async function anlegen() {
    const name = neuName.value.trim();
    if (!name) { zeigeMeldung(topfMeldung, 'Bitte einen Namen eingeben.'); return; }
    try {
      const id = await db.neueKennung('t');
      const reihenfolge = st.toepfe.reduce((m, t) => Math.max(m, t.reihenfolge || 0), 0) + 1;
      await db.topfAnlegen({
        id, name, hinweise: name, farbe: FARBEN[st.toepfe.length % FARBEN.length], bezahlt: null,
        unter: [], archiviert: false, reihenfolge,
      });
      log(`Topf ${id} angelegt`);
      neuName.value = '';
      zeigeMeldung(topfMeldung, '');
      await laden();
      oeffnen(id);
    } catch (e) {
      zeigeMeldung(topfMeldung, `Anlegen fehlgeschlagen: ${(e && e.message) || ''}`);
    }
  }

  /** Bearbeitungsblatt unter dem Topf. Alle Änderungen laufen über st.entwurf und werden mit "Speichern" geschrieben. */
  function editor() {
    const e = st.entwurf;
    const anzahl = st.zaehl.topf[e.id] || 0;
    const box = el('div', 'topf-editor');

    const ni = document.createElement('input');
    ni.type = 'text'; ni.maxLength = NAME_MAX; ni.value = e.name; ni.autocomplete = 'off';
    ni.setAttribute('aria-label', 'Name');
    ni.addEventListener('input', () => { e.name = ni.value; });
    box.append(feld('Name', ni));

    const farben = el('div', 'swatches');
    for (const f of FARBEN) {
      const b = el('button', 'swatch'); b.type = 'button'; b.style.background = f;
      b.setAttribute('aria-label', `Farbe ${f}`); b.setAttribute('aria-pressed', String(e.farbe === f));
      b.addEventListener('click', () => { e.farbe = f; zeichneToepfe(); });
      farben.append(b);
    }
    box.append(feld('Farbe', farben));

    const bez = el('div', 'umschalter');
    for (const [txt, wert] of [['ja', true], ['nein', false], ['keine Angabe', null]]) {
      const b = knopf(txt, () => { e.bezahlt = wert; zeichneToepfe(); });
      b.setAttribute('aria-pressed', String(e.bezahlt === wert));
      bez.append(b);
    }
    box.append(feld('Bezahlt', bez));

    const ta = document.createElement('textarea');
    ta.rows = 3; ta.value = e.hinweise || ''; ta.setAttribute('aria-label', 'Hinweise');
    ta.addEventListener('input', () => { e.hinweise = ta.value; });
    const hf = feld('Hinweise', ta);
    hf.append(el('div', 'info', HINWEIS_KI));
    box.append(hf);

    box.append(el('div', 'feld-titel', 'Unterpunkte'));
    if (!e.unter.length) box.append(el('p', 'info', 'Keine Unterpunkte.'));
    for (const u of e.unter) box.append(unterZeile(u));
    const neuU = document.createElement('input');
    neuU.type = 'text'; neuU.maxLength = NAME_MAX; neuU.autocomplete = 'off';
    neuU.placeholder = 'Neuer Unterpunkt'; neuU.setAttribute('aria-label', 'Name des neuen Unterpunkts');
    const uZeile = el('div', 'einst-neu');
    uZeile.append(neuU, knopf('Hinzufügen', async () => {
      const name = neuU.value.trim();
      if (!name) { st.meldung = 'Der Unterpunkt braucht einen Namen.'; zeichneToepfe(); return; }
      try {
        const id = await db.neueKennung('u');
        e.unter.push({ id, name, archiviert: false });
        st.meldung = '';
        zeichneToepfe();
      } catch (err) { st.meldung = `Unterpunkt nicht angelegt: ${(err && err.message) || ''}`; zeichneToepfe(); }
    }));
    box.append(uZeile);

    if (st.meldung) box.append(el('div', 'einst-meldung', st.meldung));

    const akt = el('div', 'einst-aktionen');
    akt.append(
      knopf('Speichern', speichernEntwurf, 'knopf primaer'),
      knopf('Abbrechen', () => oeffnen(null)),
      knopf(e.archiviert ? 'Wiederherstellen' : 'Archivieren', async () => {
        const vorher = e.archiviert;
        e.archiviert = !vorher;
        if (!(await speichernEntwurf())) e.archiviert = vorher;
      }),
    );
    const loesch = knopf('Löschen', topfLoeschenFragen, 'knopf gefahr');
    loesch.disabled = anzahl > 0;
    akt.append(loesch);
    box.append(akt);
    if (anzahl) box.append(el('p', 'info', `${anzahl} Segmente: dieser Topf lässt sich nur archivieren, nicht löschen.`));
    return box;
  }

  function unterZeile(u) {
    const e = st.entwurf;
    const z = el('div', 'unter-zeile');
    const ui = document.createElement('input');
    ui.type = 'text'; ui.maxLength = NAME_MAX; ui.value = u.name; ui.autocomplete = 'off';
    ui.setAttribute('aria-label', `Unterpunkt ${u.name}`);
    ui.addEventListener('input', () => { u.name = ui.value; });
    const n = st.zaehl.unter[`${e.id}/${u.id}`] || 0;
    z.append(ui, knopf(u.archiviert ? 'Wiederherstellen' : 'Archivieren', () => { u.archiviert = !u.archiviert; zeichneToepfe(); }));
    const loesch = knopf('Löschen', () => { e.unter = e.unter.filter((x) => x !== u); zeichneToepfe(); }, 'knopf gefahr');
    loesch.disabled = n > 0;
    z.append(loesch);
    if (n) z.append(el('div', 'unter-hinweis', `${n} Segmente: nur archivieren, nicht löschen.`));
    else if (u.archiviert) z.append(el('div', 'unter-hinweis', 'Archiviert: geht nicht mehr an die KI.'));
    return z;
  }

  /** Liefert true, wenn gespeichert wurde. */
  async function speichernEntwurf() {
    const e = st.entwurf;
    if (!e) return false;
    const name = e.name.trim();
    if (!name) { st.meldung = 'Der Name fehlt.'; zeichneToepfe(); return false; }
    const unter = e.unter.map((u) => ({ id: u.id, name: u.name.trim(), archiviert: !!u.archiviert }));
    if (unter.some((u) => !u.name)) { st.meldung = 'Ein Unterpunkt hat keinen Namen.'; zeichneToepfe(); return false; }
    const alt = st.toepfe.find((t) => t.id === e.id);
    const topf = {
      id: e.id, name, hinweise: e.hinweise || '', farbe: e.farbe, bezahlt: e.bezahlt, unter, archiviert: !!e.archiviert,
      reihenfolge: alt ? alt.reihenfolge : e.reihenfolge,   // Reihenfolge aus dem Bestand, nicht aus dem Entwurf
    };
    try {
      await db.topfSpeichern(topf);
      log(`Topf ${topf.id} gespeichert`);
      st.offen = null; st.entwurf = null; st.meldung = '';
      await laden();
      return true;
    } catch (err) {
      st.meldung = (err && err.message) || 'Speichern fehlgeschlagen.';
      zeichneToepfe();
      return false;
    }
  }

  async function topfLoeschenFragen() {
    const e = st.entwurf;
    if (!e) return;
    const ja = await frage({
      titel: 'Topf löschen?', text: `„${e.name}“ wird entfernt. Das lässt sich nicht rückgängig machen.`, ja: 'Löschen', gefahr: true,
    });
    if (!ja) return;
    try {
      await db.topfLoeschen(e.id);
      log(`Topf ${e.id} gelöscht`);
      st.offen = null; st.entwurf = null; st.meldung = '';
      await laden();
    } catch (err) {
      st.meldung = (err && err.message) || 'Löschen fehlgeschlagen.';
      zeichneToepfe();
    }
  }

  // ---- Abschnitt Daten (Paket E)
  const datenS = abschnitt('Daten');
  const letzter = el('div', 'info');
  const datenMeldung = meldung();
  const dateiEingabe = document.createElement('input');
  dateiEingabe.type = 'file'; dateiEingabe.accept = '.json,application/json'; dateiEingabe.className = 'sr-nur';
  dateiEingabe.tabIndex = -1; dateiEingabe.setAttribute('aria-label', 'Export-Datei zum Einlesen wählen');
  const datenAktionen = el('div', 'einst-aktionen');
  datenAktionen.append(
    knopf('Export', exportieren),
    knopf('Import', () => dateiEingabe.click()),
    knopf('Alles löschen', alleLoeschen, 'knopf gefahr'),
  );
  datenS.append(letzter, datenAktionen, datenMeldung, dateiEingabe);

  function zeigeLetzter() {
    let t = 0;
    try { t = Number(localStorage.getItem(LETZTER_EXPORT)) || 0; } catch (_) {}
    letzter.textContent = t ? `Letzter Export: ${new Date(t).toLocaleString('de-DE')}` : 'Noch nie exportiert.';
  }

  async function exportieren() {
    try {
      const b = await db.bestandLesen();
      const url = URL.createObjectURL(new Blob([baueExport(b)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = `zeiterfassung-${datumDatei()}.json`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      try { localStorage.setItem(LETZTER_EXPORT, String(Date.now())); } catch (_) {}
      log(`Export: ${b.toepfe.length} Töpfe, ${b.eintraege.length} Einträge, ${b.segmente.length} Segmente`);
      zeigeMeldung(datenMeldung, `Export erstellt: ${b.toepfe.length} Töpfe, ${b.eintraege.length} Einträge, ${b.segmente.length} Segmente.`, true);
      zeigeLetzter();
    } catch (err) {
      zeigeMeldung(datenMeldung, `Export fehlgeschlagen: ${(err && err.message) || ''}`);
    }
  }

  dateiEingabe.addEventListener('change', async () => {
    const datei = dateiEingabe.files && dateiEingabe.files[0];
    dateiEingabe.value = '';
    if (!datei) return;
    let bestand;
    try { bestand = pruefeImport(await liesText(datei)); }
    catch (err) { zeigeMeldung(datenMeldung, err.message); log('Import abgelehnt: Datei passt nicht'); return; }
    const aufnahmen = (await db.listAudioIds()).length;
    const text = `Der gesamte Bestand auf diesem Gerät wird ersetzt durch ${bestand.toepfe.length} Töpfe, ` +
      `${bestand.eintraege.length} Einträge und ${bestand.segmente.length} Segmente aus „${datei.name}“.` +
      (aufnahmen ? ` ${aufnahmen} noch nicht übertragene Aufnahmen gehen dabei verloren.` : '') +
      ' Vorher lieber einen Export machen.';
    if (!(await frage({ titel: 'Bestand ersetzen?', text, ja: 'Ersetzen', gefahr: true }))) return;
    try {
      await db.bestandErsetzen(bestand);
      log(`Import: ${bestand.toepfe.length} Töpfe, ${bestand.eintraege.length} Einträge, ${bestand.segmente.length} Segmente`);
      zeigeMeldung(datenMeldung, 'Import fertig. Der Bestand wurde ersetzt.', true);
      st.offen = null; st.entwurf = null;
      await laden();
    } catch (err) {
      zeigeMeldung(datenMeldung, `Import fehlgeschlagen, es wurde nichts geändert: ${(err && err.message) || ''}`);
    }
  });

  async function alleLoeschen() {
    const eins = await frage({
      titel: 'Alles löschen?',
      text: 'Alle Töpfe, Einträge, Segmente und wartenden Aufnahmen werden von diesem Gerät entfernt. ' +
        'Danach gilt wieder der Startbestand der Töpfe. Der Key bleibt. Vorher lieber einen Export machen.',
      ja: 'Weiter', gefahr: true,
    });
    if (!eins) return;
    const zwei = await frage({ titel: 'Wirklich alles löschen?', text: 'Das lässt sich nicht rückgängig machen.', ja: 'Alles löschen', gefahr: true });
    if (!zwei) return;
    try {
      await db.alleZuruecksetzen();
      log('Alles gelöscht, Töpfe auf Startbestand');
      zeigeMeldung(datenMeldung, 'Alles gelöscht. Die Töpfe stehen wieder auf dem Startbestand.', true);
      st.offen = null; st.entwurf = null;
      await laden();
    } catch (err) {
      zeigeMeldung(datenMeldung, `Löschen fehlgeschlagen: ${(err && err.message) || ''}`);
    }
  }

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
  const dauer = document.createElement('div'); dauer.className = 'info';
  const zeigeDauer = () => { dauer.textContent = `Dauerhafter Speicher: ${dauerhaftText()}`; };
  zeigeDauer(); abonniereDauer(zeigeDauer);
  const det = document.createElement('details');
  const sum = document.createElement('summary'); sum.textContent = 'Protokoll';
  const pre = document.createElement('pre'); pre.className = 'log';
  const leeren = knopf('Protokoll leeren', () => leereLog());
  det.append(sum, pre, leeren);
  infoS.append(ver, dauer, det);
  const zeigeLog = () => { pre.textContent = logText(); };
  abonniereLog(() => { if (det.open) zeigeLog(); });
  det.addEventListener('toggle', zeigeLog);

  // Reihenfolge: Toepfe, Key, Daten, Info
  root.append(topfS, key, datenS, infoS);
  zeigeKey();
  zeigeLetzter();
  laden();
  return {
    zeige() { zeigeKey(); zeigeLetzter(); laden(); if (det.open) zeigeLog(); },
    /** Von der Erinnerung in Aufnahme: zum Abschnitt Daten scrollen. */
    springe(ziel) { if (ziel === 'daten') datenS.scrollIntoView({ block: 'start' }); },
  };
}
