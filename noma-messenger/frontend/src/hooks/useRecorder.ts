import { useCallback, useEffect, useRef, useState } from 'react';

export type RecordKind = 'voice' | 'video_note';

export interface RecordingResult {
  blob: Blob;
  duration: number;
  waveform: number[];
  mime: string;
  kind: RecordKind;
}

const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
const VIDEO_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm'];

const pickType = (list: string[]) =>
  typeof MediaRecorder !== 'undefined' ? list.find((t) => MediaRecorder.isTypeSupported(t)) ?? '' : '';

function toWaveform(samples: number[], bars = 48): number[] {
  if (!samples.length) return Array(bars).fill(4);
  const out: number[] = [];
  const step = samples.length / bars;
  for (let i = 0; i < bars; i++) {
    const slice = samples.slice(Math.floor(i * step), Math.max(Math.floor((i + 1) * step), Math.floor(i * step) + 1));
    out.push(slice.reduce((a, b) => Math.max(a, b), 0));
  }
  const peak = Math.max(...out, 0.01);
  return out.map((v) => Math.max(4, Math.round((v / peak) * 100)));
}

export function useRecorder() {
  const [state, setState] = useState<'idle' | 'starting' | 'recording'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [kind, setKind] = useState<RecordKind>('voice');

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const samples = useRef<number[]>([]);
  const started = useRef(0);
  const raf = useRef(0);
  const tick = useRef<number | undefined>(undefined);
  const ctx = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const aborted = useRef(false);

  const teardown = useCallback(() => {
    cancelAnimationFrame(raf.current);
    window.clearInterval(tick.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctx.current?.close().catch(() => undefined);
    ctx.current = null;
    recorder.current = null;
    setStream(null);
    setLevel(0);
    setState('idle');
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(
    async (k: RecordKind): Promise<boolean> => {
      if (state !== 'idle') return false;
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Запись недоступна: нужен HTTPS или localhost');
      }
      aborted.current = false;
      setKind(k);
      setState('starting');
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: k === 'video_note' ? { width: { ideal: 480 }, height: { ideal: 480 }, aspectRatio: 1, facingMode: 'user' } : false,
        });
      } catch {
        setState('idle');
        throw new Error(k === 'video_note' ? 'Нет доступа к камере' : 'Нет доступа к микрофону');
      }
      if (aborted.current) {
        media.getTracks().forEach((t) => t.stop());
        setState('idle');
        return false;
      }
      streamRef.current = media;
      setStream(media);
      const mime = pickType(k === 'video_note' ? VIDEO_TYPES : AUDIO_TYPES);
      const rec = new MediaRecorder(media, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
      chunks.current = [];
      samples.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.start(250);
      recorder.current = rec;
      started.current = performance.now();
      setElapsed(0);
      setState('recording');

      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new Ctor();
      ctx.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      audioCtx.createMediaStreamSource(media).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      let last = 0;
      const loop = (t: number) => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
        if (t - last > 50) {
          samples.current.push(rms);
          setLevel(rms);
          last = t;
        }
        raf.current = requestAnimationFrame(loop);
      };
      raf.current = requestAnimationFrame(loop);
      tick.current = window.setInterval(() => setElapsed((performance.now() - started.current) / 1000), 100);
      return true;
    },
    [state],
  );

  const stop = useCallback((): Promise<RecordingResult | null> => {
    const rec = recorder.current;
    if (!rec) {
      aborted.current = true;
      teardown();
      return Promise.resolve(null);
    }
    const duration = (performance.now() - started.current) / 1000;
    const k = kind;
    return new Promise((resolve) => {
      rec.onstop = () => {
        const type = rec.mimeType || (k === 'video_note' ? 'video/webm' : 'audio/webm');
        const blob = new Blob(chunks.current, { type });
        const waveform = toWaveform(samples.current);
        teardown();
        resolve(blob.size ? { blob, duration, waveform, mime: type, kind: k } : null);
      };
      try {
        rec.requestData();
      } catch {
        /* inactive */
      }
      rec.stop();
    });
  }, [kind, teardown]);

  const cancel = useCallback(() => {
    aborted.current = true;
    const rec = recorder.current;
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null;
      rec.stop();
    }
    teardown();
  }, [teardown]);

  return { state, elapsed, level, stream, kind, start, stop, cancel };
}
