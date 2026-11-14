'use strict';
/* IndexedDB: Toepfe, Eintraege, Segmente, Audio (Abschnitt 6).
   Keine Logik ausser Speichern und Lesen. Segment-Pruefung (Ueberlappung) gehoert in segments.js. */
import { CONFIG } from './config.js?v=0.4.2';

export const ABLAGEN = { toepfe: 'toepfe', eintraege: 'eintraege', segmente: 'segmente', audio: 'audio' };

/** Startbestand der Toepfe (Abschnitt 6). Hinweise sind zunaechst gleich dem Namen. */
export function startbestandToepfe() {
  const u = (id, name) => ({ id, name });
  const t = (id, name, farbe, bezahlt, unter, reihenfolge) =>
    ({ id, name, hinweise: name, farbe, bezahlt, unter, archiviert: false, reihenfolge });
  return [
    t('t1', 'Privat', '#4C9F70', null, [
      u('u1', 'Morgen- und Abendroutine'), u('u2', 'Essen'), u('u3', 'Freunde'), u('u4', 'Hobby'),
      u('u5', 'Spaß'), u('u6', 'Zuhause'), u('u7', 'Organisation'),
    ], 1),
    t('t2', 'Startup', '#3B82C4', true, [], 2),
    t('t3', 'Töpferstudio', '#D97B29', true, [], 3),
    t('t4', 'Wohnungsbauprojekte', '#8E5BB5', false, [], 4),
  ];
}

let name = CONFIG.dbName;
let dbPromise = null;

