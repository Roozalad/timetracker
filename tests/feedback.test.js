'use strict';
/* Feedback-Runde 1: Wegwischen vom Aufnahme-Button, Rueckfrage vor dem Ueberschreiben von Bloecken, Block von Hand
   fuer jeden Tag, Stichworte je Unterpunkt. Eigene Datenbanken, kein Netz, kein Key. */
import { test, gruppe, ok, eq, wirft, app } from './framework.js';

const db = await app('db');
const seg = await app('segments');
const akt = await app('aktionen');
const rec = await app('ui-record');
const ein = await app('ui-settings');
const zu = await app('zuordnen');
const kor = await app('ui-korrektur');

const MIN = 60000;
const T = (h, m = 0, tag = 13) => new Date(2026, 10, tag, h, m).getTime();
const namen = [];

async function frischeDb() {
  await db.schliesseDb();
  const n = `zeit-test-fb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  namen.push(n);
  await db.oeffneDb(n);
}
const block = (topfId, start, ende, quelle = 'manuell', text = '') =>
  ({ eintragId: null, topfId, unterId: null, start, ende, text, quelle, zeitQuelle: 'genannt' });

gruppe('Feedback: Wegwischen vom Button');
test('innerhalb des Buttons und knapp daneben: nicht weggewischt', () => {
  ok(!rec.istWeggewischt(0, 0, 100));
  ok(!rec.istWeggewischt(100, 0, 100));
  ok(!rec.istWeggewischt(0, -(100 + rec.WISCH_ABSTAND), 100), 'genau auf der Schwelle zaehlt noch nicht');
});
test('weit genug ausserhalb, in jede Richtung: weggewischt', () => {
  const d = 100 + rec.WISCH_ABSTAND + 1;
  for (const [x, y] of [[d, 0], [-d, 0], [0, d], [0, -d], [d * 0.8, d * 0.8]]) ok(rec.istWeggewischt(x, y, 100), `${x},${y}`);
});

gruppe('Feedback: Rueckfrage vor dem Ueberschreiben');
test('verdraengt(): geloescht, gekuerzt, unberuehrt', () => {
  const bestand = [
    { ...block('t1', T(9), T(10)), id: 1 },
    { ...block('t2', T(10), T(11)), id: 2 },
    { ...block('t3', T(12), T(13)), id: 3 },
  ];
  const erg = seg.einfuegen(bestand, [block('t4', T(9, 30), T(11))], { manuell: true });
  const v = seg.verdraengt(bestand, erg);
  eq(v.map((x) => [x.segment.id, x.art]), [[1, 'gekuerzt'], [2, 'geloescht']]);
});
test('verdraengt(): geteilter Block zaehlt als gekuerzt, der korrigierte Block selbst zaehlt nicht', () => {
  const bestand = [{ ...block('t1', T(9), T(12)), id: 1 }, { ...block('t2', T(13), T(14)), id: 2 }];
  const erg = seg.einfuegen(bestand.filter((s) => s.id !== 2), [{ ...bestand[1], start: T(10), ende: T(11) }], { manuell: true });
  eq(seg.verdraengt(bestand, erg, 2).map((x) => [x.segment.id, x.art]), [[1, 'gekuerzt']]);
});
test('Vorschau schreibt nichts, Speichern mit Bestaetigung verdraengt', async () => {
  await frischeDb();
  await akt.blockAnlegen(block('t1', T(9), T(10)));
  const neu = block('t2', T(9, 30), T(10, 30));
  const v = await akt.blockVorschau(neu);
  eq(v.length, 1); eq(v[0].art, 'gekuerzt');
  eq((await db.listSegmente()).length, 1, 'Vorschau hat geschrieben');
  await akt.blockAnlegen(neu, { erlaubt: v.map((x) => x.segment.id) });
  const s = await db.listSegmente();
  eq(s.map((x) => [x.topfId, x.start, x.ende]), [['t1', T(9), T(9, 30)], ['t2', T(9, 30), T(10, 30)]]);
});
test('Konflikt: ein inzwischen hinzugekommener Block wird nicht ungefragt ueberschrieben', async () => {
  await frischeDb();
  const neu = block('t2', T(9), T(10));
  const v = await akt.blockVorschau(neu);
  eq(v, []);
  await akt.blockAnlegen(block('t1', T(9, 15), T(9, 45)));   // kommt zwischen Vorschau und Speichern dazu
  const e = await wirft(() => akt.blockAnlegen(neu, { erlaubt: [] }));
  eq(e.message, akt.KONFLIKT);
  eq((await db.listSegmente()).map((x) => x.topfId), ['t1'], 'nichts geschrieben');
});
test('Korrektur: Vorschau und Konfliktpruefung', async () => {
  await frischeDb();
  await akt.blockAnlegen(block('t1', T(9), T(10)));
  await akt.blockAnlegen(block('t2', T(10), T(11)));
  const [a, b] = await db.listSegmente();
  const aenderung = { topfId: 't2', unterId: null, start: T(9, 30), ende: T(11) };
  const v = await akt.korrekturVorschau(b.id, aenderung);
  eq(v.map((x) => [x.segment.id, x.art]), [[a.id, 'gekuerzt']]);
  await wirft(() => akt.segmentKorrigieren(b.id, aenderung, { erlaubt: [] }), 'ohne Bestaetigung');
  await akt.segmentKorrigieren(b.id, aenderung, { erlaubt: [a.id] });
  eq((await db.listSegmente()).map((x) => [x.id, x.start, x.ende]), [[a.id, T(9), T(9, 30)], [b.id, T(9, 30), T(11)]]);
});
test('Ohne erlaubt bleibt das bisherige Verhalten (keine Pruefung)', async () => {
  await frischeDb();
  await akt.blockAnlegen(block('t1', T(9), T(10)));
  await akt.blockAnlegen(block('t2', T(9), T(10)));
  eq((await db.listSegmente()).map((x) => x.topfId), ['t2']);
});
test('Text der Rueckfrage nennt Zeit, Topf, Unterpunkt und was passiert', () => {
  const toepfe = [{ id: 't1', name: 'Privat', unter: [{ id: 'u1', name: 'Essen' }] }];
  const t = kor.verdraengtText([
    { segment: { ...block('t1', T(12), T(12, 30), 'ki', 'Mittag'), unterId: 'u1' }, art: 'geloescht' },
    { segment: block('unklar', T(13), T(14)), art: 'gekuerzt' },
  ], toepfe);
  eq(t, '12:00–12:30 Privat › Essen · Mittag: wird gelöscht\n13:00–14:00 Unklar: wird gekürzt');
});

gruppe('Feedback: Block von Hand fuer jeden Tag');
test('vergangener Tag ohne Bloecke: 09:00 bis 09:30', () => {
  eq(seg.blockVorgabeFuerTag(T(4, 0, 12), [], T(10, 0, 13)), { start: T(9, 0, 12), ende: T(9, 30, 12) });
});
test('vergangener Tag: im Anschluss an den letzten Block', () => {
  const s = [block('t1', T(14, 0, 12), T(17, 20, 12)), block('t1', T(9, 0, 13), T(10, 0, 13))];
  eq(seg.blockVorgabeFuerTag(T(4, 0, 12), s, T(10, 0, 13)), { start: T(17, 20, 12), ende: T(17, 50, 12) });
});
test('vergangener Tag: nie ueber das Tagesende (04:00)', () => {
  const s = [block('t1', T(1, 0, 13), T(3, 50, 13))];
  eq(seg.blockVorgabeFuerTag(T(4, 0, 12), s, T(10, 0, 13)), { start: T(3, 30, 13), ende: T(4, 0, 13) });
});
test('heute: bis jetzt, ab dem Ende des letzten Blocks', () => {
  const s = [block('t1', T(8), T(9, 40))];
  eq(seg.blockVorgabeFuerTag(T(4), s, T(10, 7)), { start: T(9, 40), ende: T(10, 7) });
});
test('zukuenftiger Tag: keine Vorgabe', () => {
  eq(seg.blockVorgabeFuerTag(T(4, 0, 14), [], T(10, 0, 13)), null);
});

gruppe('Feedback: Stichworte je Unterpunkt');
const TOPF = { id: 't1', name: 'Privat', hinweise: 'Privates', farbe: '#4C9F70', bezahlt: false, archiviert: false, reihenfolge: 0,
  unter: [{ id: 'u1', name: 'Zuhause', hinweise: 'Wäsche, Putzen' }, { id: 'u2', name: 'Spaß' }] };
test('Stichworte gehen mit an die Zuordnung, leere nicht', () => {
  const e = zu.baueEingabe({ zeit: T(10), fensterStart: null, transkript: 'Wäsche gemacht' }, null, [TOPF]);
  eq(e.toepfe[0].unter, [{ id: 'u1', name: 'Zuhause', hinweise: 'Wäsche, Putzen' }, { id: 'u2', name: 'Spaß' }]);
});
test('Export und Import behalten die Stichworte', async () => {
  await frischeDb();
  await db.bestandErsetzen({ toepfe: [TOPF], eintraege: [], segmente: [] });
  const neu = ein.pruefeImport(ein.baueExport(await db.bestandLesen()));
  eq(neu.toepfe[0].unter.map((u) => u.hinweise || null), ['Wäsche, Putzen', null]);
});
test('Import lehnt Stichworte ab, die kein Text sind', async () => {
  await frischeDb();
  await db.bestandErsetzen({ toepfe: [TOPF], eintraege: [], segmente: [] });
  const d = JSON.parse(ein.baueExport(await db.bestandLesen()));
  d.toepfe[0].unter[0].hinweise = 42;
  await wirft(() => ein.pruefeImport(JSON.stringify(d)));
});

test('Aufraeumen: Testdatenbanken loeschen', async () => {
  await db.schliesseDb();
  for (const n of namen) await db.loescheDatenbank(n);
});
