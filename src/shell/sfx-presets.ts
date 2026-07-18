/**
 * Synth SFX presets for the AudioBus (contract §6.3: WebAudio synths,
 * no audio files — games pass these to `ctx.audio.register`). The bus
 * owns unlock/mute/teardown; presets only shape sound. Gains stay low
 * (≤0.07): arcade juice, not a slot machine.
 */

type Synth = (ctx: AudioContext, at: number) => void;

function voice(
  ctx: AudioContext,
  at: number,
  type: OscillatorType,
  gainPeak: number,
  dur: number,
): { osc: OscillatorNode; gain: GainNode } {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  gain.gain.setValueAtTime(gainPeak, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
  return { osc, gain };
}

/** Short single note (catches, points, taps). */
export function blip(
  freq: number,
  dur = 0.07,
  type: OscillatorType = "square",
  gainPeak = 0.045,
): Synth {
  return (ctx, at) => {
    const { osc } = voice(ctx, at, type, gainPeak, dur);
    osc.frequency.setValueAtTime(freq, at);
  };
}

/** Pitch glide (flaps, bounces, losses). */
export function sweep(
  from: number,
  to: number,
  dur = 0.15,
  type: OscillatorType = "triangle",
  gainPeak = 0.05,
): Synth {
  return (ctx, at) => {
    const { osc } = voice(ctx, at, type, gainPeak, dur);
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), at + dur);
  };
}

/** Rising note run (level clears, wins). */
export function arp(
  freqs: readonly number[],
  step = 0.07,
  noteDur = 0.09,
  type: OscillatorType = "square",
  gainPeak = 0.04,
): Synth {
  return (ctx, at) => {
    freqs.forEach((freq, i) => {
      const { osc } = voice(ctx, at + i * step, type, gainPeak, noteDur);
      osc.frequency.setValueAtTime(freq, at + i * step);
    });
  };
}

/** Low impact (misses, hits). */
export function thud(freq = 120, dur = 0.14, gainPeak = 0.07): Synth {
  return (ctx, at) => {
    const { osc } = voice(ctx, at, "triangle", gainPeak, dur);
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + dur);
  };
}
