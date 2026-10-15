import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, CornerDownLeft, Megaphone, Palette, Phone, Search, Settings, Users } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import type { User } from '../../api/types';
import { useAuth } from '../../store/auth';
import { chatTitle, useChats } from '../../store/chats';
import { useUI } from '../../store/ui';
import { useSortedChats } from '../sidebar/ChatsPanel';
import { ChatAvatar, UserAvatar } from '../ui/Avatar';
import { Portal } from '../ui/primitives';

interface Item {
  key: string;
  icon: ReactNode;
  title: string;
  sub?: string;
  run: () => void;
}

/** Ctrl+K: jump anywhere — chats, people, actions. */
export function Spotlight() {
  const open = useUI((s) => s.spotlight);
  const setOpen = useUI((s) => s.setSpotlight);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useUI.getState().spotlight);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);
  return (
    <Portal>
      <AnimatePresence>{open && <SpotlightBody key="sl" onClose={() => setOpen(false)} />}</AnimatePresence>
    </Portal>
  );
}

function SpotlightBody({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [people, setPeople] = useState<User[]>([]);
  const chats = useSortedChats();
  const users = useChats((s) => s.users);
  const me = useAuth((s) => s.me!.id);
  const openModal = useUI((s) => s.openModal);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setPeople([]);
      return;
    }
    let alive = true;
    const t = window.setTimeout(() => {
      api.searchUsers(term).then((u) => alive && setPeople(u)).catch(() => undefined);
    }, 180);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const goChat = (id: number) => () => {
      useUI.setState({ tab: 'chats' });
      useChats.getState().openChat(id);
    };
    const chatItems: Item[] = chats
      .filter((c) => !term || chatTitle(c, users, me).toLowerCase().includes(term))
      .slice(0, term ? 8 : 5)
      .map((c) => ({ key: `c${c.id}`, icon: <ChatAvatar chat={c} size={34} showOnline={false} />, title: chatTitle(c, users, me), sub: c.unread_count ? `${c.unread_count} непрочитанных` : 'Чат', run: goChat(c.id) }));
    const known = new Set(chats.flatMap((c) => (c.type === 'private' ? c.member_ids : [])));
    const peopleItems: Item[] = people
      .filter((u) => !known.has(u.id))
      .slice(0, 5)
      .map((u) => ({
        key: `u${u.id}`,
        icon: <UserAvatar user={u} size={34} />,
        title: u.display_name,
        sub: `@${u.username}`,
        run: () => {
          useUI.setState({ tab: 'chats' });
          void useChats.getState().openPrivate(u.id);
        },
      }));
    const actions: Item[] = [
      { key: 'a-group', icon: <span className="sl-ico"><Users size={17} /></span>, title: 'Создать группу', run: () => openModal({ kind: 'newGroup', type: 'group' }) },
      { key: 'a-channel', icon: <span className="sl-ico"><Megaphone size={17} /></span>, title: 'Создать канал', run: () => openModal({ kind: 'newGroup', type: 'channel' }) },
      { key: 'a-saved', icon: <span className="sl-ico"><Bookmark size={17} /></span>, title: 'Открыть Избранное', run: () => void useChats.getState().openPrivate(me) },
      { key: 'a-calls', icon: <span className="sl-ico"><Phone size={17} /></span>, title: 'История звонков', run: () => useUI.setState({ tab: 'calls' }) },
      { key: 'a-theme', icon: <span className="sl-ico"><Palette size={17} /></span>, title: 'Оформление и цвета', run: () => useUI.setState({ tab: 'settings' }) },
      { key: 'a-settings', icon: <span className="sl-ico"><Settings size={17} /></span>, title: 'Настройки', run: () => useUI.setState({ tab: 'settings' }) },
    ].filter((a) => !term || a.title.toLowerCase().includes(term));
    return [...chatItems, ...peopleItems, ...actions];
  }, [q, chats, users, me, people, openModal]);

  useEffect(() => setSel(0), [q]);

  const run = (it: Item | undefined) => {
    if (!it) return;
    onClose();
    it.run();
  };

  return (
    <motion.div className="spotlight-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div
        className="spotlight"
        initial={{ opacity: 0, y: -20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -12, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 520, damping: 36 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="spotlight-input">
          <Search size={20} />
          <input
            autoFocus
            placeholder="Куда отправимся?"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(items.length - 1, s + 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              }
              if (e.key === 'Enter') {
                // keep the keystroke from landing in the composer that the jump focuses
                e.preventDefault();
                const target = items[sel];
                window.setTimeout(() => run(target), 0);
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="spotlight-list">
          {items.map((it, i) => (
            <button key={it.key} className={`spotlight-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => run(it)}>
              {it.icon}
              <div className="row-text">
                <div className="row-title">{it.title}</div>
                {it.sub && <div className="row-sub">{it.sub}</div>}
              </div>
              {i === sel && <CornerDownLeft size={16} className="muted" />}
            </button>
          ))}
          {!items.length && <div className="muted-center">Ничего не найдено</div>}
        </div>
      </motion.div>
    </motion.div>
  );
}
