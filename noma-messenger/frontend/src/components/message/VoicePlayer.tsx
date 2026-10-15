import { motion } from 'framer-motion';
import { Pause, Play } from 'lucide-react';
import { type PointerEvent, useRef } from 'react';
import type { Attachment, Message } from '../../api/types';
import { duration as fmt } from '../../lib/format';
import { usePlayer } from '../../store/player';

export function Waveform({ data, progress, onSeek }: { data: number[]; progress: number; onSeek?: (f: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const seek = (e: PointerEvent) => {
    if (!onSeek || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  };
  const bars = data.length ? data : Array(48).fill(8);
  return (
    <div
      ref={ref}
      className="waveform"
      onPointerDown={(e) => {
        e.stopPropagation();
        seek(e);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => e.buttons && seek(e)}
    >
      {bars.map((v, i) => (
        <span key={i} className={i / bars.length < progress ? 'on' : ''} style={{ height: `${Math.max(12, v)}%` }} />
      ))}
    </div>
  );
}

export function VoicePlayer({ message, att }: { message: Message; att: Attachment }) {
  const current = usePlayer((s) => s.url === att.url);
  const playing = usePlayer((s) => s.url === att.url && s.playing);
  const time = usePlayer((s) => (s.url === att.url ? s.time : 0));
  const rate = usePlayer((s) => s.rate);
  const { toggle, seek, cycleRate } = usePlayer.getState();
  const total = att.duration || usePlayer.getState().duration || 0;
  const progress = current && total ? time / total : 0;

  return (
    <div className="voice">
      <motion.button
        className="voice-btn"
        whileTap={{ scale: 0.9 }}
        onClick={(e) => {
          e.stopPropagation();
          toggle(message, att.url, att.duration);
        }}
      >
        {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" style={{ marginLeft: 2 }} />}
      </motion.button>
      <div className="voice-body">
        <Waveform data={att.waveform ?? []} progress={progress} onSeek={current ? seek : undefined} />
        <div className="voice-meta">
          <span>{fmt(current ? time : total)}</span>
          {current && (
            <button
              className="rate-btn"
              onClick={(e) => {
                e.stopPropagation();
                cycleRate();
              }}
            >
              {rate}×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function AudioRow({ message, att }: { message: Message; att: Attachment }) {
  const playing = usePlayer((s) => s.url === att.url && s.playing);
  const current = usePlayer((s) => s.url === att.url);
  const time = usePlayer((s) => (s.url === att.url ? s.time : 0));
  const dur = usePlayer((s) => (s.url === att.url ? s.duration : 0)) || att.duration || 0;
  return (
    <div className="file-row">
      <motion.button
        className="voice-btn"
        whileTap={{ scale: 0.9 }}
        onClick={(e) => {
          e.stopPropagation();
          usePlayer.getState().toggle(message, att.url, att.duration);
        }}
      >
        {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" style={{ marginLeft: 2 }} />}
      </motion.button>
      <div className="file-info">
        <div className="file-name ellipsis">{att.name ?? 'Аудио'}</div>
        {current ? (
          <div className="audio-progress" onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            usePlayer.getState().seek((e.clientX - r.left) / r.width);
          }}>
            <span style={{ width: `${dur ? (time / dur) * 100 : 0}%` }} />
          </div>
        ) : (
          <div className="file-size">{fmt(dur)}</div>
        )}
      </div>
    </div>
  );
}
