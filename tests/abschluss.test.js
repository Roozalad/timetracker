'use strict';
/* Paket H: Abschlusspruefung. Ablaeufe, die Daten verlieren konnten: veraltete Schreibvorgaenge der Schlange
   (Import oder zweiter Tab mitten im Lauf), haengende Antwortkoerper, Korrektur an einem inzwischen ersetzten Block.
   Ein zweiter Tab ist eine zweite Instanz von pipeline.js (anderes ?v=) auf derselben Datenbank. Kein Key, kein Netz. */
import { test, gruppe, ok, eq, wirft, app } from './framework.js';

const { CONFIG } = await app('config');
const db = await app('db');
const pipeline = await app('pipeline');
const tab2 = await import('../js/pipeline.js?v=zweiter-tab');
const key = await app('key');
const logm = await app('log');
const zu = await app('zuordnen');
const akt = await app('aktionen');
const cat = await app('categorize');
const namen = [];
const TESTKEY = 'sk-test-0123456789abcdef';
key._keySpeicherName(`zeit-test.abschlusskey.${Date.now()}`);
logm._logSpeicherName('zeit-test.log');

const T = (h, m = 0) => new Date(2026, 10, 13, h, m).getTime();
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const taet = (topf_id, start, ende) => ({ topf_id, unter_id: null, text: 'Text', start, ende, zeit_quelle: 'genannt' });
const antwort = (taetigkeiten) => ({ taetigkeiten, ab_jetzt: null, stimmung: null, unklar: null });
const tor = () => { let auf; const p = new Promise((r) => { auf = r; }); return { p, auf }; };
const naechstesEnde = (pl) => new Promise((res) => { const ab = pl.abonniere((ev) => { if (ev.typ === 'lauf_ende') { ab(); res(ev); } }); });
async function wartenBis(fn, ms = 3000) {
  const bis = Date.now() + ms;
  while (Date.now() < bis) { if (await fn()) return; await new Promise((r) => setTimeout(r, 5)); }
  throw new Error('Zustand nicht erreicht');
}
const mitFrist = (p, ms, was) => Promise.race([p, new Promise((_, nein) => setTimeout(() => nein(new Error(`${was} hängt`)), ms))]);

