import { create } from 'zustand';
import type { Message } from '../api/types';
import { localPreview } from './chats';

interface PlayerState {
  message: Message | null;
  url: string | null;
  playing: boolean;
  time: number;
  duration: number;
  rate: number;
  toggle: (message: Message, url: string, duration?: number) => void;
  seek: (fraction: number) => void;
  cycleRate: () => void;
  stop: () => void;
}

const audio = new Audio();
audio.preload = 'auto';

export const usePlayer = create<PlayerState>((set, get) => ({
  message: null,
  url: null,
  playing: false,
  time: 0,
  duration: 0,
  rate: 1,
  toggle(message, url, duration = 0) {
    const src = localPreview.get(url) ?? url;
    if (get().url === url) {
      if (audio.paused) void audio.play().catch(() => undefined);
      else audio.pause();
      return;
    }
    audio.src = src;
    audio.playbackRate = get().rate;
    set({ message, url, time: 0, duration });
    void audio.play().catch(() => set({ playing: false }));
  },
  seek(fraction) {
    const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : get().duration;
    if (d) audio.currentTime = Math.max(0, Math.min(d, d * fraction));
  },
  cycleRate() {
    const rates = [1, 1.5, 2];
    const rate = rates[(rates.indexOf(get().rate) + 1) % rates.length];
    audio.playbackRate = rate;
    set({ rate });
  },
  stop() {
    audio.pause();
    audio.removeAttribute('src');
    set({ message: null, url: null, playing: false, time: 0 });
  },
}));

audio.addEventListener('play', () => usePlayer.setState({ playing: true }));
audio.addEventListener('pause', () => usePlayer.setState({ playing: false }));
audio.addEventListener('timeupdate', () => usePlayer.setState({ time: audio.currentTime }));
audio.addEventListener('loadedmetadata', () => {
  if (Number.isFinite(audio.duration)) usePlayer.setState({ duration: audio.duration });
});
audio.addEventListener('ended', () => usePlayer.setState({ playing: false, time: 0, message: null, url: null }));
