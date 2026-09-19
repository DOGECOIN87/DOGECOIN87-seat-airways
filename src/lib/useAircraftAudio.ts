import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annunciators, FlightBand } from './flightModel';

interface AudioRig {
  ctx: AudioContext;
  master: GainNode;
  engine: GainNode;
  airflow: GainNode;
  hum: GainNode;
  turbulence: GainNode;
  noise: AudioBufferSourceNode;
  engineOsc: OscillatorNode;
  engineHarmonic: OscillatorNode;
  airFilter: BiquadFilterNode;
}

const makeNoise = (ctx: AudioContext) => {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    last = last * 0.985 + (Math.random() * 2 - 1) * 0.18;
    data[i] = last;
  }
  return buffer;
};

const tone = (ctx: AudioContext, destination: AudioNode, frequency: number, duration: number, volume = 0.12) => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine'; osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.connect(gain).connect(destination); osc.start(); osc.stop(ctx.currentTime + duration + 0.04);
};

export function useAircraftAudio(lamps: Annunciators, change5m: number, band: FlightBand) {
  const [enabled, setEnabled] = useState(false);
  const rig = useRef<AudioRig | null>(null);
  const previous = useRef({ seatbelt: lamps.seatbelt, oxygen: lamps.oxygen, brace: lamps.brace, band });

  const stop = useCallback(() => {
    const current = rig.current;
    rig.current = null;
    if (!current) return;
    current.master.gain.setTargetAtTime(0.0001, current.ctx.currentTime, 0.04);
    window.setTimeout(() => void current.ctx.close(), 180);
  }, []);

  const start = useCallback(async () => {
    if (rig.current) return;
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    await ctx.resume();
    const master = ctx.createGain(); master.gain.value = 0.16; master.connect(ctx.destination);
    const engine = ctx.createGain(); engine.gain.value = 0.13; engine.connect(master);
    const airflow = ctx.createGain(); airflow.gain.value = 0.08; airflow.connect(master);
    const hum = ctx.createGain(); hum.gain.value = 0.035; hum.connect(master);
    const turbulence = ctx.createGain(); turbulence.gain.value = 0.0001; turbulence.connect(master);

    const engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 92;
    const engineHarmonic = ctx.createOscillator(); engineHarmonic.type = 'triangle'; engineHarmonic.frequency.value = 184;
    engineOsc.connect(engine); engineHarmonic.connect(engine);
    const airFilter = ctx.createBiquadFilter(); airFilter.type = 'lowpass'; airFilter.frequency.value = 850;
    const noise = ctx.createBufferSource(); noise.buffer = makeNoise(ctx); noise.loop = true; noise.connect(airFilter).connect(airflow); noise.connect(turbulence);
    const cabin = ctx.createOscillator(); cabin.type = 'sine'; cabin.frequency.value = 58; cabin.connect(hum);
    engineOsc.start(); engineHarmonic.start(); cabin.start(); noise.start();
    rig.current = { ctx, master, engine, airflow, hum, turbulence, noise, engineOsc, engineHarmonic, airFilter };
  }, []);

  const toggle = useCallback(() => {
    setEnabled(value => {
      const next = !value;
      if (next) void start(); else stop();
      return next;
    });
  }, [start, stop]);

  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    const current = rig.current;
    if (!enabled || !current) return;
    const now = current.ctx.currentTime;
    const intensity = Math.min(1, Math.abs(change5m) / 80);
    current.engineOsc.frequency.setTargetAtTime(86 + intensity * 30, now, 0.6);
    current.engineHarmonic.frequency.setTargetAtTime(172 + intensity * 60, now, 0.6);
    current.airFilter.frequency.setTargetAtTime(650 + intensity * 900, now, 0.4);
    current.airflow.gain.setTargetAtTime(0.045 + intensity * 0.08, now, 0.5);
    current.turbulence.gain.setTargetAtTime(lamps.shaking ? 0.045 : 0.0001, now, lamps.shaking ? 0.02 : 0.18);
    if (previous.current.seatbelt !== lamps.seatbelt) tone(current.ctx, current.master, 880, .18, .09);
    if (previous.current.oxygen !== lamps.oxygen) { tone(current.ctx, current.master, 660, .22, .1); tone(current.ctx, current.master, 990, .28, .08); }
    if (previous.current.brace !== lamps.brace) { tone(current.ctx, current.master, 520, .3, .11); tone(current.ctx, current.master, 390, .38, .1); }
    if (previous.current.band !== band) tone(current.ctx, current.master, 523, .5, .08);
    previous.current = { seatbelt: lamps.seatbelt, oxygen: lamps.oxygen, brace: lamps.brace, band };
  }, [enabled, lamps, change5m, band]);

  return { enabled, toggle };
}
