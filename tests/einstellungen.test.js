'use strict';
/* Tests Paket E: Export und Import, Kennungen, Toepfe und Unterpunkte mit Segmenten, Archiv, Alles loeschen.
   Eigene Datenbanken, eigener Kennungszaehler und eigener Speichername fuer den Key: die App-Datenbank und der
   echte Key werden nicht beruehrt. Nicht in tests/main.js eingetragen (das macht die Projektleitung). */
import { test, gruppe, ok, eq, wirft, app } from './framework.js';

const db = await app('db');
const ein = await app('ui-settings');
const key = await app('key');

const namen = [], kennungNamen = [];
const TESTKEY_SPEICHER = `zeit-test-key-${Date.now()}`;
const MIN = 60000;
const ZEIT = new Date(2026, 10, 13, 10, 0).getTime();   // 13.11.2026, 10:00 Ortszeit

async function frischeDb() {
  await db.schliesseDb();
  const n = `zeit-test-db-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  namen.push(n);
  await db.oeffneDb(n);
  const k = `zeit-test-kennungen-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  kennungNamen.push(k);
  db._kennungSpeicherName(k);
}
/** Frische Datenbank mit zwei Eintraegen (einer mit Audio) und zwei Segmenten: t2 und t1/u2. */
async function befuellen() {
  await frischeDb();
  const e1 = await db.eintragMitAudioAnlegen({ zeit: ZEIT }, { buf: new Uint8Array([1, 2, 3]).buffer, type: 'audio/mp4' });
  await db.transkriptSpeichern(e1.id, 'Pitch-Deck fürs Startup');
  const e2 = await db.eintragMitAudioAnlegen({ zeit: ZEIT + 60 * MIN, fensterStart: ZEIT }, { buf: new Uint8Array([9]).buffer, type: 'audio/mp4' });
  await db.putSegment({ eintragId: e1.id, topfId: 't2', unterId: null, start: ZEIT, ende: ZEIT + 60 * MIN, text: 'Pitch-Deck', quelle: 'ki', zeitQuelle: 'genannt' });
  await db.putSegment({ eintragId: null, topfId: 't1', unterId: 'u2', start: ZEIT + 60 * MIN, ende: ZEIT + 90 * MIN, text: 'Mittag', quelle: 'manuell', zeitQuelle: 'genannt' });
  return { e1, e2 };
}
/** Schluessel sortieren, damit JSON-Vergleiche nicht an der Reihenfolge der Felder scheitern. */
const kanon = (x) => JSON.parse(JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((s) => [s, v[s]])) : v)));

