'use strict';
/* Pipeline Schritt 1 und 2 gegen eine Test-Datenbank und ein falsches fetch. Kein echter Key, kein Netz. */
import { test, gruppe, ok, eq, app } from './framework.js';

const db = await app('db');
const pipeline = await app('pipeline');
const key = await app('key');
const logm = await app('log');
const namen = [];
const TESTKEY = 'sk-test-0123456789abcdef';
key._keySpeicherName(`zeit-test.key.${Date.now()}`);
logm._logSpeicherName('zeit-test.log');

async function umgebung({ mitKey = true } = {}) {
  pipeline._testReset();
  await db.schliesseDb();
  const n = `zeit-test-pl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  namen.push(n); await db.oeffneDb(n);
  if (mitKey) key.setKey(TESTKEY); else key.removeKey();
}
const blob = (n = 1) => new Blob(['a'.repeat(n)], { type: 'audio/mp4' });
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Ersetzt fetch; handler(nr, url, opt) -> Response oder wirft. Liefert { calls, aktivMax, restore }. */
function falschesFetch(handler, verzoegerungMs = 0) {
  const orig = globalThis.fetch;
  const r = { calls: [], aktiv: 0, aktivMax: 0, restore: () => { globalThis.fetch = orig; } };
  globalThis.fetch = async (url, opt) => {
    r.calls.push({ url, opt, dateiGroesse: opt.body.get('file').size });
    r.aktiv++; r.aktivMax = Math.max(r.aktivMax, r.aktiv);
    try {
      if (verzoegerungMs) await new Promise((res) => setTimeout(res, verzoegerungMs));
      return await handler(r.calls.length, url, opt);
    } finally { r.aktiv--; }
  };
  return r;
}
const naechstesEnde = () => new Promise((res) => { const ab = pipeline.abonniere((ev) => { if (ev.typ === 'lauf_ende') { ab(); res(ev); } }); });
/** Nimmt auf und wartet, bis der dadurch gestartete Lauf zu Ende ist. */
async function neueAufnahme(erg) { const ende = naechstesEnde(); const r = await pipeline.aufnahmeAbgeben(erg); await ende; return r; }
async function lauf(grund = 'test', opt = { manuell: true }) { const p = naechstesEnde(); await pipeline.starte(grund, opt); return p; }

gruppe('pipeline.js: Schritt 1 und 2');
test('normale Aufnahme: Eintrag, Transkript gespeichert, Audio gelöscht, wartet_zuordnung', async () => {
  await umgebung();
  const f = falschesFetch(() => json(200, { text: ' Hallo Welt ' }));
  try {
    const ende = naechstesEnde();
    const r = await pipeline.aufnahmeAbgeben({ blob: blob(3), zeit: Date.now(), dauerMs: 2000, weg: 'normal' });
    ok(r.ok && r.eintrag.status === 'wartet_transkription', 'sofort angelegt');
    await ende;
    const e = await db.getEintrag(r.eintrag.id);
    eq(e.status, 'wartet_zuordnung'); eq(e.transkript, 'Hallo Welt'); eq(e.audioId, null); eq(e.fehler, null);
    eq((await db.listAudioIds()).length, 0, 'Audio gelöscht');
    eq(f.calls.length, 1);
    eq(f.calls[0].url, 'https://api.openai.com/v1/audio/transcriptions');
    eq(f.calls[0].opt.headers.Authorization, `Bearer ${TESTKEY}`);
    eq(f.calls[0].opt.body.get('model'), 'gpt-transcribe');
    eq(f.calls[0].opt.body.getAll('languages[]'), ['de']);
    eq(f.calls[0].dateiGroesse, 3);
    eq(f.calls[0].opt.body.get('file').name, 'aufnahme.m4a');
  } finally { f.restore(); }
});
test('zeit ist der Moment des Drückens, fensterStart der vorherige Eintrag am selben Tag', async () => {
  await umgebung();
  const f = falschesFetch(() => json(200, { text: 'x' }));
  try {
    const z1 = new Date(2026, 10, 14, 9, 15).getTime(), z2 = new Date(2026, 10, 14, 10, 20).getTime();
    const a = await neueAufnahme({ blob: blob(), zeit: z1, dauerMs: 1000, weg: 'normal' });
    const b = await neueAufnahme({ blob: blob(), zeit: z2, dauerMs: 1000, weg: 'normal' });
    eq((await db.getEintrag(a.eintrag.id)).fensterStart, null);
    const e2 = await db.getEintrag(b.eintrag.id);
    eq(e2.zeit, z2); eq(e2.fensterStart, z1);
    // neuer Tag (nach 04:00 am Folgetag) -> kein Fenster
    const c = await neueAufnahme({ blob: blob(), zeit: new Date(2026, 10, 15, 4, 5).getTime(), dauerMs: 1000, weg: 'normal' });
    eq(c.eintrag.fensterStart, null);
  } finally { f.restore(); }
});
test('Netzfehler: Eintrag und Audio bleiben, Wiederholung auf Knopfdruck holt nach', async () => {
  await umgebung();
  const f = falschesFetch((nr) => { if (nr === 1) throw new TypeError('Failed to fetch'); return json(200, { text: 'nachgeholt' }); });
  try {
    const ende = naechstesEnde();
    const r = await pipeline.aufnahmeAbgeben({ blob: blob(), zeit: Date.now(), dauerMs: 2000, weg: 'normal' });
    const ev = await ende;
    ok(!ev.ok && ev.fehler.art === 'netz', 'Lauf meldet Netzfehler');
    let e = await db.getEintrag(r.eintrag.id);
    eq(e.status, 'wartet_transkription'); eq(e.fehler, 'Netzwerkfehler'); ok(e.audioId != null, 'Audio noch da');
    eq(await pipeline.wartendeAnzahl(), 1);
    ok(pipeline.zustand().blockiert === null, 'Netzfehler sperrt nicht');
    await lauf();
    e = await db.getEintrag(r.eintrag.id);
    eq(e.status, 'wartet_zuordnung'); eq(e.transkript, 'nachgeholt'); eq(e.fehler, null);
    eq(await pipeline.wartendeAnzahl(), 0);
  } finally { f.restore(); }
});
test('Serverfehler 503: Eintrag wartet, nicht gesperrt', async () => {
  await umgebung();
  const f = falschesFetch(() => json(503, { error: { message: 'overloaded' } }));
  try {
    await neueAufnahme({ blob: blob(), zeit: Date.now(), dauerMs: 1000, weg: 'normal' });
    const e = (await db.listEintraege())[0];
    eq(e.status, 'wartet_transkription'); ok(e.fehler.includes('503') && e.fehler.includes('overloaded'));
    ok(pipeline.zustand().blockiert === null);
  } finally { f.restore(); }
});
test('Neustart: wartender Eintrag wird beim nächsten Start gesendet', async () => {
  await umgebung();
  const f = falschesFetch(() => json(200, { text: 'nach Neustart' }));
  try {
    // Eintrag liegt wartend in der Datenbank (wie nach Neuladen der Seite), nichts läuft
    const e = await db.eintragMitAudioAnlegen({ zeit: Date.now() }, { buf: new ArrayBuffer(4), type: 'audio/mp4' });
    await lauf('start', {});
    eq((await db.getEintrag(e.id)).transkript, 'nach Neustart');
  } finally { f.restore(); }
});
test('Reihenfolge nach zeit, nie zwei gleichzeitig', async () => {
  await umgebung();
  const f = falschesFetch(() => json(200, { text: 'ok' }), 15);
  try {
    // später angelegt, aber früher gedrückt: Größe 1 = frühere zeit, 2 = spätere
    await db.eintragMitAudioAnlegen({ zeit: 2000 }, { buf: new ArrayBuffer(2), type: 'audio/mp4' });
    await db.eintragMitAudioAnlegen({ zeit: 1000 }, { buf: new ArrayBuffer(1), type: 'audio/mp4' });
    await lauf();
    eq(f.calls.map((c) => c.dateiGroesse), [1, 2], 'Reihenfolge');
    eq(f.aktivMax, 1, 'nie zwei gleichzeitig');
  } finally { f.restore(); }
});
test('leeres Transkript: Eintrag fertig, kein weiterer Schritt', async () => {
  await umgebung();
  const f = falschesFetch(() => json(200, { text: '  ' }));
  try {
    const r = await neueAufnahme({ blob: blob(), zeit: Date.now(), dauerMs: 1000, weg: 'normal' });
    const e = await db.getEintrag(r.eintrag.id);
    eq(e.status, 'fertig'); eq(e.transkript, ''); eq(e.audioId, null);
  } finally { f.restore(); }
});

gruppe('pipeline.js: Key-Fälle');
test('ungültiger Key (401): deutliche Meldung, keine automatische Wiederholung, Knopfdruck und Key-Änderung entsperren', async () => {
  await umgebung();
  const f = falschesFetch((nr) => nr <= 2
    ? json(401, { error: { message: `Incorrect API key provided: ${TESTKEY}. You can find your API key at https://platform.openai.com.` } })
    : json(200, { text: 'jetzt ok' }));
  try {
    const ende = naechstesEnde();
    const r = await pipeline.aufnahmeAbgeben({ blob: blob(), zeit: Date.now(), dauerMs: 1000, weg: 'normal' });
    const ev = await ende;
    eq(f.calls.length, 1);
    eq(ev.fehler.art, 'auth'); ok(ev.fehler.meldung.startsWith('HTTP 401: Incorrect API key'), ev.fehler.meldung);
    ok(!ev.fehler.meldung.includes(TESTKEY) && !JSON.stringify(await db.listEintraege()).includes(TESTKEY), 'Key nicht in Meldung und Eintrag');
    ok(!logm.logText().includes(TESTKEY), 'Key nicht im Protokoll');
    eq(pipeline.zustand().blockiert.art, 'auth');
    // automatische Auslöser tun nichts
    for (const g of ['online', 'sichtbar', 'start', 'pageshow']) await pipeline.starte(g);
    eq(f.calls.length, 1, 'keine Dauerschleife, keine automatische Wiederholung');
    eq((await db.getEintrag(r.eintrag.id)).status, 'wartet_transkription');
    // Knopfdruck versucht es wieder (und scheitert wieder, Fake liefert noch 401)
    await lauf(); eq(f.calls.length, 2);
    ok(pipeline.zustand().blockiert !== null);
    // Key-Änderung entsperrt und sendet
    const p = naechstesEnde(); key.setKey('sk-neuer-key-9999'); pipeline.schluesselGeaendert(); await p;
    eq(f.calls.length, 3); eq((await db.getEintrag(r.eintrag.id)).transkript, 'jetzt ok');
    ok(pipeline.zustand().blockiert === null);
  } finally { f.restore(); }
});
test('Guthaben leer (429 insufficient_quota) sperrt wie ein ungültiger Key', async () => {
  await umgebung();
  const f = falschesFetch(() => json(429, { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } }));
  try {
    await neueAufnahme({ blob: blob(), zeit: Date.now(), dauerMs: 1000, weg: 'normal' });
    eq(pipeline.zustand().blockiert.art, 'auth');
    ok(pipeline.zustand().blockiert.meldung.includes('quota'));
  } finally { f.restore(); }
});
test('kein Key: Aufnahme wird gespeichert und wartet, kein Netzaufruf', async () => {
  await umgebung({ mitKey: false });
  const f = falschesFetch(() => json(200, { text: 'x' }));
  try {
    const ende = naechstesEnde();
    const r = await pipeline.aufnahmeAbgeben({ blob: blob(), zeit: Date.now(), dauerMs: 1000, weg: 'normal' });
    const ev = await ende;
    eq(f.calls.length, 0); eq(ev.fehler.art, 'kein_key');
    eq(pipeline.zustand().blockiert.art, 'kein_key');
    eq((await db.getEintrag(r.eintrag.id)).status, 'wartet_transkription');
    eq(await pipeline.wartendeAnzahl(), 1);
    // Key eintragen -> Eintrag wird nachgesendet
    const p = naechstesEnde(); key.setKey(TESTKEY); pipeline.schluesselGeaendert(); await p;
    eq((await db.getEintrag(r.eintrag.id)).status, 'wartet_zuordnung'); eq(f.calls.length, 1);
  } finally { f.restore(); }
});

