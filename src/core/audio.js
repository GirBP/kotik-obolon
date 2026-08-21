// ================= АУДІО-ПРИМІТИВИ (WebAudio) =================
// Спільний AudioContext (лениво створюється/резюмиться) + короткий тон.
// bell() і будь-який звук поважають window.MUTED.

let AC = null;

/** Спільний AudioContext гри (лениво створює/резюмить). */
export function ac() {
  if (!AC) {
    const C = window.AudioContext || window.webkitAudioContext;
    AC = new C();
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}

/** Короткий синусовий тон із затуханням. Мовчить при window.MUTED. */
export function bell(freq, t0, dur, vol) {
  if (window.MUTED) return;
  const a = ac();
  const o = a.createOscillator(),
    g = a.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  o.connect(g);
  g.connect(a.destination);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.start(t0);
  o.stop(t0 + dur);
}