gruppe('Einstellungen: Export und Import');
test('Export und Wiedereinlesen ergibt denselben Bestand', async () => {
  await befuellen();
  const vorher = kanon(await db.bestandLesen());
  const neu = ein.pruefeImport(ein.baueExport(await db.bestandLesen()));
  await db.bestandErsetzen(neu);
  const nachher = kanon(await db.bestandLesen());
  eq(nachher.toepfe, vorher.toepfe, 'Töpfe');
  eq(nachher.segmente, vorher.segmente, 'Segmente');
  eq(nachher.eintraege, kanon(vorher.eintraege.map((e) => ({ ...e, audioId: null }))), 'Einträge ohne Audio');
  eq(await db.listAudioIds(), [], 'kein Audio nach dem Import');
});
test('Export enthält Töpfe, Einträge und Segmente im Format 1', async () => {
  await befuellen();
  const d =JSON.parse(ein.baueExport(await db.bestandLesen()));
  eq(d.app, 'zeiterfassung'); eq(d.format, 1);
  eq(d.toepfe.length, 4); eq(d.eintraege.length, 2); eq(d.segmente.length, 2);
});
test('Export enthält weder Key noch Audio', async () => {
  await befuellen();
  const geheim = `sk-test-geheim-${Date.now()}`;   // reiner Testwert, kein echter Key
  key._keySpeicherName(TESTKEY_SPEICHER);
  try {
    key.setKey(geheim);
    const text = ein.baueExport(await db.bestandLesen());
    ok(!text.includes(geheim), 'Key steht im Export');
    ok(!text.includes('openaiKey'), 'Name des Key-Speichers steht im Export');
    ok(!text.includes('"buf"'), 'Audio-Puffer im Export');
    ok(!/"audioId":\s*\d/.test(text), 'audioId mit Wert im Export');
  } finally {
    key.removeKey(); key._keySpeicherName(undefined);
  }
});
test('Import setzt audioId auf null', async () => {
  await befuellen();
  const gut = JSON.parse(ein.baueExport(await db.bestandLesen()));
  gut.eintraege[0].audioId = 5;
  eq(ein.pruefeImport(JSON.stringify(gut)).eintraege[0].audioId, null);
});
test('Kaputter Import ändert nichts', async () => {
  await befuellen();
  const vorher = kanon(await db.bestandLesen());
  const gut = JSON.parse(ein.baueExport(await db.bestandLesen()));
  const varianten = {
    'leere Datei': '',
    'kein JSON': '{"app": ',
    'fremde App': JSON.stringify({ ...gut, app: 'andere' }),
    'falsches Format': JSON.stringify({ ...gut, format: 99 }),
    'Feld fehlt': JSON.stringify({ ...gut, segmente: undefined }),
    'Topf unbekannt': JSON.stringify({ ...gut, segmente: [{ ...gut.segmente[0], topfId: 't99' }] }),
    'Unterpunkt gehört nicht zum Topf': JSON.stringify({ ...gut, segmente: [{ ...gut.segmente[1], topfId: 't2' }] }),
    'Segmente überlappen': JSON.stringify({ ...gut, segmente: [gut.segmente[0], { ...gut.segmente[0], id: 999 }] }),
    'Ende vor Start': JSON.stringify({ ...gut, segmente: [{ ...gut.segmente[0], start: gut.segmente[0].ende }] }),
    'Eintrag doppelt': JSON.stringify({ ...gut, eintraege: [gut.eintraege[0], gut.eintraege[0]] }),
    'Farbe ungültig': JSON.stringify({ ...gut, toepfe: gut.toepfe.map((t, i) => (i === 0 ? { ...t, farbe: 'rot' } : t)) }),
    'Kennung doppelt': JSON.stringify({ ...gut, toepfe: [gut.toepfe[0], gut.toepfe[0]] }),
  };
  for (const [name, text] of Object.entries(varianten)) {
    const e = await wirft(async () => ein.pruefeImport(text), name);
    ok(/Es wurde nichts geändert/.test(e.message), `${name}: Meldung`);
  }
  eq(kanon(await db.bestandLesen()), vorher, 'Bestand verändert');
});
test('Fehlgeschlagenes Ersetzen mitten in der Transaktion lässt den alten Bestand stehen', async () => {
  await befuellen();
  const vorher = kanon(await db.bestandLesen());
  await wirft(() => db.bestandErsetzen({
    toepfe: [{ id: 't1', name: 'Neu', hinweise: 'x', farbe: '#000000', bezahlt: null, unter: [], archiviert: false, reihenfolge: 1 },
      { name: 'ohne Kennung' }],   // ohne id: put wirft mitten in der Transaktion
    eintraege: [], segmente: [],
  }), 'Ersetzen');
  eq(kanon(await db.bestandLesen()), vorher, 'Bestand verändert');
});

gruppe('Einstellungen: Kennungen');
test('Kennungen werden nicht wiederverwendet, auch nicht nach Löschen oder Archivieren', async () => {
  await frischeDb();
  eq(await db.neueKennung('t'), 't5');
  await db.topfAnlegen({ id: 't5', name: 'Test', hinweise: 'Test', farbe: '#000000', bezahlt: null, unter: [], archiviert: false, reihenfolge: 5 });
  await db.topfLoeschen('t5');
  eq(await db.neueKennung('t'), 't6', 'nach dem Löschen von t5');
  await db.topfAnlegen({ id: 't6', name: 'Zwei', hinweise: 'Zwei', farbe: '#000000', bezahlt: null, unter: [], archiviert: false, reihenfolge: 6 });
  await db.topfSpeichern({ ...(await db.getTopf('t6')), archiviert: true });
  eq(await db.neueKennung('t'), 't7', 'nach dem Archivieren von t6');
  eq(await db.neueKennung('u'), 'u8', 'Unterpunkt nach u7 im Startbestand');
});
test('Nach einem Import vergibt die App keine vorhandene Kennung', async () => {
  await befuellen();
  const gut = JSON.parse(ein.baueExport(await db.bestandLesen()));
  gut.toepfe.push({ ...gut.toepfe[0], id: 't20', name: 'Aus Datei', unter: [] });
  await db.bestandErsetzen(ein.pruefeImport(JSON.stringify(gut)));
  eq(await db.neueKennung('t'), 't21');
});

