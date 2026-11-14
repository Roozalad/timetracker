'use strict';
/* Anbindung der Zuordnung (Schritt 3), Aktionen auf Segmenten und atomares Speichern.
   Mit Ersatz-categorize (zuordnen._categorizeErsetzen) und mit Ersatz-fetch gegen das echte categorize. Kein echter Key, kein Netz. */
import { test, gruppe, ok, eq, wirft, app } from './framework.js';

const db = await app('db');
const pipeline = await app('pipeline');
const key = await app('key');
const logm = await app('log');
const zu = await app('zuordnen');
const akt = await app('aktionen');
const cat = await app('categorize');
const { UNKLAR } = await app('segments');
const namen = [];
const TESTKEY = 'sk-test-0123456789abcdef';
key._keySpeicherName(`zeit-test.zuordnenkey.${Date.now()}`);
logm._logSpeicherName('zeit-test.log');

const T = (h, m = 0, tag = 13) => new Date(2026, 10, tag, h, m).getTime(); // 13.11.2026 ist ein Freitag
const uhr = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const kurz = (l) => l.map((s) => `${uhr(s.start)}-${uhr(s.ende)} ${s.topfId}${s.quelle === 'manuell' ? '*' : ''}`);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function umgebung({ mitKey = true } = {}) {
  pipeline._testReset(); zu._categorizeErsetzen(null);
  await db.schliesseDb();
  const n = `zeit-test-zu-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  namen.push(n); await db.oeffneDb(n);
  if (mitKey) key.setKey(TESTKEY); else key.removeKey();
  pipeline.registriereZuordnung(zu.zuordnen);
}
const naechstesEnde = () => new Promise((res) => { const ab = pipeline.abonniere((ev) => { if (ev.typ === 'lauf_ende') { ab(); res(ev); } }); });
async function lauf(grund = 'test', opt = { manuell: true }) { const p = naechstesEnde(); await pipeline.starte(grund, opt); return p; }
/** Eintrag mit gespeichertem Transkript (wie nach Schritt 2). */
async function eintrag(zeit, transkript = 'Irgendein Transkript', fensterStart = null) {
  const e = await db.eintragMitAudioAnlegen({ zeit, fensterStart }, { buf: new ArrayBuffer(2), type: 'audio/mp4' });
  return db.transkriptSpeichern(e.id, transkript);
}
const antwort = (taetigkeiten, rest = {}) => ({ taetigkeiten, ab_jetzt: null, stimmung: null, unklar: null, ...rest });
const taet = (topf_id, start, ende, extra = {}) => ({ topf_id, unter_id: null, text: 'Text', start, ende, zeit_quelle: 'genannt', ...extra });
/** Ersatz-categorize: antworten ist eine Funktion (eingabe, nr) -> Antwort oder wirft. */
function ersatz(antworten) {
  const r = { eingaben: [], restore: () => zu._categorizeErsetzen(null) };
  zu._categorizeErsetzen(async (eingabe) => { r.eingaben.push(eingabe); return antworten(eingabe, r.eingaben.length); });
  return r;
}
const fehlerAntwort = (grund, art = 'ungueltig', msg = 'Antwort unbrauchbar: x') => new cat.CategorizeError(msg, { art, grund });

gruppe('zuordnen.js: ein Eintrag von Transkript bis Karte');
test('Antwort wird zu Segmenten, Eintrag fertig mit allen Feldern, alles atomar gespeichert', async () => {
  await umgebung();
  const c = ersatz(() => antwort(
    [taet('t2', '10:00', '10:30', { text: 'Mails' }), taet('t3', '10:30', '11:00', { text: 'Glasuren' })],
    { ab_jetzt: { topf_id: 't1', unter_id: 'u2', text: 'Mittagessen' }, stimmung: { wert: -1, stichwort: 'genervt' }, unklar: 'Name unklar' }));
  const e = await eintrag(T(11), 'Erst Mails, dann Glasuren', T(10));
  const ev = await lauf();
  ok(ev.ok, 'Lauf ohne Fehler');
  const neu = await db.getEintrag(e.id);
  eq(neu.status, 'fertig'); eq(neu.fehler, null);
  eq(neu.promptVersion, cat.PROMPT_VERSION);
  eq(neu.angekuendigt, { topfId: 't1', unterId: 'u2', text: 'Mittagessen' });
  eq(neu.stimmung, { wert: -1, stichwort: 'genervt' }); eq(neu.unklar, 'Name unklar');
  ok(!('segmente' in neu), 'segmente stehen nicht im Eintrag');
  const s = await db.listSegmente();
  eq(kurz(s), ['10:00-10:30 t2', '10:30-11:00 t3']);
  ok(s.every((x) => x.eintragId === e.id && x.quelle === 'ki' && x.id != null));
  eq(c.eingaben.length, 1);
  eq(c.eingaben[0].jetzt, 'Freitag 11:00'); eq(c.eingaben[0].fenster_start, '10:00'); eq(c.eingaben[0].angekuendigt, null);
  eq(c.eingaben[0].transkript, 'Erst Mails, dann Glasuren');
  c.restore();
});
test('Eingabe nach 7.2: nur id, hinweise, unter; keine Anzeigenamen, keine archivierten Töpfe', async () => {
  await umgebung();
  const t = await db.getTopf('t2'); await db.putTopf({ ...t, name: 'Geheimkunde GmbH', hinweise: 'Pitch, Investoren' });
  const t4 = await db.getTopf('t4'); await db.putTopf({ ...t4, name: 'Bauherr Meier', hinweise: 'Bauantrag', archiviert: true });
  const c = ersatz(() => antwort([]));
  await eintrag(T(11)); await lauf();
  const e = c.eingaben[0];
  eq(e.toepfe.map((x) => x.id), ['t1', 't2', 't3']);
  for (const x of e.toepfe) eq(Object.keys(x), ['id', 'hinweise', 'unter']);
  eq(e.toepfe[1], { id: 't2', hinweise: 'Pitch, Investoren', unter: [] });
  eq(e.toepfe[0].unter[1], { id: 'u2', name: 'Essen' });
  const text = JSON.stringify(e);
  ok(!text.includes('Geheimkunde') && !text.includes('Bauherr') && !text.includes('Bauantrag'), 'Name und archivierter Topf bleiben lokal');
  c.restore();
});
test('angekuendigt des Vorgängers geht als "<topf_id>: <text>" mit, auch im selben Lauf', async () => {
  await umgebung();
  const c = ersatz((_, nr) => nr === 1
    ? antwort([], { ab_jetzt: { topf_id: 't3', unter_id: null, text: 'Rechnungen' } })
    : antwort([taet('t3', '09:15', '10:20')]));
  await eintrag(T(9, 15), 'Sitze jetzt an den Rechnungen', null);
  await eintrag(T(10, 20), 'Bin damit fertig', T(9, 15));
  await lauf();
  eq(c.eingaben.length, 2);
  eq(c.eingaben[0].angekuendigt, null); eq(c.eingaben[0].fenster_start, null);
  eq(c.eingaben[1].angekuendigt, 't3: Rechnungen'); eq(c.eingaben[1].fenster_start, '09:15');
  ok(!JSON.stringify(c.eingaben[1]).includes('Töpferstudio: Rechnungen'));
  eq(kurz(await db.listSegmente()), ['09:15-10:20 t3']);
  c.restore();
});
test('ohne Fenster (anderer Tag) wird keine Ankündigung des Vorgängers gesendet', async () => {
  await umgebung();
  const c = ersatz((_, nr) => nr === 1 ? antwort([], { ab_jetzt: { topf_id: 't3', unter_id: null, text: 'Rechnungen' } }) : antwort([]));
  await eintrag(T(22, 0, 12)); await eintrag(T(9, 0, 13), 'Neuer Tag', null);
  await lauf();
  eq(c.eingaben[1].angekuendigt, null);
  c.restore();
});
test('Fall 11: nichts erkannt - Eintrag fertig ohne Segmente, unklar gesetzt', async () => {
  await umgebung();
  ersatz(() => antwort([], { unklar: 'Nur ein Test gesprochen' }));
  const e = await eintrag(T(15, 50), 'Ähm, Test, eins zwei.', T(15));
  await lauf();
  const neu = await db.getEintrag(e.id);
  eq(neu.status, 'fertig'); eq(neu.unklar, 'Nur ein Test gesprochen'); eq(await db.listSegmente(), []);
});
test('leeres Transkript (nur Leerzeichen): fertig ohne Aufruf der Zuordnung', async () => {
  await umgebung();
  const c = ersatz(() => antwort([]));
  const e = await eintrag(T(11), '   ');
  await lauf();
  eq((await db.getEintrag(e.id)).status, 'fertig'); eq(c.eingaben.length, 0);
});
test('die Pipeline mit dem echten Transkript-Schritt: Audio rein, Karte raus, Transkription nur einmal', async () => {
  await umgebung();
  let transkriptionen = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => { if (String(url).includes('/audio/transcriptions')) { transkriptionen++; return json(200, { text: 'Rechnungen geschrieben' }); } throw new Error('unerwartet'); };
  let nr = 0;
  const c = ersatz(() => { nr++; if (nr === 1) throw new cat.CategorizeError('Netzwerkfehler', { art: 'netz' }); return antwort([taet('t3', '10:00', '11:00')]); });
  try {
    const e = await db.eintragMitAudioAnlegen({ zeit: T(11), fensterStart: T(10) }, { buf: new ArrayBuffer(3), type: 'audio/mp4' });
    const ev1 = await lauf();
    eq(ev1.fehler.art, 'netz'); eq((await db.getEintrag(e.id)).status, 'wartet_zuordnung');
    await lauf();
    eq((await db.getEintrag(e.id)).status, 'fertig'); eq(transkriptionen, 1, 'Schritt 3 wiederholt nie Schritt 2');
    eq(kurz(await db.listSegmente()), ['10:00-11:00 t3']);
  } finally { globalThis.fetch = orig; c.restore(); }
});

gruppe('zuordnen.js: Fehlerverhalten (Abschnitt 9)');
for (const grund of ['antwort', 'unvollstaendig', 'verweigert']) {
  test(`${grund}: zweimal wiederholen, dann Status fehler; spätere Einträge laufen erst danach weiter`, async () => {
    await umgebung();
    const c = ersatz((ein, nr) => { if (nr <= 3) throw fehlerAntwort(grund); return antwort([taet('t2', '10:00', '11:00')]); });
    const a = await eintrag(T(10, 30), 'Erster', null);
    const b = await eintrag(T(11), 'Zweiter', T(10, 30));
    await lauf();
    eq(c.eingaben.map((x) => x.transkript), ['Erster', 'Erster', 'Erster', 'Zweiter'], 'drei Versuche, dann der nächste Eintrag');
    const ea = await db.getEintrag(a.id), eb = await db.getEintrag(b.id);
    eq(ea.status, 'fehler'); ok(ea.fehler.startsWith('Zuordnung fehlgeschlagen'), ea.fehler); eq(ea.promptVersion, cat.PROMPT_VERSION);
    eq(eb.status, 'fertig');
    eq((await db.listSegmente()).map((s) => s.eintragId), [b.id], 'der fehlgeschlagene Eintrag hat keine Segmente');
    c.restore();
  });
}
test('Antwort beim zweiten Versuch brauchbar: fertig', async () => {
  await umgebung();
  const c = ersatz((ein, nr) => { if (nr === 1) throw fehlerAntwort('antwort'); return antwort([taet('t2', '10:00', '11:00')]); });
  const e = await eintrag(T(11), 'x', T(10)); await lauf();
  eq(c.eingaben.length, 2); eq((await db.getEintrag(e.id)).status, 'fertig'); eq((await db.listSegmente()).length, 1);
  c.restore();
});
test('abgelehnt (HTTP 4xx): sofort Status fehler, keine Wiederholung', async () => {
  await umgebung();
  const c = ersatz(() => { throw fehlerAntwort('abgelehnt', 'ungueltig', 'HTTP 400: bad'); });
  const e = await eintrag(T(11), 'x', T(10)); await lauf();
  eq(c.eingaben.length, 1); eq((await db.getEintrag(e.id)).status, 'fehler');
  c.restore();
});
test('auth: Eintrag wartet, Schlange gesperrt, keine automatische Wiederholung, spätere Einträge warten mit', async () => {
  await umgebung();
  const c = ersatz(() => { throw new cat.CategorizeError('HTTP 401: Incorrect API key', { art: 'auth', status: 401 }); });
  const a = await eintrag(T(10), 'A', null); const b = await eintrag(T(11), 'B', T(10));
  const ev = await lauf();
  eq(ev.fehler.art, 'auth'); eq(c.eingaben.length, 1);
  eq((await db.getEintrag(a.id)).status, 'wartet_zuordnung'); eq((await db.getEintrag(b.id)).status, 'wartet_zuordnung');
  ok(pipeline.zustand().blockiert && pipeline.zustand().blockiert.art === 'auth');
  for (const g of ['online', 'sichtbar', 'start', 'pageshow']) await pipeline.starte(g);
  eq(c.eingaben.length, 1, 'keine automatische Wiederholung');
  c.restore();
});
for (const art of ['netz', 'server']) {
  test(`${art}: Eintrag bleibt wartet_zuordnung, nicht gesperrt, Wiederholung auf Knopfdruck`, async () => {
    await umgebung();
    const c = ersatz((ein, nr) => { if (nr === 1) throw new cat.CategorizeError('Problem', { art }); return antwort([taet('t2', '10:00', '11:00')]); });
    const a = await eintrag(T(11), 'A', T(10));
    const ev = await lauf();
    eq(ev.fehler.art, art); eq((await db.getEintrag(a.id)).status, 'wartet_zuordnung'); eq((await db.getEintrag(a.id)).fehler, 'Problem');
    ok(pipeline.zustand().blockiert === null);
    eq(await pipeline.wartendeAnzahl(), 1);
    await lauf(); eq((await db.getEintrag(a.id)).status, 'fertig');
    c.restore();
  });
}
test('kein Key: Zuordnung wartet ohne Netzaufruf', async () => {
  await umgebung({ mitKey: false });
  const orig = globalThis.fetch; let aufrufe = 0; globalThis.fetch = async () => { aufrufe++; return json(200, {}); };
  try {
    const a = await eintrag(T(11), 'A', T(10));
    const ev = await lauf();
    eq(ev.fehler.art, 'kein_key'); eq(aufrufe, 0); eq((await db.getEintrag(a.id)).status, 'wartet_zuordnung');
  } finally { globalThis.fetch = orig; }
});

gruppe('zuordnen.js: echtes categorize mit Ersatz-fetch');
test('Anfrage geht mit store:false, Kennungen und Hinweisen; die Antwort landet als Segment', async () => {
  await umgebung();
  const aufrufe = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opt) => {
    aufrufe.push({ url, opt });
    return json(200, { id: 'resp_1', status: 'completed', model: 'x', usage: {}, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(antwort([taet('t3', '10:00', '11:00', { text: 'Glasuren' })])) }] }] });
  };
  try {
    const a = await eintrag(T(10), 'Bin jetzt an den Glasuren', null);
    await db.updateEintrag(a.id, { angekuendigt: { topfId: 't3', unterId: null, text: 'Glasuren' } });
    await eintrag(T(11), 'Glasuren gemischt', T(10));
    await db.updateEintrag(a.id, { status: 'fertig' });
    await lauf();
    eq(aufrufe.length, 1);
    eq(aufrufe[0].url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(aufrufe[0].opt.body);
    eq(body.store, false);
    const ein = JSON.parse(body.input[0].content);
    eq(ein.angekuendigt, 't3: Glasuren'); eq(ein.jetzt, 'Freitag 11:00'); eq(ein.fenster_start, '10:00');
    eq(Object.keys(ein.toepfe[0]), ['id', 'hinweise', 'unter']);
    eq(kurz(await db.listSegmente()), ['10:00-11:00 t3']);
  } finally { globalThis.fetch = orig; }
});

gruppe('aktionen.js: atomar speichern, korrigieren, löschen');
test('segmenteAendern: Fehler mitten in der Berechnung schreibt nichts (Eintrag und Segmente unverändert)', async () => {
  await umgebung();
  const e = await eintrag(T(11), 'x', T(10));
  await akt.blockAnlegen({ topfId: 't2', unterId: null, start: T(10), ende: T(10, 30), eintragId: e.id });
  const vorher = JSON.stringify([await db.listSegmente(), await db.getEintrag(e.id)]);
  await wirft(() => db.segmenteAendern(() => { throw new Error('Berechnung kaputt'); }, { id: e.id, patch: { status: 'fertig', unklar: 'halb' } }));
  eq(JSON.stringify([await db.listSegmente(), await db.getEintrag(e.id)]), vorher);
  // fehlender Eintrag: nichts geschrieben
  const r = await db.segmenteAendern(() => ({ loeschen: [], schreiben: [{ topfId: 't1', start: 1, ende: 2 }] }), { id: 99999, patch: {} });
  eq(r.gefunden, false); eq((await db.listSegmente()).length, 1);
});
test('zuordnungSpeichern ersetzt nur die ki-Segmente des Eintrags, manuelle bleiben, neue werden darum gekürzt', async () => {
  await umgebung();
  const e = await eintrag(T(12), 'x', T(10));
  await akt.zuordnungSpeichern(e.id, { status: 'fertig' }, [
    { eintragId: e.id, topfId: 't2', unterId: null, start: T(10), ende: T(11), text: '', quelle: 'ki', zeitQuelle: 'genannt' },
    { eintragId: e.id, topfId: 't3', unterId: null, start: T(11), ende: T(12), text: '', quelle: 'ki', zeitQuelle: 'genannt' }]);
  const s = await db.listSegmente();
  await akt.segmentKorrigieren(s[1].id, { topfId: 't4', unterId: null, start: T(11), ende: T(11, 30) }); // manuell
  eq(kurz(await db.listSegmente()), ['10:00-11:00 t2', '11:00-11:30 t4*']);
  // Neu zuordnen: ki-Segmente ersetzen, manuelles 11:00-11:30 bleibt
  await akt.zuordnungSpeichern(e.id, { status: 'fertig' }, [
    { eintragId: e.id, topfId: 't1', unterId: null, start: T(10, 30), ende: T(12), text: '', quelle: 'ki', zeitQuelle: 'genannt' }]);
  eq(kurz(await db.listSegmente()), ['10:30-11:00 t1', '11:00-11:30 t4*', '11:30-12:00 t1']);
});
test('zuordnungSpeichern ohne Segmentliste (Status fehler) lässt die Segmente unberührt', async () => {
  await umgebung();
  const e = await eintrag(T(11), 'x', T(10));
  await akt.zuordnungSpeichern(e.id, { status: 'fertig' }, [{ eintragId: e.id, topfId: 't2', unterId: null, start: T(10), ende: T(11), text: '', quelle: 'ki', zeitQuelle: 'genannt' }]);
  await akt.zuordnungSpeichern(e.id, { status: 'fehler', fehler: 'kaputt' }, undefined);
  eq((await db.listSegmente()).length, 1); eq((await db.getEintrag(e.id)).status, 'fehler');
});
test('Korrektur: quelle manuell, id und Eintrag bleiben, Nachbarn werden verdrängt; kürzer als eine Minute wird abgewiesen', async () => {
  await umgebung();
  const e = await eintrag(T(12), 'x', T(10));
  await akt.zuordnungSpeichern(e.id, {}, [
    { eintragId: e.id, topfId: 't2', unterId: null, start: T(10), ende: T(11), text: 'A', quelle: 'ki', zeitQuelle: 'geschaetzt' },
    { eintragId: e.id, topfId: 't3', unterId: null, start: T(11), ende: T(12), text: 'B', quelle: 'ki', zeitQuelle: 'geschaetzt' }]);
  const [a] = await db.listSegmente();
  eq(await akt.segmentKorrigieren(a.id, { topfId: 't1', unterId: 'u2', start: T(10), ende: T(11, 30) }), true);
  const s = await db.listSegmente();
  eq(kurz(s), ['10:00-11:30 t1*', '11:30-12:00 t3']);
  eq([s[0].id, s[0].eintragId, s[0].unterId, s[0].text, s[0].zeitQuelle], [a.id, e.id, 'u2', 'A', 'genannt']);
  await wirft(() => akt.segmentKorrigieren(a.id, { topfId: 't1', unterId: null, start: T(10), ende: T(10, 0) }));
  await wirft(() => akt.segmentKorrigieren(424242, { topfId: 't1', unterId: null, start: T(10), ende: T(11) })); // Paket H: nicht still false
});
test('Block von Hand verdrängt auch manuelle; Block löschen; Eintrag löschen nimmt seine Blöcke mit, Handblöcke bleiben', async () => {
  await umgebung();
  const e = await eintrag(T(12), 'x', T(10));
  await akt.zuordnungSpeichern(e.id, {}, [{ eintragId: e.id, topfId: 't2', unterId: null, start: T(10), ende: T(12), text: '', quelle: 'ki', zeitQuelle: 'genannt' }]);
  await akt.blockAnlegen({ topfId: 't1', unterId: null, start: T(10, 30), ende: T(11) });
  let s = await db.listSegmente();
  eq(kurz(s), ['10:00-10:30 t2', '10:30-11:00 t1*', '11:00-12:00 t2']);
  eq(s[1].eintragId, null);
  await akt.blockAnlegen({ topfId: 't4', unterId: null, start: T(10, 45), ende: T(11, 15), eintragId: null });
  eq(kurz(await db.listSegmente()), ['10:00-10:30 t2', '10:30-10:45 t1*', '10:45-11:15 t4*', '11:15-12:00 t2']);
  await akt.segmentLoeschen((await db.listSegmente())[1].id);
  eq(kurz(await db.listSegmente()), ['10:00-10:30 t2', '10:45-11:15 t4*', '11:15-12:00 t2']);
  await akt.eintragLoeschen(e.id);
  eq(await db.getEintrag(e.id), undefined);
  eq(kurz(await db.listSegmente()), ['10:45-11:15 t4*'], 'nur der Handblock bleibt');
});
test('Eintrag löschen entfernt auch das Audio; Neu zuordnen braucht ein Transkript', async () => {
  await umgebung();
  const a = await db.eintragMitAudioAnlegen({ zeit: T(11) }, { buf: new ArrayBuffer(2), type: 'audio/mp4' });
  eq((await db.listAudioIds()).length, 1);
  eq(await akt.neuZuordnen(a.id), false, 'noch kein Transkript');
  await akt.eintragLoeschen(a.id);
  eq((await db.listAudioIds()).length, 0);
  const b = await eintrag(T(12), 'Text', null);
  await db.updateEintrag(b.id, { status: 'fehler', fehler: 'kaputt' });
  eq(await akt.neuZuordnen(b.id), true);
  const n = await db.getEintrag(b.id); eq([n.status, n.fehler], ['wartet_zuordnung', null]);
});
test('Neu zuordnen über die Pipeline: ersetzt ki-Segmente, behält manuelle', async () => {
  await umgebung();
  const c = ersatz((ein, nr) => nr === 1
    ? antwort([taet('t2', '10:00', '11:00'), taet('t3', '11:00', '12:00')])
    : antwort([taet('t1', '10:00', '12:00')]));
  const e = await eintrag(T(12), 'x', T(10));
  await lauf();
  eq(kurz(await db.listSegmente()), ['10:00-11:00 t2', '11:00-12:00 t3']);
  await akt.segmentKorrigieren((await db.listSegmente())[1].id, { topfId: 't4', unterId: null, start: T(11), ende: T(11, 30) });
  eq(await akt.neuZuordnen(e.id), true);
  await lauf();
  eq(kurz(await db.listSegmente()), ['10:00-11:00 t1', '11:00-11:30 t4*', '11:30-12:00 t1']);
  eq((await db.getEintrag(e.id)).status, 'fertig');
  c.restore();
});
test('Unbekannter Topf aus der Antwort wird zu unklar gespeichert', async () => {
  await umgebung();
  const c = ersatz(() => antwort([taet('t77', '10:00', '11:00')]));
  await eintrag(T(11), 'x', T(10)); await lauf();
  eq((await db.listSegmente()).map((s) => s.topfId), [UNKLAR]);
  c.restore();
});

test('Aufräumen: Testdatenbanken und Testschlüssel löschen', async () => {
  pipeline._testReset(); zu._categorizeErsetzen(null); key.removeKey();
  await db.schliesseDb();
  for (const n of namen) await db.loescheDatenbank(n);
});
