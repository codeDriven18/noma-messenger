import { create } from 'zustand';
import { api, getToken, onUnauthorized, setToken } from '../api/client';
import type { User } from '../api/types';
import { socket } from '../lib/socket';

interface AuthState {
  token: string | null;
  me: User | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, displayName: string, password: string) => Promise<void>;
  loadMe: () => Promise<void>;
  setMe: (u: User) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  token: getToken(),
  me: null,
  async login(username, password) {
    const res = await api.login(username, password);
    setToken(res.token);
    set({ token: res.token, me: res.user });
  },
  async register(username, displayName, password) {
    const res = await api.register(username, displayName, password);
    setToken(res.token);
    set({ token: res.token, me: res.user });
  },
  async loadMe() {
    try {
      set({ me: await api.me() });
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        setToken(null);
        set({ token: null, me: null });
      } else {
        // backend unreachable: retry shortly
        window.setTimeout(() => void useAuth.getState().loadMe(), 2500);
      }
    }
  },
  setMe: (u) => set({ me: u }),
  logout() {
    socket.close();
    setToken(null);
    set({ token: null, me: null });
    window.location.reload();
  },
}));

onUnauthorized(() => {
  setToken(null);
  useAuth.setState({ token: null, me: null });
});

export const myId = () => useAuth.getState().me?.id ?? 0;
