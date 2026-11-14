'use strict';
/* API-Key: liegt nur im localStorage dieses Browsers (Datenschutz-Regel 3).
   Nie in Code, Export oder Protokoll. */
import { CONFIG } from './config.js?v=0.4.0';

// Der Speichername steht auf globalThis, damit alle Instanzen dieses Moduls dasselbe meinen, auch wenn ein Import
// mit abweichendem ?v= es ein zweites Mal laedt (sonst saehe z. B. categorize.js einen anderen Test-Speicher).
const SLOT = '__zeiterfassungKeySpeicher';
const speicherName = () => (typeof globalThis[SLOT] === 'string' && globalThis[SLOT]) || CONFIG.keyStorage;

export function getKey() { try { return localStorage.getItem(speicherName()) || ''; } catch (_) { return ''; } }
export function setKey(v) { try { localStorage.setItem(speicherName(), v); return true; } catch (_) { return false; } }
export function removeKey() { try { localStorage.removeItem(speicherName()); return true; } catch (_) { return false; } }
/** Nur die letzten vier Zeichen, fuer die Anzeige. */
export function keyEnde() { const k = getKey(); return k ? k.slice(-4) : ''; }

/** Entfernt Key-Reste aus Fremdtext (OpenAI-Fehlermeldungen nennen den Key teilweise maskiert),
    bevor er angezeigt, gespeichert oder protokolliert wird. */
export function maskiere(text) {
  let t = String(text == null ? '' : text);
  const k = getKey();
  if (k) t = t.split(k).join('sk-…');
  return t.replace(/sk-[A-Za-z0-9_\-*.]{3,}/g, 'sk-…');
}
/** Nur fuer Tests. */
export function _keySpeicherName(name) { globalThis[SLOT] = name; }
