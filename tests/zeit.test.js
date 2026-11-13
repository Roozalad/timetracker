'use strict';
import { test, gruppe, ok, eq } from './framework.js';
import { app } from './framework.js';

const z = await app('zeit');
// Lokale Zeitpunkte: unabhaengig von der Zeitzone des Rechners
const t = (tag, h, m = 0, monat = 11) => new Date(2026, monat - 1, tag, h, m, 0, 0).getTime();

gruppe('Tag-Regel (04:00-Grenze)');
test('03:59 gehört zum Vortag', () => eq(z.tagesBeginn(t(14, 3, 59)), t(13, 4)));
test('04:00 beginnt den neuen Tag', () => eq(z.tagesBeginn(t(14, 4, 0)), t(14, 4)));
test('23:59 gehört zum Tag davor', () => eq(z.tagesBeginn(t(14, 23, 59)), t(14, 4)));
test('00:00 gehört zum Vortag', () => eq(z.tagesBeginn(t(14, 0, 0)), t(13, 4)));
test('Monatswechsel: 01:00 am 1. gehört zum 30./31. davor', () => eq(z.tagesBeginn(t(1, 1, 0, 12)), t(30, 4, 0, 11)));
test('tagesEnde ist der nächste 04:00', () => eq(z.tagesEnde(t(14, 10)), t(15, 4)));
test('gleicherTag: 23:30 und 01:00 danach', () => ok(z.gleicherTag(t(13, 23, 30), t(14, 1, 0))));
test('gleicherTag: 03:59 und 04:00 sind verschieden', () => ok(!z.gleicherTag(t(14, 3, 59), t(14, 4, 0))));
test('gleicherTag: gleicher Kalendertag, aber vor und nach 04:00, ist verschieden', () => ok(!z.gleicherTag(t(14, 3, 0), t(14, 5, 0))));

gruppe('Zeitfenster');
test('fensterStart: vorheriger Eintrag am selben Tag', () => eq(z.fensterStartFuer(t(14, 10, 20), t(14, 9, 15)), t(14, 9, 15)));
test('fensterStart: über Mitternacht im selben Tag', () => eq(z.fensterStartFuer(t(14, 1, 0), t(13, 23, 30)), t(13, 23, 30)));
test('fensterStart: vorheriger Eintrag am Vortag (vor 04:00-Grenze) ist null', () => eq(z.fensterStartFuer(t(14, 5, 0), t(14, 3, 0)), null));
test('fensterStart: kein vorheriger Eintrag ist null', () => eq(z.fensterStartFuer(t(14, 5, 0), null), null));
test('fensterStart: vorheriger nicht vor zeit ist null', () => eq(z.fensterStartFuer(t(14, 5, 0), t(14, 5, 0)), null));

gruppe('Formate');
test('uhrzeit', () => eq(z.uhrzeit(t(14, 9, 5)), '09:05'));
test('vorZeitText', () => {
  const j = t(14, 12);
  eq(z.vorZeitText(j - 20000, j), 'gerade eben');
  eq(z.vorZeitText(j - 47 * 60000, j), 'vor 47 min');
  eq(z.vorZeitText(j - 125 * 60000, j), 'vor 2 h 5 min');
  eq(z.vorZeitText(j - 120 * 60000, j), 'vor 2 h');
  eq(z.vorZeitText(j - 3 * 24 * 3600000, j), 'vor 3 Tagen');
});
test('dauerText', () => { eq(z.dauerText(7.9), '0:07'); eq(z.dauerText(65), '1:05'); });
