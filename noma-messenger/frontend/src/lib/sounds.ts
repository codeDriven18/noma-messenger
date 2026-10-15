/** Every NOMA sound is synthesised with WebAudio — no audio assets to ship. */

let ctx: AudioContext | null = null;
let enabled = true;

export const setSoundsEnabled = (v: boolean) => {
  enabled = v;
};

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

// Unlock audio on the first interaction (autoplay policies).
const unlock = () => {
  audio();
  window.removeEventListener('pointerdown', unlock);
  window.removeEventListener('keydown', unlock);
};
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

function tone(freq: number, start: number, dur: number, gain = 0.12, type: OscillatorType = 'sine', slideTo?: number) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

export const sounds = {
  sent() {
    if (!enabled) return;
    tone(520, 0, 0.12, 0.05, 'sine', 980);
  },
  incoming() {
    if (!enabled) return;
    tone(880, 0, 0.18, 0.07);
    tone(1320, 0.07, 0.26, 0.05);
  },
  reaction() {
    if (!enabled) return;
    tone(1200, 0, 0.09, 0.04, 'triangle', 1600);
  },
  callEnd() {
    if (!enabled) return;
    tone(620, 0, 0.18, 0.08);
    tone(440, 0.2, 0.28, 0.08);
  },
};

let loopTimer: number | undefined;

function loop(play: () => void, every: number) {
  stopLoop();
  play();
  loopTimer = window.setInterval(play, every);
}

export function stopLoop() {
  window.clearInterval(loopTimer);
  loopTimer = undefined;
}

/** Soft pulsing tone while the other side rings. */
export const startRingback = () =>
  loop(() => {
    tone(440, 0, 0.9, 0.05);
    tone(480, 0, 0.9, 0.04);
  }, 3000);

/** Melodic arpeggio for incoming calls. */
export const startRingtone = () =>
  loop(() => {
    if (!enabled) return;
    [659.25, 830.61, 987.77, 1318.5, 987.77, 1318.5].forEach((f, i) => tone(f, i * 0.13, 0.32, 0.07, 'triangle'));
  }, 2200);
