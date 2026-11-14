'use strict';
/* Transkription: Audio rein, Text raus. Genau eine oeffentliche Funktion, austauschbar:
   transcribe(blob) -> Promise<string>. Wirft TranscribeError.
   Aus dem Spike: Modell gpt-transcribe, Sprache ueber languages[]=de, direkter Aufruf aus dem Browser. */
import { CONFIG } from './config.js?v=0.4.0';
import { getKey, maskiere } from './key.js?v=0.4.0';

/** art: 'kein_key' | 'auth' (Key ungueltig / Guthaben leer: nicht automatisch wiederholen)
        | 'netz' | 'server' | 'ungueltig' (Anfrage selbst abgelehnt, z. B. Datei unbrauchbar). */
export class TranscribeError extends Error {
  constructor(message, { art = 'netz', status = 0 } = {}) {
    super(message); this.name = 'TranscribeError'; this.art = art; this.status = status;
  }
  get blockierend() { return this.art === 'kein_key' || this.art === 'auth'; }
}

function dateiEndung(mime) {
  const m = (mime || '').toLowerCase();
  if (m.includes('mp4') || m.includes('aac') || m.includes('m4a')) return 'm4a';
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  return 'm4a';
}

export async function transcribe(blob) {
  const key = getKey();
  if (!key) throw new TranscribeError('Kein API-Key eingetragen', { art: 'kein_key' });
  const form = new FormData();
  form.append('model', CONFIG.transkribierModell);
  for (const l of CONFIG.sprachen) form.append('languages[]', l);
  form.append('file', blob, `aufnahme.${dateiEndung(blob.type)}`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.requestTimeoutMs);
  let res;
  try {
    res = await fetch(CONFIG.transkribierEndpoint, {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: ctrl.signal,
    });
  } catch (e) {
    throw new TranscribeError(e && e.name === 'AbortError' ? 'Zeitüberschreitung' : 'Netzwerkfehler', { art: 'netz' });
  } finally { clearTimeout(timer); }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`, code = '';
    try {
      const j = await res.json();
      if (j && j.error) { if (j.error.message) msg += `: ${j.error.message}`; code = j.error.code || j.error.type || ''; }
    } catch (_) {}
    msg = maskiere(msg);
    const quota = res.status === 429 && /quota|billing|credit/i.test(`${code} ${msg}`);
    let art;
    if (res.status === 401 || res.status === 402 || res.status === 403 || quota) art = 'auth';
    else if (res.status === 408 || res.status === 429 || res.status >= 500) art = 'server';
    else art = 'ungueltig';
    throw new TranscribeError(msg, { art, status: res.status });
  }
  let data;
  try { data = await res.json(); } catch (_) { throw new TranscribeError('Antwort nicht lesbar', { art: 'server' }); }
  if (!data || typeof data.text !== 'string') throw new TranscribeError('Antwort ohne Text', { art: 'ungueltig' });
  return data.text.trim();
}
