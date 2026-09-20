import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annunciators, FlightBand } from './flightModel';

const INTERCOM_FILES = [
  '01_captain_speaking_intercom.wav',
  '02_tray_tables_seats_upright_intercom.wav',
  '03_fasten_seat_belts_takeoff_intercom.wav',
  '04_unlikely_water_landing_intercom.wav',
  '05_flight_crew_serving_food_intercom.wav',
  '06_altitude_move_about_cabin_intercom.wav',
  '07_funny_turbulence_warning_intercom.wav',
  '08_secure_your_dignity_intercom.wav',
  '09_finish_your_beverage_intercom.wav',
  '10_tray_tables_again_intercom.wav',
  '11_roller_coaster_turbulence_intercom.wav',
  '12_secure_loose_items_intercom.wav',
  '13_floating_coffee_intercom.wav',
  '14_overhead_bins_not_escape_hatches_intercom.wav',
  '15_restroom_reminder_intercom.wav',
  '16_awkward_elevator_turbulence_intercom.wav',
  '17_seat_back_reminder_intercom.wav',
  '18_thank_you_for_pretending_intercom.wav',
] as const;

interface AudioRig {
  ctx: AudioContext;
  master: GainNode;
  recording: AudioBufferSourceNode;
  seatbeltBuffer: AudioBuffer;
  intercomBuffers: AudioBuffer[];
  intercomOrder: number[];
  lastIntercomIndex: number | null;
  intercomTimer: number | null;
  activeSources: Set<AudioBufferSourceNode>;
  stopped: boolean;
}

const randomBetween = (minimum: number, maximum: number) =>
  minimum + Math.random() * (maximum - minimum);

const shuffled = (length: number) =>
  Array.from({ length }, (_, index) => index).sort(() => Math.random() - 0.5);

const playBuffer = (
  rig: AudioRig,
  buffer: AudioBuffer,
  volume = 0.6,
  onEnded?: () => void,
) => {
  const source = rig.ctx.createBufferSource();
  const gain = rig.ctx.createGain();
  source.buffer = buffer;
  gain.gain.value = volume;
  source.connect(gain).connect(rig.master);
  rig.activeSources.add(source);
  source.onended = () => {
    rig.activeSources.delete(source);
    onEnded?.();
  };
  source.start();
};

const nextIntercomIndex = (rig: AudioRig) => {
  if (rig.intercomOrder.length === 0) rig.intercomOrder = shuffled(rig.intercomBuffers.length);

  let index = rig.intercomOrder.pop() as number;
  // Never repeat the same announcement across a shuffle-bag boundary.
  if (index === rig.lastIntercomIndex && rig.intercomOrder.length > 0) {
    const alternative = rig.intercomOrder.pop() as number;
    rig.intercomOrder.unshift(index);
    index = alternative;
  }
  rig.lastIntercomIndex = index;
  return index;
};

const scheduleIntercom = (rig: AudioRig, first = false) => {
  if (rig.stopped) return;
  const delay = first ? randomBetween(12000, 24000) : randomBetween(18000, 42000);
  rig.intercomTimer = window.setTimeout(() => {
    if (rig.stopped) return;
    const index = nextIntercomIndex(rig);
    playBuffer(rig, rig.intercomBuffers[index], 0.58, () => scheduleIntercom(rig));
  }, delay);
};

export function useAircraftAudio(lamps: Annunciators, _change5m: number, band: FlightBand) {
  const [enabled, setEnabled] = useState(false);
  const rig = useRef<AudioRig | null>(null);
  const previous = useRef({ seatbelt: lamps.seatbelt, oxygen: lamps.oxygen, brace: lamps.brace, band });

  const stop = useCallback(() => {
    const current = rig.current;
    rig.current = null;
    if (!current) return;
    current.stopped = true;
    if (current.intercomTimer !== null) window.clearTimeout(current.intercomTimer);
    current.recording.stop();
    current.activeSources.forEach(source => source.stop());
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

    const recordingResponse = await fetch('/flight-cabin-ambience-loop.mp3');
    if (!recordingResponse.ok) throw new Error('Flight cabin ambience could not be loaded.');
    const recording = ctx.createBufferSource();
    recording.buffer = await ctx.decodeAudioData(await recordingResponse.arrayBuffer());
    recording.loop = true;
    recording.connect(master);

    const warningResponse = await fetch('/seatbelt-warning.mp3');
    if (!warningResponse.ok) throw new Error('Seat-belt warning sound could not be loaded.');
    const seatbeltBuffer = await ctx.decodeAudioData(await warningResponse.arrayBuffer());

    const intercomBuffers = await Promise.all(
      INTERCOM_FILES.map(async file => {
        const response = await fetch(`/intercom/${file}`);
        if (!response.ok) throw new Error(`Intercom sound could not be loaded: ${file}`);
        return ctx.decodeAudioData(await response.arrayBuffer());
      }),
    );

    const nextRig: AudioRig = {
      ctx,
      master,
      recording,
      seatbeltBuffer,
      intercomBuffers,
      intercomOrder: shuffled(intercomBuffers.length),
      lastIntercomIndex: null,
      intercomTimer: null,
      activeSources: new Set(),
      stopped: false,
    };

    recording.start();
    rig.current = nextRig;
    scheduleIntercom(nextRig, true);
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
      playBuffer(current, current.seatbeltBuffer, 0.7);
    }
    previous.current = { seatbelt: lamps.seatbelt, oxygen: lamps.oxygen, brace: lamps.brace, band };
  }, [enabled, lamps, band]);

  return { enabled, toggle };
}
