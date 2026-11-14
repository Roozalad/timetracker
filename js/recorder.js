'use strict';
/* Aufnahme (aus dem Spike): MediaRecorder mit audio/mp4 ohne Codec-Zusatz, getUserMedia({audio:true}) ohne
   weitere Wuensche, Start mit Timeslice 1000 ms, Abschluss erst nach onstop plus Schonfrist,
   paralleler WAV-Mitschnitt als Notfallweg. Das Verhalten ist in der Sache unveraendert zum Spike.
   Neu gegenueber dem Spike: Rueckmeldung ueber Handler statt direkter DOM-Zugriffe, Zeitpunkt des
   Tastendrucks (zeit), Hoechstdauer 5 min, Protokollzeile "AUFNAHMEWEG".

   createRecorder(handlers) -> { press(), release(), zustand() }
   handlers (alle optional):
     zustand(z, info)  z: 'bereit' | 'startet' | 'nimmt_auf' | 'beende'; bei 'nimmt_auf' info.startedAt (performance.now)
     fertig(erg)       erg: { blob, dauerMs, weg: 'normal'|'wav-notfall', zeit }   zeit = Date.now() beim Druecken
     verworfen(info)   info: { grund: 'zu_kurz'|'zu_frueh_losgelassen'|'keine_daten', dauerMs, details }
     fehler(info)      info: { art: 'mikrofon_verweigert'|'nicht_unterstuetzt'|'mikrofon'|'recorder', meldung }
     hinweis(text)     z. B. Hoechstdauer erreicht */
import { CONFIG } from './config.js?v=0.2.0';
import { log } from './log.js?v=0.2.0';

// iOS Safari: audio/mp4 (AAC). Chrome/Android: audio/webm;codecs=opus. Zur Laufzeit erkennen.
const MIME_CANDIDATES = [
  'audio/mp4', 'audio/aac', // ohne codecs-Zusatz
  'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus',
];
export function waehleMimeType(isSupported) {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of MIME_CANDIDATES) {
    try { if (isSupported(m)) return m; } catch (_) {}
  }
  return ''; // Browser-Default
}

