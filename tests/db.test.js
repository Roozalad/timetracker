'use strict';
import { test, gruppe, ok, eq, app } from './framework.js';

const db = await app('db');
const namen = [];
async function frischeDb() {
  await db.schliesseDb();
  const n = `zeit-test-db-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  namen.push(n);
  await db.oeffneDb(n);
  return n;
}
const audio = (inhalt = 'abc') => ({ buf: new TextEncoder().encode(inhalt).buffer, type: 'audio/mp4' });

gruppe('db.js: Startbestand');
test('vier Töpfe mit den festen Kennungen', async () => {
  await frischeDb();
  const t = await db.listToepfe();
  eq(t.map((x) => x.id), ['t1', 't2', 't3', 't4']);
  eq(t.map((x) => x.name), ['Privat', 'Startup', 'Töpferstudio', 'Wohnungsbauprojekte']);
  eq(t.map((x) => x.farbe), ['#4C9F70', '#3B82C4', '#D97B29', '#8E5BB5']);
  eq(t.map((x) => x.bezahlt), [null, true, true, false]);
  eq(t.map((x) => x.reihenfolge), [1, 2, 3, 4]);
  ok(t.every((x) => x.archiviert === false && x.hinweise === x.name), 'Hinweise gleich Name, nicht archiviert');
});
test('Privat hat die sieben Unterpunkte, die anderen keine', async () => {
  const t = await db.listToepfe();
  eq(t[0].unter.map((u) => u.name), ['Morgen- und Abendroutine', 'Essen', 'Freunde', 'Hobby', 'Spaß', 'Zuhause', 'Organisation']);
  eq(new Set(t[0].unter.map((u) => u.id)).size, 7, 'eindeutige Kennungen');
  ok(t.slice(1).every((x) => x.unter.length === 0));
});
test('erneutes Öffnen legt den Startbestand nicht doppelt an', async () => {
  const n = namen[namen.length - 1];
  await db.schliesseDb(); await db.oeffneDb(n);
  eq((await db.listToepfe()).length, 4);
});
test('Topf ändern bleibt gespeichert, Kennung bleibt', async () => {
  const t = (await db.listToepfe())[1];
  await db.putTopf({ ...t, name: 'Startup GmbH' });
  const neu = await db.getTopf('t2');
  eq(neu.name, 'Startup GmbH'); eq(neu.id, 't2');
});

gruppe('db.js: Einträge und Audio');
test('Eintrag mit Audio anlegen und lesen', async () => {
  await frischeDb();
  const e = await db.eintragMitAudioAnlegen({ zeit: 1000, fensterStart: null }, audio('hallo'));
  ok(typeof e.id === 'number' && e.audioId != null, 'id und audioId');
  const g = await db.getEintrag(e.id);
  eq(g.zeit, 1000); eq(g.status, 'wartet_transkription'); eq(g.transkript, null);
  eq(g.fensterStart, null); eq(g.angekuendigt, null); eq(g.stimmung, null); eq(g.unklar, null);
  eq(g.promptVersion, null); eq(g.fehler, null); eq(g.audioId, e.audioId);
  const a = await db.getAudio(g.audioId);
  eq(a.type, 'audio/mp4'); eq(new TextDecoder().decode(a.buf), 'hallo'); ok(typeof a.erstelltAm === 'number');
});
test('listEintraege sortiert nach zeit und filtert nach Status', async () => {
  await db.eintragMitAudioAnlegen({ zeit: 500 }, audio());
  await db.eintragMitAudioAnlegen({ zeit: 2000 }, audio());
  eq((await db.listEintraege()).map((e) => e.zeit), [500, 1000, 2000]);
  eq((await db.listEintraege({ status: 'fertig' })).length, 0);
  eq((await db.listEintraege({ status: ['wartet_transkription', 'fertig'] })).length, 3);
});
test('updateEintrag mischt Felder, unbekannte id liefert null', async () => {
  const e = (await db.listEintraege())[0];
  const neu = await db.updateEintrag(e.id, { fehler: 'x' });
  eq(neu.fehler, 'x'); eq(neu.zeit, e.zeit);
  eq(await db.updateEintrag(99999, { fehler: 'y' }), null);
});
test('transkriptSpeichern: Text speichern, Audio löschen, Status wartet_zuordnung', async () => {
  await frischeDb();
  const e = await db.eintragMitAudioAnlegen({ zeit: 1 }, audio());
  const neu = await db.transkriptSpeichern(e.id, 'Text da');
  eq(neu.status, 'wartet_zuordnung'); eq(neu.transkript, 'Text da'); eq(neu.audioId, null);
  eq(await db.getAudio(e.audioId), undefined);
  eq((await db.listAudioIds()).length, 0);
});
test('transkriptSpeichern mit leerem Text: Status fertig', async () => {
  const e = await db.eintragMitAudioAnlegen({ zeit: 2 }, audio());
  eq((await db.transkriptSpeichern(e.id, '')).status, 'fertig');
});
test('deleteEintrag löscht auch das Audio', async () => {
  const e = await db.eintragMitAudioAnlegen({ zeit: 3 }, audio());
  await db.deleteEintrag(e.id);
  eq(await db.getEintrag(e.id), undefined); eq(await db.getAudio(e.audioId), undefined);
});

gruppe('db.js: Segmente');
test('Segment speichern und nach Start sortiert lesen', async () => {
  await db.putSegment({ eintragId: null, topfId: 't2', unterId: null, start: 200, ende: 300, text: 'b', quelle: 'manuell', zeitQuelle: 'genannt' });
  await db.putSegment({ eintragId: 1, topfId: 't1', unterId: null, start: 100, ende: 200, text: 'a', quelle: 'ki', zeitQuelle: 'geschaetzt' });
  const s = await db.listSegmente();
  eq(s.map((x) => x.text), ['a', 'b']);
  await db.deleteSegment(s[0].id);
  eq((await db.listSegmente()).length, 1);
});

test('Aufräumen: Testdatenbanken löschen', async () => {
  await db.schliesseDb();
  for (const n of namen) await db.loescheDatenbank(n);
});
