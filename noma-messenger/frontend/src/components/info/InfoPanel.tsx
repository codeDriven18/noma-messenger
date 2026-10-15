import { motion } from 'framer-motion';
import { AtSign, Bell, BellOff, Crown, Info, Link2, LogOut, MoreVertical, Pencil, Phone, Play, Search, Shield, ShieldOff, Trash2, UserMinus, UserPlus, Video, X } from 'lucide-react';
import { type MouseEvent, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Chat, Message } from '../../api/types';
import { duration, fileSize, lastSeen, membersLabel, shortStamp } from '../../lib/format';
import { downloadUrl } from '../../lib/media';
import { useAuth } from '../../store/auth';
import { useCall } from '../../store/call';
import { chatPeer, chatTitle, useChats } from '../../store/chats';
import { toast, useUI } from '../../store/ui';
import { ChatAvatar, UserAvatar } from '../ui/Avatar';
import { FloatingMenu, type MenuItem } from '../ui/FloatingMenu';
import { Spinner, spring } from '../ui/primitives';
import { src } from '../message/MessageParts';
import { VoicePlayer } from '../message/VoicePlayer';

type SharedKind = 'media' | 'files' | 'voice' | 'links';
const TABS: { id: SharedKind; label: string }[] = [
  { id: 'media', label: 'Медиа' },
  { id: 'files', label: 'Файлы' },
  { id: 'voice', label: 'Голосовые' },
  { id: 'links', label: 'Ссылки' },
];

