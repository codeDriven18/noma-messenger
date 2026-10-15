import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, Check, ChevronLeft, FileText, Globe, Megaphone, MessageCircle, Phone, Search, Users, Video, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import type { User } from '../../api/types';
import { duration, fileSize, lastSeen, membersLabel } from '../../lib/format';
import type { LocalAttachment } from '../../lib/media';
import { useAuth } from '../../store/auth';
import { useCall } from '../../store/call';
import { chatTitle, useChats } from '../../store/chats';
import { type Modal, toast, useUI } from '../../store/ui';
import { useSortedChats } from '../sidebar/ChatsPanel';
import { ChatAvatar, UserAvatar } from '../ui/Avatar';
import { Sheet, Spinner, Switch } from '../ui/primitives';
import { AvatarUpload } from './AvatarUpload';
import { UserPicker, useUserSearch } from './UserPicker';

export function ModalHost() {
  const modal = useUI((s) => s.modal);
  const close = useUI((s) => s.closeModal);
  const [last, setLast] = useState<Modal | null>(modal);
  useEffect(() => {
    if (modal) setLast(modal);
  }, [modal]);
  const m = modal ?? last;
  const open = !!modal;
  if (!m) return null;
  switch (m.kind) {
    case 'newChat':
      return <NewChat open={open} onClose={close} />;
    case 'newGroup':
      return <NewGroup open={open} onClose={close} type={m.type} key={`ng-${m.type}`} />;
    case 'forward':
      return <ForwardModal open={open} onClose={close} ids={m.messageIds} />;
    case 'addMembers':
      return <AddMembers open={open} onClose={close} chatId={m.chatId} />;
    case 'editProfile':
      return <EditProfile open={open} onClose={close} />;
    case 'editChat':
      return <EditChat open={open} onClose={close} chatId={m.chatId} />;
    case 'userProfile':
      return <UserProfile open={open} onClose={close} userId={m.userId} />;
    case 'sendFiles':
      return <SendFiles open={open} onClose={close} chatId={m.chatId} items={m.items} key={m.items.map((i) => i.previewUrl).join()} />;
    case 'confirm':
      return (
        <Sheet open={open} onClose={close} width={380} className="confirm">
          <div className="confirm-title">{m.title}</div>
          <div className="confirm-text">{m.text}</div>
          <div className="confirm-actions">
            <button className="btn-ghost" onClick={close}>
              Отмена
            </button>
            <button
              className={m.danger ? 'btn-danger' : 'btn-primary'}
              onClick={() => {
                close();
                m.onConfirm();
              }}
            >
              {m.action}
            </button>
          </div>
        </Sheet>
      );
    default:
      return null;
  }
}

type P = { open: boolean; onClose: () => void };

/* ------------------------------------------------------------- new chat */

