'use strict';
/* IndexedDB: Toepfe, Eintraege, Segmente, Audio (Abschnitt 6).
   Keine Logik ausser Speichern und Lesen. Segment-Pruefung (Ueberlappung) gehoert in segments.js. */
import { CONFIG } from './config.js?v=0.1.0';

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
/** Mischt patch in den Eintrag (lesen und schreiben in einer Transaktion). Liefert den neuen Stand oder null. */
export async function updateEintrag(id, patch) {
  let neu = null;
  await transaktion([ABLAGEN.eintraege], 'readwrite', (s) => {
    const r = s.eintraege.get(id);
    r.onsuccess = () => { if (r.result) { neu = { ...r.result, ...patch }; s.eintraege.put(neu); } };
  });
  return neu;
}
/** Loescht den Eintrag samt Audio (Segmente raeumt Paket C beim Loeschen ab). */
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
    Leeres Transkript: Status 'fertig' (Abschnitt 9), sonst 'wartet_zuordnung'. */
export async function transkriptSpeichern(id, text) {
  let neu = null;
  await transaktion([ABLAGEN.eintraege, ABLAGEN.audio], 'readwrite', (s) => {
    const r = s.eintraege.get(id);
    r.onsuccess = () => {
      const e = r.result;
      if (!e) return;
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