export function InfoPanel({ chatId }: { chatId: number }) {
  const chat = useChats((s) => s.chats[chatId]);
  const users = useChats((s) => s.users);
  const me = useAuth((s) => s.me!.id);
  const close = () => useUI.getState().setInfoOpen(false);
  const openModal = useUI((s) => s.openModal);
  const [tab, setTab] = useState<SharedKind>('media');
  const [shared, setShared] = useState<Message[] | null>(null);
  const [menu, setMenu] = useState<{ uid: number; at: { x: number; y: number } } | null>(null);

  useEffect(() => {
    if (!chat || chat.my_role === null) return;
    setShared(null);
    api
      .shared(chatId, tab)
      .then(setShared)
      .catch(() => setShared([]));
  }, [chatId, tab, chat?.last_message?.id, chat?.my_role]);

  useEffect(() => {
    if (chat) useChats.getState().ensureUsers(chat.member_ids);
  }, [chat]);

  if (!chat) return null;
  const peer = chatPeer(chat, users, me);
  const title = chatTitle(chat, users, me);
  const isAdmin = chat.my_role === 'owner' || chat.my_role === 'admin';
  const isGroupish = chat.type === 'group' || chat.type === 'channel';

  const status =
    chat.type === 'private' ? lastSeen(peer) : chat.type === 'saved' ? 'ваше облачное хранилище' : membersLabel(chat.member_count, chat.type === 'channel');

  const members = isGroupish
    ? [...chat.member_ids].sort((a, b) => rank(chat, a) - rank(chat, b) || Number(users[b]?.online) - Number(users[a]?.online))
    : [];

  const memberMenu: MenuItem[] = menu
    ? [
        ...(chat.my_role === 'owner'
          ? [
              chat.roles[String(menu.uid)] === 'admin'
                ? { label: 'Снять админа', icon: <ShieldOff size={17} />, onClick: () => void api.setRole(chat.id, menu.uid, 'member').catch((e) => toast(e.message, 'error')) }
                : { label: 'Сделать админом', icon: <Shield size={17} />, onClick: () => void api.setRole(chat.id, menu.uid, 'admin').catch((e) => toast(e.message, 'error')) },
            ]
          : []),
        {
          label: 'Удалить из чата',
          icon: <UserMinus size={17} />,
          danger: true,
          onClick: () => void api.removeMember(chat.id, menu.uid).catch((e) => toast(e.message, 'error')),
        },
      ]
    : [];

  const leaveLabel = chat.type === 'private' || chat.type === 'saved' || chat.my_role === 'owner' ? 'Удалить чат' : chat.type === 'channel' ? 'Отписаться' : 'Покинуть группу';

  return (
    <motion.aside className="info-panel" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={spring}>
      <div className="info-head">
        <button className="icon-btn" onClick={close}>
          <X size={20} />
        </button>
        <span className="info-head-title">{chat.type === 'private' ? 'Профиль' : chat.type === 'channel' ? 'Канал' : chat.type === 'saved' ? 'Избранное' : 'Группа'}</span>
        {isGroupish && isAdmin ? (
          <button className="icon-btn" onClick={() => openModal({ kind: 'editChat', chatId: chat.id })} title="Изменить">
            <Pencil size={18} />
          </button>
        ) : (
          <span style={{ width: 40 }} />
        )}
      </div>

      <div className="info-scroll">
        <div className="info-hero">
          <div className="info-hero-glow" />
          <ChatAvatar chat={chat} size={104} />
          <div className="info-title">{title}</div>
          <div className={`info-status ${peer?.online ? 'accent-text' : ''}`}>{status}</div>
        </div>

        <div className="profile-actions">
          {chat.type !== 'saved' && chat.my_role !== null && (
            <button onClick={() => void useChats.getState().updateSettings(chat.id, { muted: !chat.muted })}>
              {chat.muted ? <BellOff size={20} /> : <Bell size={20} />}
              <span>{chat.muted ? 'Без звука' : 'Звук'}</span>
            </button>
          )}
          <button onClick={() => { useUI.getState().setChatSearch(true); if (window.innerWidth < 1200) close(); }}>
            <Search size={20} />
            <span>Поиск</span>
          </button>
          {peer && !peer.is_bot && (
            <>
              <button onClick={() => void useCall.getState().start(chat.id, peer.id, false)}>
                <Phone size={20} />
                <span>Звонок</span>
              </button>
              <button onClick={() => void useCall.getState().start(chat.id, peer.id, true)}>
                <Video size={20} />
                <span>Видео</span>
              </button>
            </>
          )}
          {isGroupish && isAdmin && (
            <button onClick={() => openModal({ kind: 'addMembers', chatId: chat.id })}>
              <UserPlus size={20} />
              <span>Добавить</span>
            </button>
          )}
        </div>

        <div className="info-list">
          {peer && (
            <div className="info-item">
              <AtSign size={18} className="info-icon" />
              <div>
                <div className="accent-text">@{peer.username}</div>
                <div className="info-label">Имя пользователя</div>
              </div>
            </div>
          )}
          {peer?.bio && (
            <div className="info-item">
              <Info size={18} className="info-icon" />
              <div>
                <div className="pre-wrap">{peer.bio}</div>
                <div className="info-label">О себе</div>
              </div>
            </div>
          )}
          {chat.description && (
            <div className="info-item">
              <Info size={18} className="info-icon" />
              <div>
                <div className="pre-wrap">{chat.description}</div>
                <div className="info-label">Описание</div>
              </div>
            </div>
          )}
          {chat.is_public && chat.username && (
            <div
              className="info-item clickable"
              onClick={() => {
                void navigator.clipboard?.writeText(`@${chat.username}`);
                toast('Ссылка скопирована');
              }}
            >
              <Link2 size={18} className="info-icon" />
              <div>
                <div className="accent-text">@{chat.username}</div>
                <div className="info-label">Публичная ссылка</div>
              </div>
            </div>
          )}
        </div>

        {isGroupish && (chat.type === 'group' || isAdmin) && (
          <div className="info-section">
            <div className="info-section-title">
              {membersLabel(chat.member_count, chat.type === 'channel')}
              {isAdmin && (
                <button className="link" onClick={() => openModal({ kind: 'addMembers', chatId: chat.id })}>
                  <UserPlus size={15} /> Добавить
                </button>
              )}
            </div>
            {members.map((uid) => {
              const u = users[uid];
              const role = chat.roles[String(uid)];
              const canManage = isAdmin && uid !== me && role !== 'owner' && !(role === 'admin' && chat.my_role !== 'owner');
              return (
                <div
                  key={uid}
                  className="row-item"
                  onClick={() => uid !== me && openModal({ kind: 'userProfile', userId: uid })}
                  onContextMenu={(e: MouseEvent) => {
                    if (!canManage) return;
                    e.preventDefault();
                    setMenu({ uid, at: { x: e.clientX, y: e.clientY } });
                  }}
                >
                  <UserAvatar user={u} size={40} />
                  <div className="row-text">
                    <div className="row-title">
                      {u?.display_name ?? '…'} {uid === me && <span className="muted">(вы)</span>}
                    </div>
                    <div className={`row-sub ${u?.online ? 'accent-text' : ''}`}>{lastSeen(u)}</div>
                  </div>
                  {role && (
                    <span className="role-badge">
                      {role === 'owner' ? <Crown size={12} /> : <Shield size={12} />} {role === 'owner' ? 'владелец' : 'админ'}
                    </span>
                  )}
                  {canManage && (
                    <button
                      className="icon-btn small"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenu({ uid, at: { x: e.clientX, y: e.clientY } });
                      }}
                    >
                      <MoreVertical size={16} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {chat.my_role !== null && (
          <div className="info-section">
            <div className="shared-tabs">
              {TABS.map((t) => (
                <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                  {tab === t.id && <motion.span layoutId="shared-pill" className="shared-pill" transition={spring} />}
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
            <SharedList chat={chat} kind={tab} items={shared} />
          </div>
        )}

        {chat.my_role !== null && (
          <div className="info-section">
            <button
              className="danger-row"
              onClick={() =>
                openModal({
                  kind: 'confirm',
                  title: `${leaveLabel}?`,
                  text:
                    chat.type === 'private'
                      ? 'Переписка будет удалена у обоих собеседников.'
                      : chat.my_role === 'owner'
                        ? 'Чат будет удалён для всех участников без возможности восстановления.'
                        : 'Вы больше не будете получать сообщения из этого чата.',
                  action: leaveLabel,
                  danger: true,
                  onConfirm: () => void useChats.getState().deleteChat(chat.id),
                })
              }
            >
              {chat.type === 'private' || chat.my_role === 'owner' || chat.type === 'saved' ? <Trash2 size={18} /> : <LogOut size={18} />}
              {leaveLabel}
            </button>
          </div>
        )}
      </div>
      <FloatingMenu at={menu?.at ?? null} items={memberMenu} onClose={() => setMenu(null)} />
    </motion.aside>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

function rank(chat: Chat, uid: number) {
  const r = chat.roles[String(uid)];
  return r === 'owner' ? 0 : r === 'admin' ? 1 : 2;
}

function SharedList({ chat, kind, items }: { chat: Chat; kind: SharedKind; items: Message[] | null }) {
  if (items === null)
    return (
      <div className="center-pad small">
        <Spinner size={18} />
      </div>
    );
  if (!items.length) return <div className="muted-center">Здесь пока ничего нет</div>;
  if (kind === 'media') {
    const tiles = items.flatMap((m) => m.attachments.filter((a) => a.kind === 'photo' || a.kind === 'video').map((a) => ({ m, a })));
    return (
      <div className="shared-grid">
        {tiles.map(({ a }) => (
          <button
            key={a.url}
            onClick={() => {
              const all = tiles.map((t) => ({ attachment: t.a, message: t.m })).reverse();
              const index = all.findIndex((t) => t.attachment.url === a.url);
              useUI.getState().openViewer(all, index);
            }}
          >
            {a.kind === 'video' && !a.thumb ? <video src={`${src(a.url)}#t=0.1`} muted preload="metadata" /> : <img src={src(a.thumb ?? a.url)} alt="" loading="lazy" />}
            {a.kind === 'video' && (
              <span className="duration-badge">
                <Play size={10} fill="currentColor" /> {duration(a.duration)}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }
  if (kind === 'files') {
    return (
      <div className="shared-files">
        {items.flatMap((m) =>
          m.attachments
            .filter((a) => a.kind === 'file' || a.kind === 'audio')
            .map((a) => (
              <button key={a.url} className="file-row standalone" onClick={() => downloadUrl(src(a.url), a.name)}>
                <div className="file-icon">
                  <span className="file-ext">{(a.name?.split('.').pop() ?? 'file').slice(0, 4).toUpperCase()}</span>
                </div>
                <div className="file-info">
                  <div className="file-name ellipsis">{a.name}</div>
                  <div className="file-size">
                    {fileSize(a.size)} · {shortStamp(m.created_at)}
                  </div>
                </div>
              </button>
            )),
        )}
      </div>
    );
  }
  if (kind === 'voice') {
    return (
      <div className="shared-files">
        {items.map((m) => {
          const a = m.attachments.find((x) => x.kind === 'voice' || x.kind === 'video_note');
          if (!a) return null;
          return a.kind === 'voice' ? (
            <div key={m.id} className="shared-voice">
              <VoicePlayer message={m} att={a} />
              <span className="row-time">{shortStamp(m.created_at)}</span>
            </div>
          ) : (
            <button key={m.id} className="row-item" onClick={() => void useChats.getState().jumpTo(chat.id, m.id)}>
              <span className="qa-icon"><Video size={18} /></span>
              <div className="row-text">
                <div className="row-title">Видеосообщение</div>
                <div className="row-sub">{duration(a.duration)} · {shortStamp(m.created_at)}</div>
              </div>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="shared-files">
      {items.flatMap((m) =>
        (m.text.match(/https?:\/\/[^\s<]+/g) ?? []).map((url, i) => (
          <a key={`${m.id}-${i}`} className="link-row" href={url} target="_blank" rel="noopener noreferrer">
            <span className="link-fav">{hostOf(url).slice(0, 1).toUpperCase()}</span>
            <div className="row-text">
              <div className="row-title ellipsis">{hostOf(url)}</div>
              <div className="row-sub ellipsis">{url}</div>
            </div>
          </a>
        )),
      )}
    </div>
  );
}

