import { AnimatePresence, motion } from 'framer-motion';
import { Archive, ArchiveRestore, Bell, BellOff, CheckCheck, Command, MessageCircle, Pin, PinOff, Search, SquarePen, Trash2, X } from 'lucide-react';
import { type MouseEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import type { Chat, User } from '../../api/types';
import { lastSeen, membersLabel } from '../../lib/format';
import { useAuth } from '../../store/auth';
import { chatTitle, useChats } from '../../store/chats';
import { useUI } from '../../store/ui';
import { Avatar, ChatAvatar, UserAvatar } from '../ui/Avatar';
import { FloatingMenu, type MenuItem } from '../ui/FloatingMenu';
import { Empty, Spinner, spring } from '../ui/primitives';
import { ChatListItem } from './ChatListItem';
import { LargeTitle } from './Nav';

type Folder = 'all' | 'personal' | 'groups' | 'channels' | 'unread' | 'archive';

const FOLDERS: { id: Folder; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'personal', label: 'Личные' },
  { id: 'groups', label: 'Группы' },
  { id: 'channels', label: 'Каналы' },
  { id: 'unread', label: 'Новые' },
];

export const activity = (c: Chat) => new Date(c.last_message?.created_at ?? c.created_at).getTime();

export function useSortedChats() {
  const chats = useChats((s) => s.chats);
  const activeId = useChats((s) => s.activeId);
  const me = useAuth((s) => s.me?.id ?? 0);
  return useMemo(
    () =>
      Object.values(chats)
        .filter((c) => c.my_role !== null)
        .filter((c) => !(c.type === 'private' && !c.last_message && c.id !== activeId && c.created_by !== me))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || activity(b) - activity(a)),
    [chats, activeId, me],
  );
}

