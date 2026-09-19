import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annunciators, FlightBand } from './flightModel';

interface AudioRig {
  ctx: AudioContext;
  master: GainNode;
  recording: AudioBufferSourceNode;
  seatbeltBuffer: AudioBuffer;
}

const playBuffer = (ctx: AudioContext, destination: AudioNode, buffer: AudioBuffer, volume = 0.6) => {
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  gain.gain.value = volume;
  source.connect(gain).connect(destination);
  source.start();
};

export function useAircraftAudio(lamps: Annunciators, _change5m: number, band: FlightBand) {
  const [enabled, setEnabled] = useState(false);
  const rig = useRef<AudioRig | null>(null);
  const previous = useRef({ seatbelt: lamps.seatbelt, oxygen: lamps.oxygen, brace: lamps.brace, band });

  const stop = useCallback(() => {
    const current = rig.current;
    rig.current = null;
    if (!current) return;
    current.master.gain.setTargetAtTime(0.0001, current.ctx.currentTime, 0.12);
    window.setTimeout(() => void current.ctx.close(), 450);
  }, []);

  const start = useCallback(async () => {
    if (rig.current) return;
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    await ctx.resume();
    const master = ctx.createGain();
    master.gain.value = 0.12;
    master.connect(ctx.destination);

    // This is the user's recording, softened and levelled into a quiet cabin bed.
    const response = await fetch('/airplane-ambience.mp3');
    if (!response.ok) throw new Error('Airplane ambience could not be loaded.');
    const recording = ctx.createBufferSource();
    recording.buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    recording.loop = true;
    recording.connect(master);

    const warningResponse = await fetch('/seatbelt-warning.mp3');
    if (!warningResponse.ok) throw new Error('Seat-belt warning sound could not be loaded.');
    const seatbeltBuffer = await ctx.decodeAudioData(await warningResponse.arrayBuffer());

    recording.start();
    rig.current = { ctx, master, recording, seatbeltBuffer };
  }, []);

  const toggle = useCallback(() => {
    setEnabled(value => {
      const next = !value;
      if (next) void start().catch(() => setEnabled(false)); else stop();
      return next;
    });
  }, [start, stop]);

  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    const current = rig.current;
    if (!enabled || !current) return;
    if (previous.current.seatbelt !== lamps.seatbelt && lamps.seatbelt) {
      playBuffer(current.ctx, current.master, current.seatbeltBuffer, 0.7);
    }
    previous.current = { seatbelt: lamps.seatbelt, oxygen: lamps.oxygen, brace: lamps.brace, band };
  }, [enabled, lamps, band]);

  return { enabled, toggle };
}
