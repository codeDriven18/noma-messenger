import { AnimatePresence, motion } from 'framer-motion';
import { Check, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { User } from '../../api/types';
import { lastSeen } from '../../lib/format';
import { useChats } from '../../store/chats';
import { UserAvatar } from '../ui/Avatar';
import { Spinner } from '../ui/primitives';

/** Contacts by default, global search as you type. */
export function useUserSearch(query: string) {
  const [contacts, setContacts] = useState<User[] | null>(null);
  const [found, setFound] = useState<User[] | null>(null);
  useEffect(() => {
    api
      .contacts()
      .then((u) => {
        useChats.getState().mergeUsers(u);
        setContacts(u.filter((x) => !x.is_bot));
      })
      .catch(() => setContacts([]));
  }, []);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setFound(null);
      return;
    }
    let alive = true;
    const t = window.setTimeout(() => {
      api
        .searchUsers(q)
        .then((u) => {
          if (!alive) return;
          useChats.getState().mergeUsers(u);
          setFound(u);
        })
        .catch(() => alive && setFound([]));
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [query]);
  return query.trim() ? found : contacts;
}

export function UserPicker({ selected, onChange, exclude = [] }: { selected: User[]; onChange: (u: User[]) => void; exclude?: number[] }) {
  const [query, setQuery] = useState('');
  const list = useUserSearch(query);
  const toggle = (u: User) => onChange(selected.some((s) => s.id === u.id) ? selected.filter((s) => s.id !== u.id) : [...selected, u]);
  const visible = (list ?? []).filter((u) => !u.is_bot && !exclude.includes(u.id));

  return (
    <div className="picker">
      <div className="picker-chips">
        <AnimatePresence>
          {selected.map((u) => (
            <motion.button key={u.id} className="picker-chip" layout initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} onClick={() => toggle(u)}>
              <UserAvatar user={u} size={24} />
              {u.display_name.split(' ')[0]}
              <X size={13} />
            </motion.button>
          ))}
        </AnimatePresence>
        <div className="search-box inline grow">
          <Search size={16} />
          <input autoFocus placeholder="Поиск людей" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <div className="picker-list">
        {list === null ? (
          <div className="center-pad small">
            <Spinner size={18} />
          </div>
        ) : visible.length === 0 ? (
          <div className="muted-center">{query ? 'Никого не нашли' : 'Найдите людей по имени или @username'}</div>
        ) : (
          visible.map((u) => {
            const on = selected.some((s) => s.id === u.id);
            return (
              <button key={u.id} className="row-item" onClick={() => toggle(u)}>
                <UserAvatar user={u} size={42} />
                <div className="row-text">
                  <div className="row-title">{u.display_name}</div>
                  <div className={`row-sub ${u.online ? 'accent-text' : ''}`}>{u.online ? 'в сети' : `@${u.username} · ${lastSeen(u)}`}</div>
                </div>
                <span className={`check ${on ? 'on' : ''}`}>{on && <Check size={14} strokeWidth={3} />}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