export function ChatsPanel() {
  const all = useSortedChats();
  const users = useChats((s) => s.users);
  const typing = useChats((s) => s.typing);
  const drafts = useChats((s) => s.drafts);
  const activeId = useChats((s) => s.activeId);
  const loaded = useChats((s) => s.loaded);
  const { openChat, updateSettings, markRead, deleteChat } = useChats.getState();
  const me = useAuth((s) => s.me!);
  const openModal = useUI((s) => s.openModal);
  const [folder, setFolder] = useState<Folder>('all');
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ chat: Chat; at: { x: number; y: number } } | null>(null);

  const archivedCount = all.filter((c) => c.archived).length;
  const visible = useMemo(() => {
    return all.filter((c) => {
      if (folder === 'archive') return c.archived;
      if (c.archived) return false;
      if (folder === 'personal') return c.type === 'private' || c.type === 'saved';
      if (folder === 'groups') return c.type === 'group';
      if (folder === 'channels') return c.type === 'channel';
      if (folder === 'unread') return c.unread_count > 0;
      return true;
    });
  }, [all, folder]);

  const folderUnread = (f: Folder) =>
    all.filter((c) => !c.archived && !c.muted && c.unread_count > 0 && (f === 'all' || (f === 'personal' ? c.type === 'private' : f === 'groups' ? c.type === 'group' : f === 'channels' ? c.type === 'channel' : f === 'unread'))).length;

  const onlineFriends = useMemo(() => {
    const ids = new Set<number>();
    for (const c of all) if (c.type === 'private') c.member_ids.forEach((id) => id !== me.id && ids.add(id));
    return [...ids].map((id) => users[id]).filter((u): u is User => !!u && u.online && !u.is_bot);
  }, [all, users, me.id]);

  const onMenu = useCallback((chat: Chat, e: MouseEvent) => setMenu({ chat, at: { x: e.clientX, y: e.clientY } }), []);
  const onOpen = useCallback((id: number) => openChat(id), [openChat]);

  const menuItems: MenuItem[] = menu
    ? [
        {
          label: menu.chat.pinned ? 'Открепить' : 'Закрепить',
          icon: menu.chat.pinned ? <PinOff size={17} /> : <Pin size={17} />,
          onClick: () => updateSettings(menu.chat.id, { pinned: !menu.chat.pinned }),
        },
        ...(menu.chat.type !== 'saved'
          ? [
              {
                label: menu.chat.muted ? 'Включить звук' : 'Без звука',
                icon: menu.chat.muted ? <Bell size={17} /> : <BellOff size={17} />,
                onClick: () => updateSettings(menu.chat.id, { muted: !menu.chat.muted }),
              },
            ]
          : []),
        ...(menu.chat.unread_count
          ? [{ label: 'Прочитано', icon: <CheckCheck size={17} />, onClick: () => markRead(menu.chat.id) }]
          : []),
        {
          label: menu.chat.archived ? 'Вернуть из архива' : 'В архив',
          icon: menu.chat.archived ? <ArchiveRestore size={17} /> : <Archive size={17} />,
          onClick: () => updateSettings(menu.chat.id, { archived: !menu.chat.archived }),
        },
        {
          label: menu.chat.type === 'private' || menu.chat.type === 'saved' || menu.chat.my_role === 'owner' ? 'Удалить чат' : 'Покинуть',
          icon: <Trash2 size={17} />,
          danger: true,
          onClick: () =>
            openModal({
              kind: 'confirm',
              title: 'Удалить чат?',
              text:
                menu.chat.type === 'private'
                  ? 'Переписка будет удалена у обоих собеседников.'
                  : menu.chat.my_role === 'owner'
                    ? 'Чат будет удалён для всех участников.'
                    : 'Вы покинете этот чат.',
              action: 'Удалить',
              danger: true,
              onConfirm: () => deleteChat(menu.chat.id),
            }),
        },
      ]
    : [];

  return (
    <motion.div className="panel" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}>
      <LargeTitle
        title="Чаты"
        actions={
          <>
            <button className="icon-btn" title="Быстрый поиск (Ctrl+K)" onClick={() => useUI.getState().setSpotlight(true)}>
              <Command size={20} />
            </button>
            <button className="icon-btn" title="Новый чат" onClick={() => openModal({ kind: 'newChat' })}>
              <SquarePen size={20} />
            </button>
          </>
        }
      />

      <div className="search-box">
        <Search size={17} />
        <input placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && (
          <button className="search-clear" onClick={() => setQuery('')}>
            <X size={14} />
          </button>
        )}
      </div>

      {query.trim() ? (
        <SearchResults query={query.trim()} chats={all} onDone={() => setQuery('')} />
      ) : (
        <>
          <div className="folders">
            {[...FOLDERS, ...(archivedCount ? [{ id: 'archive' as Folder, label: 'Архив' }] : [])].map((f) => {
              const n = f.id === 'archive' ? 0 : folderUnread(f.id);
              return (
                <button key={f.id} className={`folder ${folder === f.id ? 'active' : ''}`} onClick={() => setFolder(f.id)}>
                  {folder === f.id && <motion.span layoutId="folder-pill" className="folder-pill" transition={spring} />}
                  <span className="folder-label">
                    {f.label}
                    {n > 0 && f.id !== 'unread' && <span className="folder-count">{n}</span>}
                  </span>
                </button>
              );
            })}
          </div>

          <AnimatePresence initial={false}>
            {onlineFriends.length > 0 && folder === 'all' && (
              <motion.div className="pulse-row" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                <div className="pulse-label">
                  <span className="pulse-dot" /> Сейчас в сети
                </div>
                <div className="pulse-list">
                  {onlineFriends.map((u) => (
                    <motion.button
                      key={u.id}
                      className="pulse-item"
                      onClick={() => void useChats.getState().openPrivate(u.id)}
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      whileTap={{ scale: 0.92 }}
                    >
                      <UserAvatar user={{ ...u, online: false }} size={52} ring />
                      <span className="ellipsis">{u.display_name.split(' ')[0]}</span>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="chat-list">
            {!loaded ? (
              <div className="center-pad">
                <Spinner />
              </div>
            ) : visible.length === 0 ? (
              <Empty
                icon={<MessageCircle size={30} />}
                title={folder === 'all' ? 'Пока пусто' : 'Здесь ничего нет'}
                text={folder === 'all' ? 'Найдите друзей через поиск и начните общение' : 'В этой папке пока нет чатов'}
              >
                {folder === 'all' && (
                  <button className="btn-primary" onClick={() => openModal({ kind: 'newChat' })}>
                    Новый чат
                  </button>
                )}
              </Empty>
            ) : (
              visible.map((c) => (
                <ChatListItem
                  key={c.id}
                  chat={c}
                  users={users}
                  me={me.id}
                  active={c.id === activeId}
                  typing={typing[c.id]}
                  draft={drafts[c.id]}
                  onOpen={onOpen}
                  onMenu={onMenu}
                />
              ))
            )}
          </div>
        </>
      )}
      <FloatingMenu at={menu?.at ?? null} items={menuItems} onClose={() => setMenu(null)} />
    </motion.div>
  );
}

function SearchResults({ query, chats, onDone }: { query: string; chats: Chat[]; onDone: () => void }) {
  const users = useChats((s) => s.users);
  const me = useAuth((s) => s.me!.id);
  const [people, setPeople] = useState<User[] | null>(null);
  const [publicChats, setPublicChats] = useState<Chat[]>([]);

  useEffect(() => {
    let alive = true;
    setPeople(null);
    const t = window.setTimeout(async () => {
      try {
        const [u, p] = await Promise.all([api.searchUsers(query), api.searchPublic(query)]);
        if (!alive) return;
        useChats.getState().mergeUsers(u);
        setPeople(u);
        setPublicChats(p);
      } catch {
        if (alive) setPeople([]);
      }
    }, 220);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [query]);

  const q = query.toLowerCase().replace(/^@/, '');
  const localChats = chats.filter((c) => chatTitle(c, users, me).toLowerCase().includes(q) || c.username?.includes(q)).slice(0, 8);
  const localIds = new Set(localChats.map((c) => c.id));
  const known = new Set(localChats.flatMap((c) => (c.type === 'private' ? c.member_ids : [])));
  const globalPeople = (people ?? []).filter((u) => !known.has(u.id));
  const globalChats = publicChats.filter((c) => !localIds.has(c.id));

  const open = (fn: () => void) => {
    fn();
    onDone();
  };

  return (
    <div className="chat-list search-results">
      {localChats.length > 0 && <div className="list-section">Чаты</div>}
      {localChats.map((c) => (
        <button key={c.id} className="row-item" onClick={() => open(() => useChats.getState().openChat(c.id))}>
          <ChatAvatar chat={c} size={44} />
          <div className="row-text">
            <div className="row-title">{chatTitle(c, users, me)}</div>
            <div className="row-sub">
              {c.type === 'private' ? lastSeen(users[c.member_ids.find((i) => i !== me) ?? 0]) : membersLabel(c.member_count, c.type === 'channel')}
            </div>
          </div>
        </button>
      ))}
      {globalPeople.length > 0 && <div className="list-section">Люди</div>}
      {globalPeople.map((u) => (
        <button key={u.id} className="row-item" onClick={() => open(() => void useChats.getState().openPrivate(u.id))}>
          <UserAvatar user={u} size={44} />
          <div className="row-text">
            <div className="row-title">{u.display_name}</div>
            <div className="row-sub">@{u.username}</div>
          </div>
        </button>
      ))}
      {globalChats.length > 0 && <div className="list-section">Публичные группы и каналы</div>}
      {globalChats.map((c) => (
        <button key={c.id} className="row-item" onClick={() => open(() => useChats.getState().previewChat(c))}>
          <Avatar url={c.avatar_url} name={c.title} color={c.color} size={44} round={false} />
          <div className="row-text">
            <div className="row-title">{c.title}</div>
            <div className="row-sub">
              @{c.username} · {membersLabel(c.member_count, c.type === 'channel')}
            </div>
          </div>
        </button>
      ))}
      {people === null && (
        <div className="center-pad">
          <Spinner />
        </div>
      )}
      {people !== null && !localChats.length && !globalPeople.length && !globalChats.length && (
        <Empty icon={<Search size={28} />} title="Ничего не найдено" text="Попробуйте другое имя или @username" />
      )}
    </div>
  );
}
