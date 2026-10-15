import { create } from 'zustand';
import type { Attachment, Message } from '../api/types';
import type { LocalAttachment } from '../lib/media';

export type Tab = 'chats' | 'calls' | 'settings';

export interface ViewerItem {
  attachment: Attachment;
  message: Message;
}

export interface IslandNotice {
  id: number;
  chatId: number;
  title: string;
  text: string;
  avatar: { url: string | null; color: number; name: string; round: boolean };
}

export interface Toast {
  id: number;
  text: string;
  tone?: 'info' | 'error' | 'success';
}

export type Modal =
  | { kind: 'newChat' }
  | { kind: 'newGroup'; type: 'group' | 'channel' }
  | { kind: 'forward'; messageIds: number[] }
  | { kind: 'addMembers'; chatId: number }
  | { kind: 'editProfile' }
  | { kind: 'editChat'; chatId: number }
  | { kind: 'userProfile'; userId: number }
  | { kind: 'sendFiles'; chatId: number; items: LocalAttachment[] }
  | { kind: 'confirm'; title: string; text: string; action: string; danger?: boolean; onConfirm: () => void };

interface UIState {
  tab: Tab;
  infoOpen: boolean;
  modal: Modal | null;
  menu: { message: Message; rect: DOMRect } | null;
  viewer: { items: ViewerItem[]; index: number } | null;
  notices: IslandNotice[];
  toasts: Toast[];
  spotlight: boolean;
  chatSearch: boolean;
  setTab: (t: Tab) => void;
  setInfoOpen: (v: boolean) => void;
  openModal: (m: Modal) => void;
  closeModal: () => void;
  openMenu: (message: Message, rect: DOMRect) => void;
  closeMenu: () => void;
  openViewer: (items: ViewerItem[], index: number) => void;
  closeViewer: () => void;
  pushNotice: (n: Omit<IslandNotice, 'id'>) => void;
  dropNotice: (id: number) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  setSpotlight: (v: boolean) => void;
  setChatSearch: (v: boolean) => void;
}

let seq = 1;

export const useUI = create<UIState>((set, get) => ({
  tab: 'chats',
  infoOpen: false,
  modal: null,
  menu: null,
  viewer: null,
  notices: [],
  toasts: [],
  spotlight: false,
  chatSearch: false,
  setTab: (tab) => set({ tab }),
  setInfoOpen: (infoOpen) => set({ infoOpen }),
  openModal: (modal) => set({ modal, menu: null }),
  closeModal: () => set({ modal: null }),
  openMenu: (message, rect) => set({ menu: { message, rect } }),
  closeMenu: () => set({ menu: null }),
  openViewer: (items, index) => set({ viewer: { items, index } }),
  closeViewer: () => set({ viewer: null }),
  pushNotice(n) {
    const id = seq++;
    set({ notices: [...get().notices.filter((x) => x.chatId !== n.chatId), { ...n, id }].slice(-3) });
    window.setTimeout(() => get().dropNotice(id), 4200);
  },
  dropNotice: (id) => set({ notices: get().notices.filter((n) => n.id !== id) }),
  toast(text, tone = 'info') {
    const id = seq++;
    set({ toasts: [...get().toasts, { id, text, tone }].slice(-3) });
    window.setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3200);
  },
  setSpotlight: (spotlight) => set({ spotlight }),
  setChatSearch: (chatSearch) => set({ chatSearch }),
}));

export const toast = (text: string, tone?: Toast['tone']) => useUI.getState().toast(text, tone);