gruppe('Einstellungen: Töpfe');
test('Topf mit Segmenten lässt sich nicht löschen, ohne Segmente schon', async () => {
  await befuellen();   // Segment auf t2
  const e = await wirft(() => db.topfLoeschen('t2'), 'Löschen erlaubt');
  ok(/Segment/.test(e.message), 'Meldung nennt die Segmente');
  ok((await db.listToepfe()).some((t) => t.id === 't2'), 't2 ist noch da');
  await db.topfLoeschen('t4');
  ok(!(await db.listToepfe()).some((t) => t.id === 't4'), 't4 ist gelöscht');
});
test('Unterpunkt mit Segmenten lässt sich nur archivieren', async () => {
  await befuellen();   // Segment auf t1/u2
  const t1 = await db.getTopf('t1');
  await wirft(() => db.topfSpeichern({ ...t1, unter: t1.unter.filter((u) => u.id !== 'u2') }), 'Löschen erlaubt');
  await db.topfSpeichern({ ...t1, unter: t1.unter.map((u) => (u.id === 'u2' ? { ...u, archiviert: true } : u)) });
  eq((await db.getTopf('t1')).unter.find((u) => u.id === 'u2').archiviert, true, 'u2 archiviert');
  const t1b = await db.getTopf('t1');
  await db.topfSpeichern({ ...t1b, unter: t1b.unter.filter((u) => u.id !== 'u3') });
  ok(!(await db.getTopf('t1')).unter.some((u) => u.id === 'u3'), 'u3 ohne Segmente gelöscht');
});
test('Archivierte Töpfe bleiben mit ihren Daten und lassen sich wiederherstellen', async () => {
  await befuellen();
  await db.topfSpeichern({ ...(await db.getTopf('t2')), archiviert: true });
  const alle = await db.listToepfe();
  eq(alle.length, 4, 'Archivierte fehlen nicht in der Liste');
  eq(alle.find((t) => t.id === 't2').archiviert, true);
  eq((await db.zaehleSegmente()).topf.t2, 1, 'Segment bleibt gezählt');
  const d = JSON.parse(ein.baueExport(await db.bestandLesen()));
  ok(d.toepfe.some((t) => t.id === 't2' && t.archiviert === true), 'Export enthält das Archiv');
  await db.topfSpeichern({ ...(await db.getTopf('t2')), archiviert: false });
  eq((await db.getTopf('t2')).archiviert, false, 'wiederhergestellt');
});
test('Reihenfolge lässt sich speichern', async () => {
  await frischeDb();
  const [a, b] = await db.listToepfe();
  await db.toepfeSpeichern([{ ...a, reihenfolge: 2 }, { ...b, reihenfolge: 1 }]);
  eq((await db.listToepfe()).slice(0, 2).map((t) => t.id), ['t2', 't1']);
});
test('Hinweistext unter dem Feld Hinweise steht wörtlich', async () => {
  eq(ein.HINWEIS_KI, 'Diese Stichworte gehen an die KI. Der Name oben bleibt auf dem Gerät.');
});
test('Alles löschen setzt die Töpfe auf den Startbestand, der Key bleibt', async () => {
  await befuellen();
  key._keySpeicherName(TESTKEY_SPEICHER);
  try {
    key.setKey('sk-test-bleibt');
    await db.alleZuruecksetzen();
    eq(kanon(await db.listToepfe()), kanon(db.startbestandToepfe()), 'Startbestand');
    eq(await db.listEintraege(), [], 'keine Einträge');
    eq(await db.listSegmente(), [], 'keine Segmente');
    eq(await db.listAudioIds(), [], 'kein Audio');
    eq(key.getKey(), 'sk-test-bleibt', 'Key geblieben');
  } finally {
    key.removeKey(); key._keySpeicherName(undefined);
  }
});

test('Aufräumen: Testdatenbanken und Testspeicher entfernen', async () => {
  await db.schliesseDb();
  for (const n of namen) await db.loescheDatenbank(n);
  for (const k of kennungNamen) localStorage.removeItem(k);
  localStorage.removeItem(TESTKEY_SPEICHER);
});
