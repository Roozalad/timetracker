'use strict';
import { test, gruppe, ok, eq } from './framework.js';
import { app } from './framework.js';

const s = await app('sicherung');
const TAG = 24 * 3600 * 1000;
const jetzt = new Date(2026, 10, 14, 12, 0, 0).getTime();

gruppe('Erinnerung an den Export (8.3)');
test('Export vor 13 Tagen: nichts fällig', () => eq(s.sicherungFaellig({ letzterExport: jetzt - 13 * TAG, jetzt }).faellig, false));
test('Export genau vor 14 Tagen: noch nicht fällig (mehr als 14)', () => eq(s.sicherungFaellig({ letzterExport: jetzt - 14 * TAG, jetzt }).faellig, false));
test('Export vor 14 Tagen und 1 ms: fällig', () => eq(s.sicherungFaellig({ letzterExport: jetzt - 14 * TAG - 1, jetzt }), { faellig: true, grund: 'export', seit: jetzt - 14 * TAG - 1 }));
test('Export vor 20 Tagen: fällig, auch wenn der älteste Eintrag noch älter ist', () => eq(s.sicherungFaellig({ letzterExport: jetzt - 20 * TAG, aeltesterEintrag: jetzt - 90 * TAG, jetzt }).grund, 'export'));
test('frischer Export schlägt alten ältesten Eintrag', () => eq(s.sicherungFaellig({ letzterExport: jetzt - 2 * TAG, aeltesterEintrag: jetzt - 90 * TAG, jetzt }).faellig, false));
test('kein Export, ältester Eintrag vor 10 Tagen: nichts fällig', () => eq(s.sicherungFaellig({ aeltesterEintrag: jetzt - 10 * TAG, jetzt }).faellig, false));
test('kein Export, ältester Eintrag vor 15 Tagen: fällig wegen Eintrag', () => eq(s.sicherungFaellig({ aeltesterEintrag: jetzt - 15 * TAG, jetzt }).grund, 'eintrag'));
test('kein Export und keine Einträge: nichts fällig', () => eq(s.sicherungFaellig({ jetzt }).faellig, false));
test('Export in der Zukunft (Uhr verstellt): nichts fällig', () => eq(s.sicherungFaellig({ letzterExport: jetzt + 5 * TAG, jetzt }).faellig, false));
test('ungültiger Exportwert zählt als kein Export', () => {
  eq(s.sicherungFaellig({ letzterExport: NaN, aeltesterEintrag: jetzt - 30 * TAG, jetzt }).grund, 'eintrag');
  eq(s.sicherungFaellig({ letzterExport: 0, aeltesterEintrag: null, jetzt }).faellig, false);
});
test('exportZeitAusText', () => {
  eq(s.exportZeitAusText('1700000000000'), 1700000000000);
  eq(s.exportZeitAusText(null), null); eq(s.exportZeitAusText('abc'), null); eq(s.exportZeitAusText(''), null);
});
test('Text: leer wenn nichts fällig, sonst mit Alter', () => {
  eq(s.sicherungText({ letzterExport: jetzt - 2 * TAG, jetzt }), '');
  eq(s.sicherungText({ letzterExport: jetzt - 20 * TAG, jetzt }), 'Letzte Sicherung vor 20 Tagen.');
  eq(s.sicherungText({ aeltesterEintrag: jetzt - 16 * TAG, jetzt }), 'Noch nie gesichert. Der älteste Eintrag ist 16 Tage alt.');
});