// WAV aus dem parallelen Mitschnitt (Mono, 16 Bit, auf outRate heruntergerechnet)
export function encodeWav(p, outRate) {
  const total = p.frames, ratio = p.rate / outRate, outLen = Math.floor(total / ratio);
  const flat = new Float32Array(total); let o = 0;
  for (const c of p.chunks) { flat.set(c, o); o += c.length; }
  const buf = new ArrayBuffer(44 + outLen * 2), v = new DataView(buf);
  const w = (off, str) => { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + outLen * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, outRate, true); v.setUint32(28, outRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, outLen * 2, true);
  for (let i = 0; i < outLen; i++) {
    const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.min(total, Math.floor((i + 1) * ratio)));
    let sum = 0; for (let k = a; k < b; k++) sum += flat[k];
    const s = Math.max(-1, Math.min(1, sum / (b - a)));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export function createRecorder(handlers = {}) {
  const h = handlers;
  const emit = (name, ...args) => { try { if (h[name]) return h[name](...args); } catch (e) { log(`Handler ${name}: ${e && e.message}`); } };

  let recording = false;        // false | 'starting' | true | 'stopping'
  let stream = null, idleTimer = null, mime = '';
  let pressed = false;          // Finger liegt gerade auf dem Button
  let cur = null;               // aktuelle Aufnahme-Sitzung
  let pcmCtx = null;            // AudioContext fuer den WAV-Notfall-Mitschnitt (einmal pro Seite)

  function setZustand(z, info) { emit('zustand', z, info); }

  function trackState(t) {
    t = t || (stream && stream.getAudioTracks()[0]);
    if (!t) return 'kein Track';
    let rate = '';
    try { const st = t.getSettings(); rate = ` rate=${st.sampleRate || '?'} ch=${st.channelCount || '?'}`; } catch (_) {}
    return `muted=${t.muted} readyState=${t.readyState} enabled=${t.enabled}${rate}`;
  }
  function watchTrack(t) {
    for (const n of ['mute', 'unmute', 'ended']) t.addEventListener(n, () => log(`TRACK-EVENT ${n} (${trackState(t)})`));
  }

  async function ensureStream() {
    clearTimeout(idleTimer);
    if (stream && stream.getTracks().every((t) => t.readyState === 'live')) return stream;
    // bewusst ohne Constraints-Spielereien (echoCancellation & Co. koennen auf iOS stoeren)
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const t = stream.getAudioTracks()[0];
    if (t) watchTrack(t);
    log(`stream neu: ${trackState()}`);
    return stream;
  }
  function releaseStreamSoon(immediate) {
    clearTimeout(idleTimer);
    const stop = () => { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } };
    if (immediate) stop(); else idleTimer = setTimeout(stop, CONFIG.streamIdleMs);
  }

  // --- WAV-Notfall-Mitschnitt: unabhaengig von MediaRecorder, nur genutzt wenn MediaRecorder 0 Bytes liefert
  function primePcmContext() { // muss synchron in der Nutzergeste laufen (iOS)
    if (!CONFIG.pcmFallback) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!pcmCtx) pcmCtx = new AC();
      if (pcmCtx.state !== 'running') pcmCtx.resume().catch(() => {});
    } catch (e) { log(`pcm ctx: ${e && e.message}`); }
  }
  function startPcm(s) {
    if (!CONFIG.pcmFallback || !pcmCtx) return null;
    try {
      if (!pcmCtx.createScriptProcessor) return null;
      const p = { src: pcmCtx.createMediaStreamSource(s), proc: pcmCtx.createScriptProcessor(4096, 1, 1), chunks: [], frames: 0, peak: 0, rate: pcmCtx.sampleRate, on: true };
      p.proc.onaudioprocess = (e) => {
        if (!p.on) return;
        const d = new Float32Array(e.inputBuffer.getChannelData(0)); // Kopie, Puffer wird wiederverwendet
        for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p.peak) p.peak = a; }
        p.chunks.push(d); p.frames += d.length;
      };
      p.src.connect(p.proc); p.proc.connect(pcmCtx.destination); // Ausgabe bleibt still (Nullpuffer)
      return p;
    } catch (e) { log(`pcm start: ${e && e.message}`); return null; }
  }
  function stopPcm(p) {
    if (!p) return null;
    p.on = false;
    try { p.src.disconnect(); p.proc.disconnect(); p.proc.onaudioprocess = null; } catch (_) {}
    log(`pcm: ${p.frames} Samples @${p.rate}Hz, Spitzenpegel=${p.peak.toFixed(4)}`);
    return p;
  }

  async function press() {
    if (recording) return;
    const pressZeit = Date.now();   // Moment des Drucks: massgeblich fuer den Eintrag
    pressed = true; recording = 'starting'; setZustand('startet');
    primePcmContext();
    let s;
    try {
      if (!navigator.mediaDevices || !window.MediaRecorder) {
        const err = new Error('Aufnahme wird von diesem Browser nicht unterstützt'); err.name = 'NichtUnterstuetzt'; throw err;
      }
      s = await ensureStream();
    } catch (e) {
      pressed = false; recording = false; setZustand('bereit');
      const verweigert = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      const nichtDa = e && e.name === 'NichtUnterstuetzt';
      log(`getUserMedia: ${e && e.name} ${e && e.message}`);
      emit('fehler', {
        art: verweigert ? 'mikrofon_verweigert' : nichtDa ? 'nicht_unterstuetzt' : 'mikrofon',
        meldung: verweigert
          ? 'Mikrofon nicht erlaubt. In den iOS-Einstellungen das Mikrofon für Safari bzw. die App erlauben und die App neu öffnen.'
          : `Mikrofon: ${e && e.message}`,
      });
      return;
    }
    if (!pressed) { // vor Mikrofon-Start losgelassen (z. B. Erlaubnis-Dialog) -> verwerfen
      recording = false; setZustand('bereit');
      releaseStreamSoon(false);
      emit('verworfen', { grund: 'zu_frueh_losgelassen', dauerMs: 0, details: 'Loslassen, bevor das Mikrofon bereit war. Nochmal halten.' });
      return;
    }
    mime = waehleMimeType((m) => MediaRecorder.isTypeSupported(m));
    const sess = { rec: null, chunks: [], nEvents: 0, bytes: 0, stopCalled: false, stopped: false, finished: false,
                   timer: null, maxTimer: null, startedAt: 0, releaseTime: 0, pcm: null, zeit: pressZeit };
    try { sess.rec = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s); }
    catch (e) {
      recording = false; pressed = false; setZustand('bereit');
      emit('fehler', { art: 'recorder', meldung: `Recorder: ${e.message}` });
      return;
    }
    const rec = sess.rec;
    const since = () => Math.round(performance.now() - sess.startedAt);
    rec.onstart = () => log(`onstart t=${since()}ms state=${rec.state}`);
    rec.ondataavailable = (ev) => {
      const size = ev.data ? ev.data.size : -1;
      sess.nEvents++;
      const rel = sess.stopped ? 'NACH onstop' : sess.stopCalled ? 'nach stop(), vor onstop' : 'vor stop()';
      log(`dataavailable #${sess.nEvents} ${size}B type="${ev.data && ev.data.type}" ${rel} t=${since()}ms state=${rec.state}`);
      if (size > 0) {
        sess.chunks.push(ev.data); sess.bytes += size;
        if (sess.stopped) scheduleFinish(sess, 200); // Nachzuegler nach onstop: kurz auf weitere warten
      }
    };
    rec.onerror = (ev) => log(`recorder error: ${ev.error && ev.error.name} ${ev.error && ev.error.message}`);
    rec.onstop = () => {
      sess.stopped = true;
      log(`onstop t=${since()}ms state=${rec.state} events=${sess.nEvents} bytes=${sess.bytes} track=${trackState()}`);
      // Schonfrist: mit Daten kurz, ohne Daten laenger auf ein spaetes dataavailable warten
      scheduleFinish(sess, sess.bytes > 0 ? CONFIG.finishGraceWithDataMs : CONFIG.finishGraceMs);
    };
    sess.pcm = startPcm(s);
    log(`start-Versuch mime=${mime || '(default)'} timeslice=${CONFIG.timesliceMs} track=${trackState()} pcm=${sess.pcm ? 'an' : 'aus'}`);
    rec.start(CONFIG.timesliceMs);
    sess.startedAt = performance.now();
    cur = sess; recording = true;
    sess.maxTimer = setTimeout(() => {
      if (cur === sess && !sess.stopCalled) {
        pressed = false; // der Finger liegt evtl. noch auf dem Button: spaeteres Loslassen ist dann wirkungslos
        emit('hinweis', `Höchstdauer von ${Math.round(CONFIG.maxRecordingMs / 60000)} min erreicht, Aufnahme wird verarbeitet.`);
        stopRecording('Höchstdauer');
      }
    }, CONFIG.maxRecordingMs);
    setZustand('nimmt_auf', { startedAt: sess.startedAt });
    log(`gestartet: rec.mimeType=${rec.mimeType} state=${rec.state}`);
  }

  function scheduleFinish(sess, delay) {
    if (sess.finished) return;
    clearTimeout(sess.timer);
    sess.timer = setTimeout(() => finishRecording(sess), delay);
  }

  function stopRecording(why) {
    const sess = cur;
    if (!sess || sess.stopCalled) return;
    sess.stopCalled = true; sess.releaseTime = performance.now();
    clearTimeout(sess.maxTimer);
    recording = 'stopping'; setZustand('beende');
    log(`stop() (${why}) t=${Math.round(sess.releaseTime - sess.startedAt)}ms state=${sess.rec.state} track=${trackState()}`);
    try { sess.rec.stop(); } catch (e) { log(`stop() Fehler: ${e.message}`); scheduleFinish(sess, 100); return; }
    scheduleFinish(sess, CONFIG.stopTimeoutMs); // falls onstop nie kommt (bekannter iOS-Fehler)
  }

  function release() {
    const wasPressed = pressed;
    pressed = false;
    if (!wasPressed) return;
    if (recording === true) stopRecording('losgelassen');
    // recording === 'starting': press() erkennt pressed=false selbst
  }

  async function finishRecording(sess) {
    if (sess.finished) return;
    sess.finished = true; clearTimeout(sess.timer); clearTimeout(sess.maxTimer);
    const t0 = sess.releaseTime || performance.now();
    const durationMs = t0 - sess.startedAt;
    const rawType = sess.rec.mimeType || mime || (sess.chunks[0] && sess.chunks[0].type) || '';
    const type = rawType.split(';')[0].trim(); // "audio/mp4; codecs=..." -> "audio/mp4"
    let blob = new Blob(sess.chunks, { type });
    const pcm = stopPcm(sess.pcm);
    cur = null; recording = false;
    releaseStreamSoon(document.hidden);
    log(`ENDE ${durationMs.toFixed(0)}ms MediaRecorder: ${blob.size}B in ${sess.nEvents} Event(s), onstop=${sess.stopped} track=${trackState()}`);
    setZustand('bereit');

    if (durationMs < CONFIG.minRecordingMs) {
      log(`verworfen: zu kurz (${durationMs.toFixed(0)} ms)`);
      emit('verworfen', { grund: 'zu_kurz', dauerMs: durationMs, details: `${(durationMs / 1000).toFixed(1)} s (min. ${CONFIG.minRecordingMs / 1000} s)` });
      return;
    }
    let weg = 'normal';
    if (blob.size === 0) {
      if (pcm && pcm.frames > 0 && pcm.peak > 0) {
        blob = encodeWav(pcm, CONFIG.pcmRate); weg = 'wav-notfall';
        log(`MediaRecorder leer -> WAV-Fallback ${blob.size}B`);
      } else {
        log('verworfen: keine Audiodaten');
        emit('verworfen', { grund: 'keine_daten', dauerMs: durationMs,
          details: `MediaRecorder lieferte 0 Bytes (${sess.nEvents} Events, onstop=${sess.stopped}); Details im Protokoll` });
        return;
      }
    }
    log(`AUFNAHMEWEG: ${weg === 'normal' ? `normal (MediaRecorder, ${blob.size}B, ${blob.type || 'Typ unbekannt'})` : `WAV-Notfallpfad (${blob.size}B)`}`);
    emit('fertig', { blob, dauerMs: durationMs, weg, zeit: sess.zeit });
  }

  // Seite geht waehrend der Aufnahme in den Hintergrund: sauber beenden (Audio bleibt erhalten)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    log('visibilitychange: hidden');
    if (recording === true) { pressed = false; stopRecording('hidden'); }
    if (!recording) releaseStreamSoon(true); // sonst beendet finishRecording den Stream
  });

  return { press, release, zustand: () => recording };
}