async function umgebung() {
  pipeline._testReset(); tab2._testReset(); zu._categorizeErsetzen(null);
  await db.schliesseDb();
  const n = `zeit-test-ab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  namen.push(n); await db.oeffneDb(n);
  key.setKey(TESTKEY);
  pipeline.registriereZuordnung(zu.zuordnen); tab2.registriereZuordnung(zu.zuordnen);
}
/** fetch der Transkription; handler(nr) -> Response (darf warten). */
function falschesFetch(handler) {
  const orig = globalThis.fetch;
  const r = { n: 0, restore: () => { globalThis.fetch = orig; } };
  globalThis.fetch = async (url, opt) => { r.n++; return handler(r.n, url, opt); };
  return r;
}
/** Ersatz-categorize: ein Block von fenster_start bis jetzt. */
function ersatz(vorher = async () => {}) {
  const r = { n: 0 };
  zu._categorizeErsetzen(async (ein) => {
    r.n++; await vorher(r.n);
    const bis = ein.jetzt.slice(-5);
    return antwort([taet('t2', ein.fenster_start || '08:00', bis)]);
  });
  return r;
}
const importBestand = (id) => ({
  toepfe: db.startbestandToepfe(),
  eintraege: [{ ...db.neuerEintragDaten({ zeit: T(8) }), id, status: 'fertig', transkript: 'importiert' }],
  segmente: [{ id: 1, eintragId: id, topfId: 't3', unterId: null, start: T(7), ende: T(8), text: 'importiert', quelle: 'ki', zeitQuelle: 'genannt' }],
});

gruppe('Paket H: veraltete Schreibvorgänge der Schlange');
test('Import während der Transkription: der importierte Eintrag gleicher id bleibt unverändert', async () => {
  await umgebung();
  const t = tor();
  const f = falschesFetch(async () => { await t.p; return json(200, { text: 'alte Aufnahme' }); });
  ersatz();
  try {
    const e = await db.eintragMitAudioAnlegen({ zeit: T(11), fensterStart: T(10) }, { buf: new ArrayBuffer(2), type: 'audio/mp4' });
    const ende = naechstesEnde(pipeline);
    pipeline.starte('test', { manuell: true });
    await wartenBis(() => f.n === 1);
    await db.bestandErsetzen(importBestand(e.id));
    t.auf(); await ende;
    const neu = await db.getEintrag(e.id);
    eq([neu.status, neu.transkript, neu.zeit], ['fertig', 'importiert', T(8)], 'importierter Eintrag');
    eq((await db.listSegmente()).map((s) => s.text), ['importiert'], 'importiertes Segment');
  } finally { f.restore(); zu._categorizeErsetzen(null); }
});
test('Import während der Zuordnung: Ergebnis wird verworfen, importierte Segmente bleiben', async () => {
  await umgebung();
  const t = tor();
  ersatz(async () => { await t.p; });
  const e = await db.transkriptSpeichern((await db.eintragMitAudioAnlegen({ zeit: T(11), fensterStart: T(10) }, { buf: new ArrayBuffer(2), type: 'audio/mp4' })).id, 'alter Text');
  const ende = naechstesEnde(pipeline);
  pipeline.starte('test', { manuell: true });
  await new Promise((r) => setTimeout(r, 30));
  await db.bestandErsetzen(importBestand(e.id));
  t.auf(); await ende;
  const neu = await db.getEintrag(e.id);
  eq([neu.status, neu.transkript], ['fertig', 'importiert']);
  eq((await db.listSegmente()).map((s) => s.text), ['importiert']);
  zu._categorizeErsetzen(null);
});
test('zwei Tabs: der langsamere Lauf setzt fertige Einträge nicht zurück und holt gelöschte Blöcke nicht zurück', async () => {
  await umgebung();
  const t = tor();
  // Aufruf 1 und 2 gelten E0 (je Tab einer); der zweite wartet. Aufruf 3 gilt E1 im schnelleren Tab.
  const f = falschesFetch(async (nr) => { if (nr === 2) { await t.p; return json(200, { text: 'zweiter Text' }); } return json(200, { text: `Text ${nr}` }); });
  const c = ersatz();
  try {
    const e0 = await db.eintragMitAudioAnlegen({ zeit: T(10), fensterStart: T(9) }, { buf: new ArrayBuffer(2), type: 'audio/mp4' });
    const e1 = await db.eintragMitAudioAnlegen({ zeit: T(11), fensterStart: T(10) }, { buf: new ArrayBuffer(2), type: 'audio/mp4' });
    const endeA = naechstesEnde(pipeline), endeB = naechstesEnde(tab2);
    pipeline.starte('test', { manuell: true }); tab2.starte('test', { manuell: true });
    await wartenBis(async () => (await db.listEintraege()).every((e) => e.status === 'fertig'));
    eq(c.n, 2, 'je Eintrag eine Zuordnung');
    // Nutzerin löscht einen falschen KI-Block
    const weg = (await db.listSegmente()).find((s) => s.eintragId === e0.id);
    await akt.segmentLoeschen(weg.id);
    t.auf(); await Promise.all([endeA, endeB]);
    const n0 = await db.getEintrag(e0.id), n1 = await db.getEintrag(e1.id);
    eq([n0.status, n0.transkript], ['fertig', 'Text 1'], 'E0 unverändert');
    eq([n1.status, n1.fehler], ['fertig', null], 'E1 nicht auf Fehler gesetzt');
    eq(c.n, 2, 'keine zweite Zuordnung');
    eq((await db.listSegmente()).map((s) => s.eintragId), [e1.id], 'gelöschter Block bleibt gelöscht');
  } finally { f.restore(); zu._categorizeErsetzen(null); }
});

gruppe('Paket H: hängende Antworten');
test('Transkription: hängt der Antwortkörper, endet der Lauf nach der Zeitgrenze und das Audio bleibt', async () => {
  await umgebung();
  const alt = CONFIG.requestTimeoutMs; CONFIG.requestTimeoutMs = 80;
  const f = falschesFetch(async (nr, url, opt) => ({
    ok: true, status: 200,
    json: () => new Promise((_, nein) => opt.signal.addEventListener('abort', () => nein(new DOMException('abgebrochen', 'AbortError')))),
  }));
  try {
    const e = await db.eintragMitAudioAnlegen({ zeit: T(11) }, { buf: new ArrayBuffer(2), type: 'audio/mp4' });
    const ende = naechstesEnde(pipeline);
    pipeline.starte('test', { manuell: true });
    const ev = await mitFrist(ende, 1500, 'Lauf');
    ok(!ev.ok, 'Lauf meldet Fehler');
    const n = await db.getEintrag(e.id);
    eq(n.status, 'wartet_transkription'); ok(n.audioId != null, 'Audio noch da');
    eq(pipeline.zustand().laeuft, false, 'Schlange frei für den nächsten Versuch');
  } finally { f.restore(); CONFIG.requestTimeoutMs = alt; }
});
test('Zuordnung: hängt der Antwortkörper, wirft categorize nach der Zeitgrenze', async () => {
  await umgebung();
  const alt = CONFIG.zuordnenTimeoutMs; CONFIG.zuordnenTimeoutMs = 80;
  const f = falschesFetch(async (nr, url, opt) => ({
    ok: true, status: 200,
    json: () => new Promise((_, nein) => opt.signal.addEventListener('abort', () => nein(new DOMException('abgebrochen', 'AbortError')))),
  }));
  try {
    const eingabe = { jetzt: 'Freitag 10:20', fenster_start: null, angekuendigt: null, toepfe: [{ id: 't1', hinweise: 'Privat', unter: [] }], transkript: 'x' };
    const err = await mitFrist(wirft(() => cat.categorize(eingabe)), 1500, 'categorize');
    eq([err.name, err.art], ['CategorizeError', 'netz']);
  } finally { f.restore(); CONFIG.zuordnenTimeoutMs = alt; }
});

gruppe('Paket H: Korrektur');
test('Korrektur an einem inzwischen neu zugeordneten Block geht nicht still verloren', async () => {
  await umgebung();
  const e = await db.transkriptSpeichern((await db.eintragMitAudioAnlegen({ zeit: T(12), fensterStart: T(10) }, { buf: new ArrayBuffer(2), type: 'audio/mp4' })).id, 'x');
  const seg = (topfId) => ({ eintragId: e.id, topfId, unterId: null, start: T(10), ende: T(12), text: '', quelle: 'ki', zeitQuelle: 'genannt' });
  await akt.zuordnungSpeichern(e.id, { status: 'fertig' }, [seg('t2')]);
  const [alt] = await db.listSegmente();          // die Nutzerin öffnet das Korrekturblatt für diesen Block
  await akt.zuordnungSpeichern(e.id, { status: 'fertig' }, [seg('t3')]); // derweil: Neu zuordnen ersetzt ihn
  const err = await wirft(() => akt.segmentKorrigieren(alt.id, { topfId: 't4', unterId: null, start: T(10), ende: T(11) }));
  ok(/inzwischen/.test(err.message), err.message);
});

test('Aufräumen: Testdatenbanken und Testschlüssel löschen', async () => {
  pipeline._testReset(); tab2._testReset(); zu._categorizeErsetzen(null); key.removeKey();
  await db.schliesseDb();
  for (const n of namen) await db.loescheDatenbank(n);
});