gruppe('pipeline.js: Einhängestelle Zuordnung');
test('Zuordnungsfunktion bekommt Eintrag und Vorgänger; Rückgabe wird gemischt, Status fertig', async () => {
  await umgebung();
  const f = falschesFetch(() => json(200, { text: 'Transkript' }));
  const gesehen = [];
  pipeline.registriereZuordnung(async (e, kontext) => { gesehen.push({ text: e.transkript, status: e.status, vorgaenger: kontext.vorgaenger && kontext.vorgaenger.zeit }); return { unklar: 'Hinweis', promptVersion: 1 }; });
  try {
    const a = await neueAufnahme({ blob: blob(), zeit: 1000, dauerMs: 1000, weg: 'normal' });
    const b = await neueAufnahme({ blob: blob(), zeit: 2000, dauerMs: 1000, weg: 'normal' });
    eq(gesehen, [{ text: 'Transkript', status: 'wartet_zuordnung', vorgaenger: null }, { text: 'Transkript', status: 'wartet_zuordnung', vorgaenger: 1000 }]);
    const e = await db.getEintrag(b.eintrag.id);
    eq(e.status, 'fertig'); eq(e.unklar, 'Hinweis'); eq(e.promptVersion, 1);
  } finally { f.restore(); pipeline._testReset(); }
});
test('Fehler in der Zuordnung: Eintrag bleibt wartet_zuordnung, Transkription wird nie wiederholt', async () => {
  await umgebung();
  const f = falschesFetch(() => json(200, { text: 'T' }));
  let n = 0;
  pipeline.registriereZuordnung(async () => { n++; if (n === 1) throw new Error('Zuordnung kaputt'); return {}; });
  try {
    const r = await neueAufnahme({ blob: blob(), zeit: Date.now(), dauerMs: 1000, weg: 'normal' });
    let e = await db.getEintrag(r.eintrag.id);
    eq(e.status, 'wartet_zuordnung'); eq(e.fehler, 'Zuordnung kaputt');
    await lauf();
    e = await db.getEintrag(r.eintrag.id);
    eq(e.status, 'fertig'); eq(n, 2); eq(f.calls.length, 1, 'Transkription nur einmal');
  } finally { f.restore(); pipeline._testReset(); }
});

test('Aufräumen: Testdatenbanken und Testschlüssel löschen', async () => {
  pipeline._testReset(); key.removeKey();
  await db.schliesseDb();
  for (const n of namen) await db.loescheDatenbank(n);
});