/** Oeffnet (und legt beim ersten Mal an, mit Startbestand). Optional anderer Name, fuer Tests. */
export function oeffneDb(dbName) {
  if (dbName && dbName !== name) { name = dbName; dbPromise = null; }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB nicht verfügbar')); return; }
      let r;
      try { r = indexedDB.open(name, CONFIG.dbVersion); } catch (e) { reject(e); return; }
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore(ABLAGEN.toepfe, { keyPath: 'id' });
        const e = db.createObjectStore(ABLAGEN.eintraege, { keyPath: 'id', autoIncrement: true });
        e.createIndex('zeit', 'zeit');
        e.createIndex('status', 'status');
        const s = db.createObjectStore(ABLAGEN.segmente, { keyPath: 'id', autoIncrement: true });
        s.createIndex('start', 'start');
        s.createIndex('eintragId', 'eintragId');
        db.createObjectStore(ABLAGEN.audio, { keyPath: 'id', autoIncrement: true });
        const ts = r.transaction.objectStore(ABLAGEN.toepfe);
        for (const t of startbestandToepfe()) ts.put(t);
      };
      r.onsuccess = () => {
        const db = r.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      r.onerror = () => reject(r.error || new Error('IndexedDB-Fehler'));
      r.onblocked = () => reject(new Error('IndexedDB blockiert'));
    });
    dbPromise.catch(() => { dbPromise = null; }); // naechster Aufruf darf es neu versuchen
  }
  return dbPromise;
}
/** Nur fuer Tests und "Alles loeschen". */
export async function schliesseDb() {
  if (!dbPromise) return;
  try { (await dbPromise).close(); } catch (_) {}
  dbPromise = null;
}
export function loescheDatenbank(dbName) {
  return new Promise((resolve) => {
    const r = indexedDB.deleteDatabase(dbName);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}

/** Eine Transaktion ueber mehrere Ablagen. fn bekommt ein Objekt {ablage: ObjectStore} und darf Requests
    absetzen; Rueckgabewert von fn wird nach dem Abschluss geliefert (Promises in fn werden abgewartet). */
export async function transaktion(ablagen, modus, fn) {
  const db = await oeffneDb();
  return new Promise((resolve, reject) => {
    let t;
    try { t = db.transaction(ablagen, modus); } catch (e) { reject(e); return; }
    const stores = {};
    for (const a of ablagen) stores[a] = t.objectStore(a);
    let out;
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaktion abgebrochen'));
    try { out = fn(stores, t); } catch (e) { try { t.abort(); } catch (_) {} reject(e); }
  });
}
// Ergebnis eines abgeschlossenen Requests direkt lesen
async function lese(ablage, fn) {
  const db = await oeffneDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction([ablage], 'readonly');
    const r = fn(t.objectStore(ablage));
    t.oncomplete = () => resolve(r.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
async function schreibe(ablage, fn) {
  const db = await oeffneDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction([ablage], 'readwrite');
    const r = fn(t.objectStore(ablage));
    t.oncomplete = () => resolve(r ? r.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// ---------------------------------------------------------------- Toepfe
export const listToepfe = async () => (await lese(ABLAGEN.toepfe, (s) => s.getAll())).sort((a, b) => a.reihenfolge - b.reihenfolge);
export const getTopf = (id) => lese(ABLAGEN.toepfe, (s) => s.get(id));
export const putTopf = (topf) => schreibe(ABLAGEN.toepfe, (s) => s.put(topf));

// ---------------------------------------------------------------- Eintraege
export function neuerEintragDaten({ zeit, fensterStart = null, audioId = null }) {
  return {
    zeit, status: 'wartet_transkription', transkript: null, fensterStart, angekuendigt: null,
    stimmung: null, unklar: null, promptVersion: null, fehler: null, audioId,
  };
}
export const getEintrag = (id) => lese(ABLAGEN.eintraege, (s) => s.get(id));
/** Alle Eintraege nach zeit aufsteigend. Optional nur bestimmte Status. */
export async function listEintraege({ status } = {}) {
  const alle = await lese(ABLAGEN.eintraege, (s) => s.getAll());
  const l = status ? alle.filter((e) => [].concat(status).includes(e.status)) : alle;
  return l.sort((a, b) => a.zeit - b.zeit || a.id - b.id);
}
/** Mischt patch in den Eintrag (lesen und schreiben in einer Transaktion). Liefert den neuen Stand oder null.
    wenn(eintrag) optional: nur schreiben, wenn der aktuelle Stand die Bedingung erfuellt (sonst null). */
export async function updateEintrag(id, patch, wenn = null) {
  let neu = null;
  await transaktion([ABLAGEN.eintraege], 'readwrite', (s) => {
    const r = s.eintraege.get(id);
    r.onsuccess = () => { if (r.result && (!wenn || wenn(r.result))) { neu = { ...r.result, ...patch }; s.eintraege.put(neu); } };
  });
  return neu;
}
/** Loescht nur Eintrag und Audio. Mit Segmenten: aktionen.eintragLoeschen (eine Transaktion). */
export async function deleteEintrag(id) {
  await transaktion([ABLAGEN.eintraege, ABLAGEN.audio], 'readwrite', (s) => {
    const r = s.eintraege.get(id);
    r.onsuccess = () => {
      if (r.result && r.result.audioId != null) s.audio.delete(r.result.audioId);
      s.eintraege.delete(id);
    };
  });
}
/** Schritt 1 (7.1): Audio und Eintrag atomar anlegen. audio = {buf, type}. Liefert den Eintrag mit id. */
export async function eintragMitAudioAnlegen({ zeit, fensterStart = null }, audio) {
  let eintrag = null;
  await transaktion([ABLAGEN.eintraege, ABLAGEN.audio], 'readwrite', (s) => {
    const ra = s.audio.add({ buf: audio.buf, type: audio.type, erstelltAm: Date.now() });
    ra.onsuccess = () => {
      const e = neuerEintragDaten({ zeit, fensterStart, audioId: ra.result });
      const re = s.eintraege.add(e);
      re.onsuccess = () => { eintrag = { ...e, id: re.result }; };
    };
  });
  return eintrag;
}
/** Schritt 2 (7.1): Transkript speichern, Audio loeschen, Status setzen - atomar.
    Leeres Transkript: Status 'fertig' (Abschnitt 9), sonst 'wartet_zuordnung'.
    Nur fuer einen Eintrag, der noch auf die Transkription wartet (und, wenn audioId angegeben ist, noch dieses Audio
    traegt); sonst null. So ueberschreibt ein veralteter Lauf (zweiter Tab, Import mitten im Lauf) nichts. */
export async function transkriptSpeichern(id, text, audioId) {
  let neu = null;
  await transaktion([ABLAGEN.eintraege, ABLAGEN.audio], 'readwrite', (s) => {
    const r = s.eintraege.get(id);
    r.onsuccess = () => {
      const e = r.result;
      if (!e || e.status !== 'wartet_transkription' || (audioId !== undefined && e.audioId !== audioId)) return;
      if (e.audioId != null) s.audio.delete(e.audioId);
      neu = { ...e, transkript: text, audioId: null, fehler: null, status: text ? 'wartet_zuordnung' : 'fertig' };
      s.eintraege.put(neu);
    };
  });
  return neu;
}

// ---------------------------------------------------------------- Audio
export const getAudio = (id) => lese(ABLAGEN.audio, (s) => s.get(id));
export const deleteAudio = (id) => schreibe(ABLAGEN.audio, (s) => { s.delete(id); });
export const listAudioIds = () => lese(ABLAGEN.audio, (s) => s.getAllKeys());

// ---------------------------------------------------------------- Segmente (Rohzugriff; Regeln in segments.js)
export const listSegmente = async () => (await lese(ABLAGEN.segmente, (s) => s.getAll())).sort((a, b) => a.start - b.start);
export const putSegment = (seg) => schreibe(ABLAGEN.segmente, (s) => s.put(seg));
export const deleteSegment = (id) => schreibe(ABLAGEN.segmente, (s) => { s.delete(id); });

/** Segmente und optional einen Eintrag in EINER Transaktion aendern: Sperren oder Abbruch mitten drin speichern nichts halb.
    berechne(bestand) -> { loeschen: [ids], schreiben: [Segmente] } | null  (reine Funktion aus segments.js; sie sieht den
      Bestand innerhalb der Transaktion, so ueberschreiben sich gleichzeitige Aenderungen nicht). Segmente ohne id werden angelegt.
    eintrag: null | { id, patch, wenn? } | { id, loeschen: true } (loescht auch das Audio). Fehlt der Eintrag oder erfuellt er
      wenn(eintrag) nicht, wird nichts geschrieben (gefunden: false).
    Liefert { gefunden, eintrag: neuer Stand | null }. */
export async function segmenteAendern(berechne, eintrag = null) {
  let neuerEintrag = null, gefunden = true;
  const ablagen = [ABLAGEN.segmente];
  if (eintrag) ablagen.push(ABLAGEN.eintraege);
  if (eintrag && eintrag.loeschen) ablagen.push(ABLAGEN.audio);
  await transaktion(ablagen, 'readwrite', (s) => {
    const segmenteSchreiben = () => {
      if (!berechne) return;
      const rs = s.segmente.getAll();
      rs.onsuccess = () => {
        const erg = berechne(rs.result);
        if (!erg) return;
        for (const id of erg.loeschen || []) s.segmente.delete(id);
        for (const seg of erg.schreiben || []) {
          if (seg.id == null) { const { id, ...ohneId } = seg; s.segmente.put(ohneId); } else s.segmente.put(seg);
        }
      };
    };
    if (!eintrag) { segmenteSchreiben(); return; }
    const re = s.eintraege.get(eintrag.id);
    re.onsuccess = () => {
      const e = re.result;
      if (!e || (eintrag.wenn && !eintrag.wenn(e))) { gefunden = false; return; }
      if (eintrag.loeschen) { if (e.audioId != null) s.audio.delete(e.audioId); s.eintraege.delete(e.id); }
      else { neuerEintrag = { ...e, ...eintrag.patch }; s.eintraege.put(neuerEintrag); }
      segmenteSchreiben();
    };
  });
  return { gefunden, eintrag: neuerEintrag };
}

// ---------------------------------------------------------------- Paket E: Bestand, Kennungen, Toepfe
const KENNUNG_SPEICHER = 'zeiterfassung.kennungen';   // hoechste vergebene Nummern je Art (t, u), wird nie zurueckgesetzt
let kennungSpeicher = KENNUNG_SPEICHER;
/** Nur fuer Tests: anderer Speichername fuer die Kennungen. */
export function _kennungSpeicherName(n) { kennungSpeicher = n; }
function zaehlerLesen() {
  try { const o = JSON.parse(localStorage.getItem(kennungSpeicher) || '{}'); return o && typeof o === 'object' ? o : {}; }
  catch (_) { return {}; }
}
function zaehlerSchreiben(o) { try { localStorage.setItem(kennungSpeicher, JSON.stringify(o)); } catch (_) {} }
function zaehlerHoch(art, n) { const o = zaehlerLesen(); o[art] = Math.max(+o[art] || 0, n); zaehlerSchreiben(o); }

/** Transaktion mit eigenem Abbruch; anders als transaktion() bleibt der Grund erhalten. arbeit(stores, ctx) ruft bei
    einer Verletzung ctx.abbruch(fehler): dann wird alles zurueckgerollt und fehler geworfen. Ergebnis: ctx.ergebnis.
    Wirft arbeit selbst, gilt dasselbe. */
async function tx(ablagen, modus, arbeit) {
  const db = await oeffneDb();
  return new Promise((resolve, reject) => {
    const ctx = { fehler: null, ergebnis: undefined, abbruch: null };
    let t;
    try { t = db.transaction(ablagen, modus); } catch (e) { reject(e); return; }
    const stores = {};
    for (const a of ablagen) stores[a] = t.objectStore(a);
    ctx.abbruch = (e) => { if (!ctx.fehler) ctx.fehler = e; try { t.abort(); } catch (_) {} };
    t.oncomplete = () => (ctx.fehler ? reject(ctx.fehler) : resolve(ctx.ergebnis));
    t.onerror = () => reject(ctx.fehler || t.error);
    t.onabort = () => reject(ctx.fehler || t.error || new Error('Transaktion abgebrochen'));
    try { arbeit(stores, ctx); } catch (e) { ctx.abbruch(e); }
  });
}

const nummerVon = (id, art) => {
  const m = new RegExp(`^${art}(\\d+)$`).exec(typeof id === 'string' ? id : '');
  return m ? +m[1] : 0;
};
/** Hoechste Nummer je Art (t, u) in einem Bestand, auch in Archiv, Segmenten und Ankuendigungen. */
function hoechsteNummern(b) {
  const h = { t: 0, u: 0 };
  const sehe = (id, art) => { h[art] = Math.max(h[art], nummerVon(id, art)); };
  for (const t of b.toepfe || []) { sehe(t.id, 't'); for (const u of t.unter || []) sehe(u.id, 'u'); }
  for (const e of b.eintraege || []) if (e.angekuendigt) { sehe(e.angekuendigt.topfId, 't'); sehe(e.angekuendigt.unterId, 'u'); }
  for (const s of b.segmente || []) { sehe(s.topfId, 't'); sehe(s.unterId, 'u'); }
  return h;
}

/** Kompletter Bestand ohne Audio, in einer Lese-Transaktion. Toepfe nach reihenfolge, Rest nach id. */
export async function bestandLesen() {
  return tx([ABLAGEN.toepfe, ABLAGEN.eintraege, ABLAGEN.segmente], 'readonly', (s, ctx) => {
    const rt = s.toepfe.getAll(), re = s.eintraege.getAll(), rs = s.segmente.getAll();
    rs.onsuccess = () => {
      ctx.ergebnis = {
        toepfe: rt.result.sort((a, b) => a.reihenfolge - b.reihenfolge),
        eintraege: re.result.sort((a, b) => a.id - b.id),
        segmente: rs.result.sort((a, b) => a.id - b.id),
      };
    };
  });
}

/** Ersetzt den gesamten Bestand (Toepfe, Eintraege, Segmente, Audio) in EINER Transaktion. Schlaegt etwas fehl,
    bleibt der alte Bestand unveraendert. Eintraege kommen ohne Audio an (audioId null). Die Kennungszaehler
    steigen mindestens auf die hoechsten Nummern des neuen Bestands. */
export async function bestandErsetzen(b) {
  await tx([ABLAGEN.toepfe, ABLAGEN.eintraege, ABLAGEN.segmente, ABLAGEN.audio], 'readwrite', (s) => {
    s.toepfe.clear(); s.eintraege.clear(); s.segmente.clear(); s.audio.clear();
    for (const t of b.toepfe) s.toepfe.put(t);
    for (const e of b.eintraege) s.eintraege.put({ ...e, audioId: null });
    for (const x of b.segmente) s.segmente.put(x);
  });
  const h = hoechsteNummern(b);
  zaehlerHoch('t', h.t); zaehlerHoch('u', h.u);
}

/** Startbestand der Toepfe, keine Eintraege, keine Segmente, kein Audio. Key und Kennungszaehler bleiben. */
export function alleZuruecksetzen() {
  return bestandErsetzen({ toepfe: startbestandToepfe(), eintraege: [], segmente: [] });
}

/** Naechste freie Kennung der Art 't' (Topf) oder 'u' (Unterpunkt). Nie vergeben, auch nicht nach Loeschen oder
    Archivieren: der Zaehler in localStorage merkt sich die hoechste Nummer. */
export async function neueKennung(art) {
  const h = hoechsteNummern(await bestandLesen());
  const z = zaehlerLesen();
  const n = Math.max(h[art], +z[art] || 0) + 1;
  z[art] = n; zaehlerSchreiben(z);
  return art + n;
}

/** Legt einen neuen Topf an. Scheitert, wenn die Kennung schon existiert. */
export async function topfAnlegen(topf) {
  await tx([ABLAGEN.toepfe], 'readwrite', (s, ctx) => {
    const r = s.toepfe.get(topf.id);
    r.onsuccess = () => {
      if (r.result) ctx.abbruch(new Error(`Kennung ${topf.id} gibt es schon`));
      else s.toepfe.add(topf);
    };
  });
}

/** Speichert einen Topf mit Unterpunkten. Ein Unterpunkt, auf den Segmente verweisen, darf nicht aus der Liste
    fallen (nur archiviert werden). */
export async function topfSpeichern(topf) {
  await tx([ABLAGEN.toepfe, ABLAGEN.segmente], 'readwrite', (s, ctx) => {
    const rt = s.toepfe.get(topf.id), rs = s.segmente.getAll();
    rs.onsuccess = () => {
      const alt = rt.result;
      if (!alt) { ctx.abbruch(new Error(`Topf ${topf.id} gibt es nicht mehr`)); return; }
      const bleiben = new Set((topf.unter || []).map((u) => u.id));
      for (const u of alt.unter || []) {
        if (bleiben.has(u.id)) continue;
        const n = rs.result.filter((x) => x.topfId === topf.id && x.unterId === u.id).length;
        if (n) { ctx.abbruch(new Error(`Unterpunkt „${u.name}“ hat ${n} Segmente und lässt sich nur archivieren`)); return; }
      }
      s.toepfe.put(topf);
    };
  });
}

/** Schreibt mehrere Töpfe in einer Transaktion (Reihenfolge). */
export async function toepfeSpeichern(liste) {
  await tx([ABLAGEN.toepfe], 'readwrite', (s) => { for (const t of liste) s.toepfe.put(t); });
}

/** Loescht einen Topf. Hat er Segmente, bleibt er und scheitert mit Meldung (nur archivieren). */
export async function topfLoeschen(id) {
  await tx([ABLAGEN.toepfe, ABLAGEN.segmente], 'readwrite', (s, ctx) => {
    const rs = s.segmente.getAll();
    rs.onsuccess = () => {
      const n = rs.result.filter((x) => x.topfId === id).length;
      if (n) ctx.abbruch(new Error(`Topf hat ${n} Segmente und lässt sich nur archivieren`));
      else s.toepfe.delete(id);
    };
  });
}

/** Segmente je Topf und je Unterpunkt: { topf: { t1: 3 }, unter: { 't1/u2': 1 } }. */
export async function zaehleSegmente() {
  return tx([ABLAGEN.segmente], 'readonly', (s, ctx) => {
    const rs = s.segmente.getAll();
    rs.onsuccess = () => {
      const topf = {}, unter = {};
      for (const x of rs.result) {
        topf[x.topfId] = (topf[x.topfId] || 0) + 1;
        if (x.unterId != null) { const k = `${x.topfId}/${x.unterId}`; unter[k] = (unter[k] || 0) + 1; }
      }
      ctx.ergebnis = { topf, unter };
    };
  });
}
