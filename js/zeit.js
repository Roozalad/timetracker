'use strict';
/* Reine Zeit-Logik (kein DOM, keine Datenbank): Tag-Regel mit 04:00-Grenze, Zeitfenster, Formate.
   Zeiten sind Millisekunden seit 1970, in Ortszeit des Geraets gedeutet (Abschnitt 6). */
import { CONFIG } from './config.js?v=0.4.1';

/** Beginn des (04:00-)Tages, zu dem ms gehoert, als ms. */
export function tagesBeginn(ms, tagesStart = CONFIG.tagesStart) {
  const d = new Date(ms);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), tagesStart, 0, 0, 0);
  if (ms < start.getTime()) start.setDate(start.getDate() - 1);
  return start.getTime();
}
/** Beginn des Folgetags (= Ende des Tages, zu dem ms gehoert). */
export function tagesEnde(ms, tagesStart = CONFIG.tagesStart) {
  const s = new Date(tagesBeginn(ms, tagesStart));
  s.setDate(s.getDate() + 1);
  return s.getTime();
}
export function gleicherTag(a, b, tagesStart = CONFIG.tagesStart) {
  return tagesBeginn(a, tagesStart) === tagesBeginn(b, tagesStart);
}
/** fensterStart (7.1): zeit des vorherigen Eintrags, sofern er am selben Tag liegt und davor, sonst null. */
export function fensterStartFuer(zeit, vorherigeZeit, tagesStart = CONFIG.tagesStart) {
  if (typeof vorherigeZeit !== 'number' || vorherigeZeit >= zeit) return null;
  return gleicherTag(zeit, vorherigeZeit, tagesStart) ? vorherigeZeit : null;
}

const zwei = (n) => String(n).padStart(2, '0');
export function uhrzeit(ms) { const d = new Date(ms); return `${zwei(d.getHours())}:${zwei(d.getMinutes())}`; }

const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
/** "Freitag 10:20" (Feld "jetzt" der Zuordnung, 7.2) */
export function wochentagUhrzeit(ms) { return `${WOCHENTAGE[new Date(ms).getDay()]} ${uhrzeit(ms)}`; }

/** "gerade eben", "vor 47 min", "vor 2 h 5 min", "vor 3 Tagen" */
export function vorZeitText(ms, jetzt = Date.now()) {
  const min = Math.floor(Math.max(0, jetzt - ms) / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} min`;
  if (min < 24 * 60) { const h = Math.floor(min / 60), r = min % 60; return r ? `vor ${h} h ${r} min` : `vor ${h} h`; }
  const t = Math.floor(min / (24 * 60));
  return t === 1 ? 'vor 1 Tag' : `vor ${t} Tagen`;
}
/** Sekunden als m:ss */
export function dauerText(sekunden) {
  const s = Math.max(0, Math.floor(sekunden));
  return `${Math.floor(s / 60)}:${zwei(s % 60)}`;
}