function NewChat({ open, onClose }: P) {
  const [query, setQuery] = useState('');
  const list = useUserSearch(query);
  const openModal = useUI((s) => s.openModal);
  const me = useAuth((s) => s.me!.id);
  const go = (id: number) => {
    onClose();
    useUI.setState({ tab: 'chats' });
    void useChats.getState().openPrivate(id);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Новый чат">
      <div className="search-box inline">
        <Search size={16} />
        <input autoFocus placeholder="Имя или @username" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {!query && (
        <div className="quick-actions">
          <button className="row-item" onClick={() => openModal({ kind: 'newGroup', type: 'group' })}>
            <span className="qa-icon"><Users size={20} /></span>
            <div className="row-text"><div className="row-title">Новая группа</div><div className="row-sub">До 500 участников, админы и роли</div></div>
          </button>
          <button className="row-item" onClick={() => openModal({ kind: 'newGroup', type: 'channel' })}>
            <span className="qa-icon violet"><Megaphone size={20} /></span>
            <div className="row-text"><div className="row-title">Новый канал</div><div className="row-sub">Публикации для неограниченной аудитории</div></div>
          </button>
          <button className="row-item" onClick={() => go(me)}>
            <span className="qa-icon cyan"><Bookmark size={20} /></span>
            <div className="row-text"><div className="row-title">Избранное</div><div className="row-sub">Заметки и файлы для себя</div></div>
          </button>
        </div>
      )}
      <div className="list-section">{query ? 'Результаты поиска' : 'Контакты'}</div>
      <div className="picker-list">
        {list === null ? (
          <div className="center-pad small"><Spinner size={18} /></div>
        ) : list.length === 0 ? (
          <div className="muted-center">{query ? 'Никого не нашли' : 'Пока нет контактов — найдите друзей по имени'}</div>
        ) : (
          list.map((u) => (
            <button key={u.id} className="row-item" onClick={() => go(u.id)}>
              <UserAvatar user={u} size={42} />
              <div className="row-text">
                <div className="row-title">{u.display_name}</div>
                <div className={`row-sub ${u.online ? 'accent-text' : ''}`}>@{u.username} · {lastSeen(u)}</div>
              </div>
            </button>
          ))
        )}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------ new group */

function NewGroup({ open, onClose, type }: P & { type: 'group' | 'channel' }) {
  const [step, setStep] = useState<1 | 2>(type === 'channel' ? 2 : 1);
  const [members, setMembers] = useState<User[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [isPublic, setPublic] = useState(false);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const noun = type === 'channel' ? 'канал' : 'группу';

  const create = async () => {
    setBusy(true);
    try {
      const res = await api.createGroup({
        type,
        title: title.trim(),
        description,
        member_ids: members.map((m) => m.id),
        avatar_url: avatar,
        is_public: isPublic,
        username: isPublic ? username : null,
      });
      useChats.getState().mergeUsers(res.users);
      useChats.getState().upsertChat(res.chat);
      useChats.getState().openChat(res.chat.id);
      useUI.setState({ tab: 'chats' });
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={step === 1 ? 'Участники' : type === 'channel' ? 'Новый канал' : 'Новая группа'}
      left={step === 2 && type === 'group' ? (
        <button className="icon-btn" onClick={() => setStep(1)}><ChevronLeft size={22} /></button>
      ) : undefined}
      footer={
        step === 1 ? (
          <button className="btn-primary wide" onClick={() => setStep(2)}>
            Далее {members.length > 0 && `· ${members.length}`}
          </button>
        ) : (
          <button className="btn-primary wide" disabled={!title.trim() || busy || (isPublic && username.length < 4)} onClick={() => void create()}>
            {busy ? <Spinner /> : `Создать ${noun}`}
          </button>
        )
      }
    >
      {step === 1 ? (
        <UserPicker selected={members} onChange={setMembers} />
      ) : (
        <div className="form">
          <AvatarUpload url={avatar} name={title} color={type === 'channel' ? 7 : 1} round={false} onChange={setAvatar} />
          <input className="input" autoFocus placeholder={type === 'channel' ? 'Название канала' : 'Название группы'} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={128} />
          <textarea className="input" placeholder="Описание (необязательно)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} />
          <div className="set-group">
            <div className="set-row">
              <span className="set-icon"><Globe size={18} /></span>
              <span className="set-label">Публичный {type === 'channel' ? 'канал' : 'чат'}</span>
              <span className="set-value"><Switch checked={isPublic} onChange={setPublic} /></span>
            </div>
          </div>
          {isPublic && (
            <label className="field prefix">
              <span>noma/</span>
              <input placeholder="ссылка" value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} maxLength={32} />
            </label>
          )}
          <div className="set-hint">
            {isPublic ? 'Публичный чат можно найти через поиск, вступить может любой.' : 'Вступить можно только по приглашению администратора.'}
          </div>
          {members.length > 0 && <div className="set-hint">Участники: {members.map((m) => m.display_name).join(', ')}</div>}
        </div>
      )}
    </Sheet>
  );
}

/* --------------------------------------------------------------- forward */

function ForwardModal({ open, onClose, ids }: P & { ids: number[] }) {
  const chats = useSortedChats();
  const users = useChats((s) => s.users);
  const me = useAuth((s) => s.me!.id);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [comment, setComment] = useState('');
  const writable = chats.filter((c) => c.type !== 'channel' || c.my_role === 'owner' || c.my_role === 'admin');
  const list = writable.filter((c) => chatTitle(c, users, me).toLowerCase().includes(query.toLowerCase()));
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const send = () => {
    void useChats.getState().forward(ids, picked, comment);
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Переслать${ids.length > 1 ? ` · ${ids.length}` : ''}`}
      footer={
        <AnimatePresence>
          {picked.length > 0 && (
            <motion.div className="forward-foot" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <input className="input" placeholder="Добавить комментарий…" value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
              <button className="btn-primary" onClick={send}>Отправить</button>
            </motion.div>
          )}
        </AnimatePresence>
      }
    >
      <div className="search-box inline">
        <Search size={16} />
        <input autoFocus placeholder="Кому переслать?" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="picker-list tall">
        {list.map((c) => {
          const on = picked.includes(c.id);
          return (
            <button key={c.id} className="row-item" onClick={() => toggle(c.id)}>
              <ChatAvatar chat={c} size={42} />
              <div className="row-text">
                <div className="row-title">{chatTitle(c, users, me)}</div>
                <div className="row-sub">{c.type === 'private' ? lastSeen(users[c.member_ids.find((i) => i !== me) ?? 0]) : c.type === 'saved' ? 'ваше облако' : membersLabel(c.member_count, c.type === 'channel')}</div>
              </div>
              <span className={`check ${on ? 'on' : ''}`}>{on && <Check size={14} strokeWidth={3} />}</span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------ add members */

function AddMembers({ open, onClose, chatId }: P & { chatId: number }) {
  const chat = useChats((s) => s.chats[chatId]);
  const [picked, setPicked] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await api.addMembers(chatId, picked.map((u) => u.id));
      toast('Участники добавлены', 'success');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Добавить участников"
      footer={
        <button className="btn-primary wide" disabled={!picked.length || busy} onClick={() => void add()}>
          {busy ? <Spinner /> : `Добавить${picked.length ? ` · ${picked.length}` : ''}`}
        </button>
      }
    >
      <UserPicker selected={picked} onChange={setPicked} exclude={chat?.member_ids ?? []} />
    </Sheet>
  );
}

/* ----------------------------------------------------------- edit profile */

function EditProfile({ open, onClose }: P) {
  const me = useAuth((s) => s.me!);
  const [name, setName] = useState(me.display_name);
  const [username, setUsername] = useState(me.username);
  const [bio, setBio] = useState(me.bio);
  const [avatar, setAvatar] = useState<string | null>(me.avatar_url);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const user = await api.updateMe({
        display_name: name.trim(),
        username,
        bio,
        ...(avatar ? { avatar_url: avatar } : {}),
        ...(avatar === null && me.avatar_url ? { remove_avatar: true } : {}),
      });
      useAuth.getState().setMe(user);
      useChats.getState().mergeUsers([user]);
      toast('Профиль обновлён', 'success');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Профиль"
      footer={
        <button className="btn-primary wide" disabled={busy || !name.trim()} onClick={() => void save()}>
          {busy ? <Spinner /> : 'Сохранить'}
        </button>
      }
    >
      <div className="form">
        <AvatarUpload url={avatar} name={name} color={me.color} onChange={setAvatar} />
        <label className="label">Имя</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
        <label className="label">Имя пользователя</label>
        <label className="field prefix">
          <span>@</span>
          <input value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} maxLength={32} />
        </label>
        <label className="label">О себе</label>
        <textarea className="input" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200} rows={3} placeholder="Пара слов о себе" />
        <div className="set-hint">{200 - bio.length} символов осталось</div>
      </div>
    </Sheet>
  );
}

/* -------------------------------------------------------------- edit chat */

function EditChat({ open, onClose, chatId }: P & { chatId: number }) {
  const chat = useChats((s) => s.chats[chatId]);
  const [title, setTitle] = useState(chat?.title ?? '');
  const [description, setDescription] = useState(chat?.description ?? '');
  const [avatar, setAvatar] = useState<string | null>(chat?.avatar_url ?? null);
  const [isPublic, setPublic] = useState(chat?.is_public ?? false);
  const [username, setUsername] = useState(chat?.username ?? '');
  const [busy, setBusy] = useState(false);
  if (!chat) return null;
  const save = async () => {
    setBusy(true);
    try {
      const updated = await api.updateChat(chat.id, {
        title: title.trim(),
        description,
        ...(avatar && avatar !== chat.avatar_url ? { avatar_url: avatar } : {}),
        ...(avatar === null && chat.avatar_url ? { remove_avatar: true } : {}),
        is_public: isPublic,
        ...(isPublic ? { username } : {}),
      });
      useChats.getState().upsertChat(updated);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={chat.type === 'channel' ? 'Канал' : 'Группа'}
      footer={
        <button className="btn-primary wide" disabled={busy || !title.trim()} onClick={() => void save()}>
          {busy ? <Spinner /> : 'Сохранить'}
        </button>
      }
    >
      <div className="form">
        <AvatarUpload url={avatar} name={title} color={chat.color} round={false} onChange={setAvatar} />
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название" maxLength={128} />
        <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Описание" rows={3} maxLength={500} />
        <div className="set-group">
          <div className="set-row">
            <span className="set-icon"><Globe size={18} /></span>
            <span className="set-label">Публичный</span>
            <span className="set-value"><Switch checked={isPublic} onChange={setPublic} /></span>
          </div>
        </div>
        {isPublic && (
          <label className="field prefix">
            <span>noma/</span>
            <input value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} maxLength={32} placeholder="ссылка" />
          </label>
        )}
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------- user profile */

function UserProfile({ open, onClose, userId }: P & { userId: number }) {
  const user = useChats((s) => s.users[userId]);
  const me = useAuth((s) => s.me!.id);
  useEffect(() => {
    useChats.getState().ensureUsers([userId]);
  }, [userId]);
  const write = async () => {
    onClose();
    useUI.setState({ tab: 'chats' });
    await useChats.getState().openPrivate(userId);
  };
  const call = async (video: boolean) => {
    onClose();
    const chats = useChats.getState().chats;
    let chat = Object.values(chats).find((c) => c.type === 'private' && c.member_ids.includes(userId));
    if (!chat) {
      const res = await api.openPrivate(userId);
      useChats.getState().upsertChat(res.chat);
      chat = res.chat;
    }
    void useCall.getState().start(chat.id, userId, video);
  };
  return (
    <Sheet open={open} onClose={onClose} width={400} className="profile-sheet">
      {!user ? (
        <div className="center-pad"><Spinner /></div>
      ) : (
        <div className="user-profile">
          <div className="user-profile-glow" />
          <UserAvatar user={user} size={112} />
          <div className="user-profile-name">{user.display_name}</div>
          <div className={`user-profile-status ${user.online ? 'accent-text' : ''}`}>{lastSeen(user)}</div>
          {userId !== me && (
            <div className="profile-actions">
              <button onClick={() => void write()}><MessageCircle size={20} /><span>Написать</span></button>
              {!user.is_bot && (
                <>
                  <button onClick={() => void call(false)}><Phone size={20} /><span>Звонок</span></button>
                  <button onClick={() => void call(true)}><Video size={20} /><span>Видео</span></button>
                </>
              )}
            </div>
          )}
          <div className="info-list">
            <div className="info-item"><span className="info-label">Имя пользователя</span><span className="accent-text">@{user.username}</span></div>
            {user.bio && <div className="info-item"><span className="info-label">О себе</span><span>{user.bio}</span></div>}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------- send files */

function SendFiles({ open, onClose, chatId, items: initial }: P & { chatId: number; items: LocalAttachment[] }) {
  const [items, setItems] = useState(initial);
  const [caption, setCaption] = useState('');
  const visual = useMemo(() => items.filter((i) => i.kind === 'photo' || i.kind === 'video'), [items]);
  const others = useMemo(() => items.filter((i) => i.kind !== 'photo' && i.kind !== 'video'), [items]);
  const send = () => {
    const store = useChats.getState();
    if (visual.length) void store.send(chatId, caption, visual);
    if (others.length) void store.send(chatId, visual.length ? '' : caption, others);
    onClose();
  };
  useEffect(() => {
    if (open && !items.length) onClose();
  }, [items, open, onClose]);
  const title = visual.length && !others.length ? (visual.length > 1 ? `${visual.length} медиа` : visual[0].kind === 'video' ? 'Видео' : 'Фото') : `${items.length} файл${items.length > 1 ? 'а' : ''}`;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Отправить · ${title}`}
      footer={
        <div className="forward-foot">
          <input className="input" autoFocus placeholder="Добавить подпись…" value={caption} onChange={(e) => setCaption(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button className="btn-primary" onClick={send}>Отправить</button>
        </div>
      }
    >
      {visual.length > 0 && (
        <div className={`send-grid n${Math.min(visual.length, 3)}`}>
          {visual.map((it) => (
            <div key={it.previewUrl} className="send-tile">
              {it.kind === 'video' ? <video src={it.previewUrl} muted /> : <img src={it.previewUrl} alt="" />}
              {it.kind === 'video' && <span className="duration-badge">{duration(it.duration)}</span>}
              <button className="send-remove" onClick={() => setItems((l) => l.filter((x) => x !== it))}><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
      {others.map((it) => (
        <div key={it.previewUrl} className="file-row standalone">
          <div className="file-icon"><FileText size={20} className="file-icon-glyph" /></div>
          <div className="file-info">
            <div className="file-name ellipsis">{it.name}</div>
            <div className="file-size">{fileSize(it.file.size)}</div>
          </div>
          <button className="icon-btn small" onClick={() => setItems((l) => l.filter((x) => x !== it))}><X size={16} /></button>
        </div>
      ))}
    </Sheet>
  );
}
