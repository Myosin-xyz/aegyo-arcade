// 8-bit-flavored SFX synthesized at runtime — no audio files, so the folder stays
// light and fully portable. Browsers block audio until a user gesture, so the
// AudioContext is created lazily and resumed on the first tap (see unlockAudio).

let ctx: AudioContext | null = null;
let enabled = true;

function ac(): AudioContext | null {
  if (!enabled) return null;
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

export function unlockAudio(): void {
  const c = ac();
  if (c && c.state === "suspended") void c.resume();
}

export function setAudioEnabled(on: boolean): void {
  enabled = on;
}

/** Test/observability hook — mute-sync verification (M1 review B6). */
export function isAudioEnabled(): boolean {
  return enabled;
}

/** Close and drop the shared AudioContext (idempotent) — conformance §6.1.3. */
export function teardownAudio(): void {
  if (ctx) {
    void ctx.close().catch(() => undefined);
    ctx = null;
  }
}

interface BlipOpts {
  freq: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  /** multiply target frequency for a pitch sweep (e.g. 0.5 = drop an octave) */
  sweep?: number;
  delay?: number;
}

function blip(o: BlipOpts): void {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + (o.delay ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? "square";
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.sweep) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(40, o.freq * o.sweep),
      t0 + o.dur,
    );
  }
  const peak = o.gain ?? 0.18;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.03);
}

function noise(dur: number, gain = 0.12): void {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(g).connect(c.destination);
  src.start(t0);
}

export const sfx = {
  move(): void {
    blip({ freq: 330, dur: 0.06, gain: 0.07 });
  },
  press(): void {
    blip({ freq: 540, dur: 0.07, gain: 0.12 });
  },
  descend(): void {
    blip({ freq: 440, dur: 0.5, type: "sawtooth", gain: 0.06, sweep: 0.4 });
  },
  grab(): void {
    noise(0.08, 0.14);
    blip({ freq: 150, dur: 0.1, gain: 0.12 });
  },
  rise(): void {
    blip({ freq: 240, dur: 0.4, type: "sawtooth", gain: 0.05, sweep: 1.7 });
  },
  win(): void {
    [523, 659, 784, 1047].forEach((f, i) =>
      blip({ freq: f, dur: 0.16, gain: 0.16, delay: i * 0.12 }),
    );
  },
  miss(): void {
    blip({ freq: 300, dur: 0.18, gain: 0.12, sweep: 0.6 });
    blip({ freq: 200, dur: 0.22, gain: 0.1, sweep: 0.6, delay: 0.12 });
  },
  drop(): void {
    blip({ freq: 400, dur: 0.12, gain: 0.12, sweep: 0.5 });
    noise(0.1, 0.1);
  },
};

export function haptic(pattern: number | number[]): void {
  try {
    if ("vibrate" in navigator) navigator.vibrate(pattern);
  } catch {
    /* unsupported — no-op */
  }
}
