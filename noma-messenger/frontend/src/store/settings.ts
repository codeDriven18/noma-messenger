import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ACCENTS } from '../lib/colors';
import { setSoundsEnabled } from '../lib/sounds';

export type Wallpaper = 'ambient' | 'black' | 'dots' | 'grid';
/** How NOMA is presented on a computer: inside a phone frame, or full window. */
export type DesktopLayout = 'phone' | 'wide';

interface SettingsState {
  accent: string;
  wallpaper: Wallpaper;
  layout: DesktopLayout;
  fontSize: number;
  radius: number;
  animations: boolean;
  sounds: boolean;
  notifications: boolean;
  sendOnEnter: boolean;
  liveChat: boolean;
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
}

const WALLPAPERS: Wallpaper[] = ['ambient', 'black', 'dots', 'grid'];

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      accent: 'mono',
      wallpaper: 'ambient',
      layout: 'phone',
      fontSize: 16,
      radius: 18,
      animations: true,
      sounds: true,
      notifications: true,
      sendOnEnter: true,
      liveChat: true,
      set: (patch) => set(patch),
    }),
    {
      name: 'noma.settings',
      version: 2,
      // v1 had the neon theme: move everyone onto the new monochrome defaults
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<SettingsState>;
        if (version < 2) return { ...s, accent: 'mono', wallpaper: 'ambient', layout: 'phone', radius: 18, fontSize: 16 };
        return s;
      },
    },
  ),
);

export function applySettings(s: SettingsState) {
  const root = document.documentElement;
  const accent = ACCENTS.find((a) => a.id === s.accent) ?? ACCENTS[0];
  root.style.setProperty('--accent', accent.color);
  root.style.setProperty('--on-accent', accent.on);
  root.style.setProperty('--accent-rgb', accent.rgb);
  root.style.setProperty('--msg-font', `${s.fontSize}px`);
  root.style.setProperty('--bubble-r', `${s.radius}px`);
  root.dataset.motion = s.animations ? 'full' : 'reduced';
  root.dataset.wallpaper = WALLPAPERS.includes(s.wallpaper) ? s.wallpaper : 'ambient';
  root.dataset.accent = accent.id;
  setSoundsEnabled(s.sounds);
}
