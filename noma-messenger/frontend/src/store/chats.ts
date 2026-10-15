import { create } from 'zustand';
import { api } from '../api/client';
import type { Attachment, Chat, Message, ReplyPreview, ServerEvent, TypingAction, User } from '../api/types';
import { messagePreview } from '../lib/format';
import type { LocalAttachment } from '../lib/media';
import { socket } from '../lib/socket';
import { sounds } from '../lib/sounds';
import { useAuth, myId } from './auth';
import { useSettings } from './settings';
import { toast, useUI } from './ui';

export interface TypingEntry {
  action: TypingAction;
  at: number;
}

interface PendingSend {
  chatId: number;
  text: string;
  attachments: LocalAttachment[];
  replyToId: number | null;
}

interface ChatsState {
  users: Record<number, User>;
  chats: Record<number, Chat>;
  loaded: boolean;
  activeId: number | null;
  messages: Record<number, Message[]>;
  hasMore: Record<number, boolean>;
  loading: Record<number, boolean>;
  typing: Record<number, Record<number, TypingEntry>>;
  drafts: Record<number, string>;
  reply: Record<number, Message | null>;
  editing: Record<number, Message | null>;
  selection: number[];
  flash: { id: number; at: number } | null;
  pulse: number;
  atBottom: boolean;

  mergeUsers: (users: User[]) => void;
  ensureUsers: (ids: number[]) => void;
  upsertChat: (chat: Chat) => void;
  loadChats: () => Promise<void>;
  openChat: (id: number | null) => void;
  openPrivate: (userId: number) => Promise<void>;
  previewChat: (chat: Chat) => void;
  joinChat: (chatId: number) => Promise<void>;
  loadMessages: (chatId: number, older?: boolean) => Promise<void>;
  catchUp: () => Promise<void>;
  jumpTo: (chatId: number, messageId: number) => Promise<void>;
  send: (chatId: number, text: string, attachments?: LocalAttachment[]) => Promise<void>;
  retry: (clientId: string) => Promise<void>;
  edit: (chatId: number, messageId: number, text: string) => Promise<void>;
  remove: (chatId: number, ids: number[]) => Promise<void>;
  react: (message: Message, emoji: string) => Promise<void>;
  forward: (ids: number[], chatIds: number[], comment?: string) => Promise<void>;
  pin: (chatId: number, messageId: number | null) => Promise<void>;
  markRead: (chatId: number) => void;
  setDraft: (chatId: number, text: string) => void;
  setReply: (chatId: number, m: Message | null) => void;
  setEditing: (chatId: number, m: Message | null) => void;
  toggleSelect: (id: number) => void;
  clearSelection: () => void;
  updateSettings: (chatId: number, patch: { pinned?: boolean; muted?: boolean; archived?: boolean }) => Promise<void>;
  deleteChat: (chatId: number) => Promise<void>;
  sendTyping: (chatId: number, action: TypingAction) => void;
  handleEvent: (ev: ServerEvent) => void;
}

const TEMP_BASE = 1e12;
let tempSeq = 1;
const pending = new Map<string, PendingSend>();
/** server url → local object url, so freshly sent media never flickers */
export const localPreview = new Map<string, string>();
const readTimers: Record<number, number> = {};
const typingSent: Record<string, number> = {};
const userFetches = new Set<number>();
let connectedOnce = false;

export const isTemp = (id: number) => id >= TEMP_BASE;
const uid = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 24);

export function toReplyPreview(m: Message): ReplyPreview {
  const first = m.attachments[0];
  return {
    id: m.id,
    sender_id: m.sender_id,
    text: m.text.slice(0, 160),
    kind: first?.kind ?? null,
    thumb: first?.kind === 'photo' ? first.url : first?.thumb ?? null,
    deleted: false,
  };
}

function upsertMessage(list: Message[] | undefined, msg: Message): Message[] | undefined {
  if (!list) return list;
  const idx = list.findIndex((m) => m.id === msg.id || (msg.client_id && m.client_id === msg.client_id));
  if (idx !== -1) {
    const next = list.slice();
    next[idx] = msg;
    return next.sort((a, b) => a.id - b.id);
  }
  const next = [...list, msg];
  // keep optimistic messages at the tail
  return next.sort((a, b) => a.id - b.id);
}

function lastReal(list: Message[] | undefined): Message | undefined {
  if (!list) return undefined;
  for (let i = list.length - 1; i >= 0; i--) if (!isTemp(list[i].id)) return list[i];
  return undefined;
}

export const useChats = create<ChatsState>((set, get) => {
  const patchChat = (chatId: number, patch: Partial<Chat> | ((c: Chat) => Partial<Chat>)) => {
    const chat = get().chats[chatId];
    if (!chat) return;
    const delta = typeof patch === 'function' ? patch(chat) : patch;
    set({ chats: { ...get().chats, [chatId]: { ...chat, ...delta } } });
  };

  const patchMessage = (chatId: number, match: (m: Message) => boolean, patch: Partial<Message>) => {
    const list = get().messages[chatId];
    if (!list) return;
    set({ messages: { ...get().messages, [chatId]: list.map((m) => (match(m) ? { ...m, ...patch } : m)) } });
  };

  const applyMessage = (msg: Message) => {
    const s = get();
    const chat = s.chats[msg.chat_id];
    const messages = upsertMessage(s.messages[msg.chat_id], msg);
    const update: Partial<ChatsState> = {};
    if (messages) update.messages = { ...s.messages, [msg.chat_id]: messages };
    if (chat) {
      const last = chat.last_message;
      const replacesLast = last && (last.id === msg.id || (msg.client_id && last.client_id === msg.client_id));
      if (!last || replacesLast || msg.id >= last.id || isTemp(last.id)) {
        update.chats = { ...s.chats, [msg.chat_id]: { ...chat, last_message: msg } };
      }
    }
    set(update);
  };

  async function doSend(clientId: string) {
    const job = pending.get(clientId);
    if (!job) return;
    const { chatId } = job;
    const match = (m: Message) => m.client_id === clientId;
    patchMessage(chatId, match, { status: 'sending' });
    try {
      const uploaded: Attachment[] = [];
      if (job.attachments.length) {
        get().sendTyping(chatId, 'uploading');
        const total = job.attachments.reduce((n, a) => n + a.file.size + (a.thumbBlob?.size ?? 0), 0) || 1;
        let done = 0;
        for (const a of job.attachments) {
          const res = await api.upload(a.file, a.name, (p) =>
            patchMessage(chatId, match, { progress: Math.min(0.99, (done + p * a.file.size) / total) }),
          );
          done += a.file.size;
          let thumb: string | undefined;
          if (a.thumbBlob) {
            thumb = (await api.upload(a.thumbBlob, 'thumb.jpg')).url;
            done += a.thumbBlob.size;
          }
          localPreview.set(res.url, a.previewUrl);
          uploaded.push({
            kind: a.kind,
            url: res.url,
            name: a.name,
            size: res.size,
            mime: res.mime,
            width: a.width,
            height: a.height,
            duration: a.duration,
            waveform: a.waveform,
            thumb,
          });
        }
        get().sendTyping(chatId, 'cancel');
      }
      const msg = await api.sendMessage(chatId, {
        text: job.text,
        reply_to_id: job.replyToId,
        attachments: uploaded,
        client_id: clientId,
      });
      pending.delete(clientId);
      applyMessage(msg);
    } catch (e) {
      patchMessage(chatId, match, { status: 'failed', progress: undefined });
      toast((e as Error).message || 'Не удалось отправить', 'error');
    }
  }

  return {
    users: {},
    chats: {},
    loaded: false,
    activeId: null,
    messages: {},
    hasMore: {},
    loading: {},
    typing: {},
    drafts: JSON.parse(localStorage.getItem('noma.drafts') ?? '{}'),
    reply: {},
    editing: {},
    selection: [],
    flash: null,
    pulse: 0,
    atBottom: true,

    mergeUsers(users) {
      if (!users.length) return;
      const next = { ...get().users };
      for (const u of users) next[u.id] = { ...next[u.id], ...u };
      set({ users: next });
      const me = useAuth.getState().me;
      const fresh = me && users.find((u) => u.id === me.id);
      if (fresh) useAuth.getState().setMe({ ...me, ...fresh });
    },

    ensureUsers(ids) {
      const missing = ids.filter((id) => id && !get().users[id] && !userFetches.has(id));
      if (!missing.length) return;
      missing.forEach((id) => userFetches.add(id));
      api
        .usersBatch(missing)
        .then((users) => get().mergeUsers(users))
        .finally(() => missing.forEach((id) => userFetches.delete(id)));
    },

    upsertChat(chat) {
      set({ chats: { ...get().chats, [chat.id]: chat } });
    },

    async loadChats() {
      const res = await api.chats();
      get().mergeUsers(res.users);
      const chats: Record<number, Chat> = {};
      for (const c of res.chats) chats[c.id] = c;
      // keep public previews that are currently open
      const active = get().activeId;
      if (active && !chats[active] && get().chats[active]) chats[active] = get().chats[active];
      set({ chats, loaded: true });
    },

    openChat(id) {
      const prev = get().activeId;
      if (prev === id) return;
      set({ activeId: id, selection: [], atBottom: true });
      useUI.setState({ chatSearch: false, menu: null });
      if (id !== null && !get().messages[id]) void get().loadMessages(id);
      if (prev) {
        const prevChat = get().chats[prev];
        // drop previews of public chats we never joined
        if (prevChat && prevChat.my_role === null) {
          const chats = { ...get().chats };
          delete chats[prev];
          const messages = { ...get().messages };
          delete messages[prev];
          set({ chats, messages });
        }
      }
    },

    async openPrivate(userId) {
      const existing = Object.values(get().chats).find(
        (c) => (c.type === 'private' && c.member_ids.includes(userId) && userId !== myId()) || (c.type === 'saved' && userId === myId()),
      );
      if (existing) {
        get().openChat(existing.id);
        return;
      }
      const res = await api.openPrivate(userId);
      get().mergeUsers(res.users);
      get().upsertChat(res.chat);
      get().openChat(res.chat.id);
    },

    previewChat(chat) {
      if (!get().chats[chat.id]) get().upsertChat(chat);
      get().openChat(chat.id);
    },

    async joinChat(chatId) {
      const res = await api.joinChat(chatId);
      get().mergeUsers(res.users);
      get().upsertChat(res.chat);
      toast(res.chat.type === 'channel' ? 'Вы подписались на канал' : 'Вы вступили в группу', 'success');
    },

    async loadMessages(chatId, older = false) {
      const s = get();
      if (s.loading[chatId]) return;
      if (older && !s.hasMore[chatId]) return;
      set({ loading: { ...s.loading, [chatId]: true } });
      try {
        const list = s.messages[chatId];
        const before = older && list?.length ? list.find((m) => !isTemp(m.id))?.id : undefined;
        const res = await api.messages(chatId, { before, limit: older ? 60 : 50 });
        const cur = get().messages[chatId] ?? [];
        const ids = new Set(cur.map((m) => m.id));
        const merged = older ? [...res.messages.filter((m) => !ids.has(m.id)), ...cur] : mergeLatest(cur, res.messages);
        set({
          messages: { ...get().messages, [chatId]: merged },
          hasMore: { ...get().hasMore, [chatId]: older ? !!res.has_more : res.has_more ?? false },
        });
        const senders = res.messages.flatMap((m) => [m.sender_id, m.forward?.user_id ?? 0, m.reply_to?.sender_id ?? 0]);
        get().ensureUsers(senders);
      } catch (e) {
        toast((e as Error).message, 'error');
      } finally {
        set({ loading: { ...get().loading, [chatId]: false } });
      }
    },

    async catchUp() {
      try {
        await get().loadChats();
      } catch {
        return;
      }
      const active = get().activeId;
      const keep: Record<number, Message[]> = {};
      if (active && get().messages[active]) {
        keep[active] = get().messages[active];
      }
      set({ messages: keep });
      if (active) await get().loadMessages(active);
    },

    async jumpTo(chatId, messageId) {
      if (get().activeId !== chatId) get().openChat(chatId);
      const list = get().messages[chatId];
      if (!list?.some((m) => m.id === messageId)) {
        try {
          const res = await api.messages(chatId, { since_id: messageId });
          const pendingTail = (get().messages[chatId] ?? []).filter((m) => isTemp(m.id));
          set({
            messages: { ...get().messages, [chatId]: [...res.messages, ...pendingTail] },
            hasMore: { ...get().hasMore, [chatId]: !!res.has_more },
          });
          get().ensureUsers(res.messages.map((m) => m.sender_id));
        } catch (e) {
          toast((e as Error).message, 'error');
          return;
        }
      }
      set({ flash: { id: messageId, at: Date.now() } });
    },

    async send(chatId, text, attachments = []) {
      const me = myId();
      const clientId = uid();
      const reply = get().reply[chatId] ?? null;
      const optimistic: Message = {
        id: TEMP_BASE + tempSeq++,
        chat_id: chatId,
        sender_id: me,
        type: 'text',
        text: text.trim(),
        attachments: attachments.map((a) => ({
          kind: a.kind,
          url: a.previewUrl,
          name: a.name,
          size: a.file.size,
          mime: a.file.type,
          width: a.width,
          height: a.height,
          duration: a.duration,
          waveform: a.waveform,
        })),
        reply_to: reply ? toReplyPreview(reply) : null,
        forward: null,
        call: null,
        reactions: [],
        edited_at: null,
        created_at: new Date().toISOString(),
        client_id: clientId,
        status: 'sending',
        progress: attachments.length ? 0 : undefined,
      };
      pending.set(clientId, { chatId, text: text.trim(), attachments, replyToId: reply?.id ?? null });
      if (!get().messages[chatId]) set({ messages: { ...get().messages, [chatId]: [] } });
      applyMessage(optimistic);
      set({ reply: { ...get().reply, [chatId]: null } });
      get().setDraft(chatId, '');
      sounds.sent();
      await doSend(clientId);
    },

    retry: (clientId) => doSend(clientId),

    async edit(chatId, messageId, text) {
      const list = get().messages[chatId];
      const original = list?.find((m) => m.id === messageId);
      patchMessage(chatId, (m) => m.id === messageId, { text, edited_at: new Date().toISOString() });
      try {
        const msg = await api.editMessage(messageId, text);
        applyMessage(msg);
      } catch (e) {
        if (original) applyMessage(original);
        toast((e as Error).message, 'error');
      }
    },

    async remove(chatId, ids) {
      const temps = ids.filter(isTemp);
      const real = ids.filter((id) => !isTemp(id));
      const list = get().messages[chatId];
      if (list) {
        for (const m of list) if (temps.includes(m.id) && m.client_id) pending.delete(m.client_id);
        set({ messages: { ...get().messages, [chatId]: list.filter((m) => !ids.includes(m.id)) } });
      }
      set({ selection: [] });
      if (!real.length) return;
      try {
        await api.deleteMessages(real);
      } catch (e) {
        toast((e as Error).message, 'error');
        void get().loadMessages(chatId);
      }
    },

    async react(message, emoji) {
      if (isTemp(message.id)) return;
      const me = myId();
      const prev = message.reactions.find((r) => r.user_ids.includes(me));
      let reactions = message.reactions
        .map((r) => (r.user_ids.includes(me) ? { ...r, count: r.count - 1, user_ids: r.user_ids.filter((u) => u !== me) } : r))
        .filter((r) => r.count > 0);
      if (prev?.emoji !== emoji) {
        const existing = reactions.find((r) => r.emoji === emoji);
        reactions = existing
          ? reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, user_ids: [...r.user_ids, me] } : r))
          : [...reactions, { emoji, count: 1, user_ids: [me] }];
        sounds.reaction();
      }
      patchMessage(message.chat_id, (m) => m.id === message.id, { reactions });
      try {
        const res = await api.react(message.id, emoji);
        patchMessage(message.chat_id, (m) => m.id === message.id, { reactions: res.reactions });
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    },

    async forward(ids, chatIds, comment = '') {
      try {
        await api.forward(ids, chatIds, comment);
        set({ selection: [] });
        toast(chatIds.length > 1 ? `Переслано в ${chatIds.length} чата` : 'Сообщение переслано', 'success');
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    },

    async pin(chatId, messageId) {
      try {
        const res = await api.pin(chatId, messageId);
        patchChat(chatId, { pinned_message: res.message });
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    },

    markRead(chatId) {
      const chat = get().chats[chatId];
      if (!chat || chat.my_role === null) return;
      const last = lastReal(get().messages[chatId]) ?? chat.last_message ?? undefined;
      if (!last || isTemp(last.id) || last.id <= chat.last_read_id) {
        if (chat.unread_count) patchChat(chatId, { unread_count: 0 });
        return;
      }
      patchChat(chatId, { last_read_id: last.id, unread_count: 0 });
      window.clearTimeout(readTimers[chatId]);
      readTimers[chatId] = window.setTimeout(() => {
        api.markRead(chatId, last.id).catch(() => undefined);
      }, 250);
    },

    setDraft(chatId, text) {
      const drafts = { ...get().drafts };
      if (text.trim()) drafts[chatId] = text;
      else delete drafts[chatId];
      set({ drafts });
      try {
        localStorage.setItem('noma.drafts', JSON.stringify(drafts));
      } catch {
        /* quota */
      }
    },
    setReply: (chatId, m) => set({ reply: { ...get().reply, [chatId]: m }, editing: { ...get().editing, [chatId]: null } }),
    setEditing: (chatId, m) => set({ editing: { ...get().editing, [chatId]: m }, reply: { ...get().reply, [chatId]: null } }),
    toggleSelect(id) {
      const sel = get().selection;
      set({ selection: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id] });
    },
    clearSelection: () => set({ selection: [] }),

    async updateSettings(chatId, patch) {
      patchChat(chatId, patch);
      try {
        await api.chatSettings(chatId, patch);
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    },

    async deleteChat(chatId) {
      try {
        await api.deleteChat(chatId);
        removeChatLocally(chatId);
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    },

    sendTyping(chatId, action) {
      const key = `${chatId}:${action}`;
      const now = Date.now();
      if (action !== 'cancel' && now - (typingSent[key] ?? 0) < 2800) return;
      typingSent[key] = action === 'cancel' ? 0 : now;
      if (action === 'cancel') Object.keys(typingSent).forEach((k) => k.startsWith(`${chatId}:`) && (typingSent[k] = 0));
      socket.send({ type: 'typing', chat_id: chatId, action });
    },

    handleEvent(ev) {
      const s = get();
      const me = myId();
      switch (ev.type) {
        case 'hello':
          if (connectedOnce) void get().catchUp();
          connectedOnce = true;
          break;
        case 'message.new': {
          const msg = ev.message;
          if (!s.chats[msg.chat_id]) {
            api
              .chat(msg.chat_id)
              .then((res) => {
                get().mergeUsers(res.users);
                get().upsertChat(res.chat);
                notifyIncoming(msg);
              })
              .catch(() => undefined);
            return;
          }
          get().ensureUsers([msg.sender_id, msg.forward?.user_id ?? 0]);
          applyMessage(msg);
          if (msg.sender_id !== me) {
            const typing = { ...get().typing };
            if (typing[msg.chat_id]?.[msg.sender_id]) {
              const t = { ...typing[msg.chat_id] };
              delete t[msg.sender_id];
              typing[msg.chat_id] = t;
              set({ typing });
            }
            const visible = get().activeId === msg.chat_id && !document.hidden;
            if (visible) set({ pulse: get().pulse + 1 });
            if (visible && get().atBottom) {
              get().markRead(msg.chat_id);
            } else if (msg.id > (get().chats[msg.chat_id]?.last_read_id ?? 0)) {
              patchChat(msg.chat_id, (c) => ({ unread_count: c.unread_count + 1 }));
            }
            notifyIncoming(msg);
          }
          break;
        }
        case 'message.edit': {
          const msg = ev.message;
          applyMessage(msg);
          const chat = get().chats[msg.chat_id];
          if (chat?.pinned_message?.id === msg.id) patchChat(msg.chat_id, { pinned_message: msg });
          break;
        }
        case 'message.delete': {
          const list = s.messages[ev.chat_id];
          if (list) set({ messages: { ...s.messages, [ev.chat_id]: list.filter((m) => !ev.message_ids.includes(m.id)) } });
          patchChat(ev.chat_id, (c) => ({
            last_message: ev.last_message,
            pinned_message: c.pinned_message && ev.message_ids.includes(c.pinned_message.id) ? null : c.pinned_message,
          }));
          break;
        }
        case 'message.reactions': {
          patchMessage(ev.chat_id, (m) => m.id === ev.message_id, { reactions: ev.reactions });
          patchChat(ev.chat_id, (c) =>
            c.last_message?.id === ev.message_id ? { last_message: { ...c.last_message, reactions: ev.reactions } } : {},
          );
          const added = ev.reactions.some((r) => r.emoji === ev.emoji && r.user_ids.includes(ev.actor_id));
          if (ev.sender_id === me && ev.actor_id !== me && added) {
            const chat = get().chats[ev.chat_id];
            const actor = get().users[ev.actor_id];
            if (chat && !chat.muted && (get().activeId !== ev.chat_id || document.hidden)) {
              useUI.getState().pushNotice({
                chatId: ev.chat_id,
                title: actor?.display_name ?? 'Реакция',
                text: `${ev.emoji} отреагировал(а) на ваше сообщение`,
                avatar: { url: actor?.avatar_url ?? null, color: actor?.color ?? 0, name: actor?.display_name ?? '?', round: true },
              });
              sounds.reaction();
            }
          }
          break;
        }
        case 'chat.new':
        case 'chat.update':
          get().mergeUsers(ev.users);
          get().upsertChat(ev.chat);
          break;
        case 'chat.removed':
          if (s.chats[ev.chat_id]) {
            if (s.activeId === ev.chat_id) toast('Чат больше недоступен');
            removeChatLocally(ev.chat_id);
          }
          break;
        case 'chat.read':
          if (ev.user_id === me) {
            patchChat(ev.chat_id, (c) => ({
              last_read_id: Math.max(c.last_read_id, ev.last_read_id),
              unread_count: c.last_message && ev.last_read_id >= c.last_message.id ? 0 : c.unread_count,
            }));
          } else {
            patchChat(ev.chat_id, (c) => ({ peer_read_id: Math.max(c.peer_read_id, ev.last_read_id) }));
          }
          break;
        case 'chat.pinned':
          patchChat(ev.chat_id, { pinned_message: ev.message });
          break;
        case 'chat.settings':
          patchChat(ev.chat_id, { pinned: ev.pinned, muted: ev.muted, archived: ev.archived });
          break;
        case 'typing': {
          const typing = { ...s.typing };
          const forChat = { ...(typing[ev.chat_id] ?? {}) };
          if (ev.action === 'cancel') delete forChat[ev.user_id];
          else forChat[ev.user_id] = { action: ev.action, at: Date.now() };
          typing[ev.chat_id] = forChat;
          set({ typing });
          get().ensureUsers([ev.user_id]);
          break;
        }
        case 'presence': {
          const u = s.users[ev.user_id];
          if (u) set({ users: { ...s.users, [ev.user_id]: { ...u, online: ev.online, last_seen: ev.last_seen } } });
          break;
        }
        case 'user.update':
          get().mergeUsers([ev.user]);
          break;
        default:
          break;
      }
    },
  };
});

function mergeLatest(current: Message[], latest: Message[]): Message[] {
  if (!current.length) return latest;
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of latest) byId.set(m.id, m);
  const fresh = new Set(latest.map((m) => m.client_id).filter(Boolean));
  return [...byId.values()].filter((m) => !(isTemp(m.id) && m.client_id && fresh.has(m.client_id))).sort((a, b) => a.id - b.id);
}

function removeChatLocally(chatId: number) {
  const s = useChats.getState();
  const chats = { ...s.chats };
  delete chats[chatId];
  const messages = { ...s.messages };
  delete messages[chatId];
  useChats.setState({ chats, messages, activeId: s.activeId === chatId ? null : s.activeId });
  if (s.activeId === chatId) useUI.setState({ infoOpen: false });
}

export function chatTitle(chat: Chat | undefined, users: Record<number, User>, me: number): string {
  if (!chat) return '';
  if (chat.type === 'saved') return 'Избранное';
  if (chat.type === 'private') {
    const peer = users[chat.member_ids.find((id) => id !== me) ?? 0];
    return peer?.display_name ?? 'Пользователь';
  }
  return chat.title;
}

export function chatPeer(chat: Chat | undefined, users: Record<number, User>, me: number): User | undefined {
  if (!chat || chat.type !== 'private') return undefined;
  return users[chat.member_ids.find((id) => id !== me) ?? 0];
}

function notifyIncoming(msg: Message) {
  const s = useChats.getState();
  const chat = s.chats[msg.chat_id];
  if (!chat || chat.muted || msg.type === 'system') return;
  const active = s.activeId === msg.chat_id && !document.hidden;
  if (active) return;
  const me = myId();
  const sender = s.users[msg.sender_id];
  const title = chatTitle(chat, s.users, me);
  const prefix = chat.type === 'group' && sender ? `${sender.display_name}: ` : '';
  const text = prefix + messagePreview(msg);
  const isPerson = chat.type === 'private';
  useUI.getState().pushNotice({
    chatId: chat.id,
    title,
    text,
    avatar: {
      url: isPerson ? sender?.avatar_url ?? null : chat.avatar_url,
      color: isPerson ? sender?.color ?? 0 : chat.color,
      name: title,
      round: isPerson,
    },
  });
  sounds.incoming();
  if (document.hidden && useSettings.getState().notifications && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(title, { body: text, icon: '/favicon.svg', tag: `chat-${chat.id}`, silent: true });
      n.onclick = () => {
        window.focus();
        useChats.getState().openChat(chat.id);
        n.close();
      };
    } catch {
      /* some browsers need a service worker */
    }
  }
}

// expire stale typing indicators
window.setInterval(() => {
  const { typing } = useChats.getState();
  const now = Date.now();
  let changed = false;
  const next: typeof typing = {};
  for (const [chatId, entries] of Object.entries(typing)) {
    const kept: Record<number, TypingEntry> = {};
    for (const [uid, e] of Object.entries(entries)) {
      if (now - e.at < 6000) kept[Number(uid)] = e;
      else changed = true;
    }
    next[Number(chatId)] = kept;
  }
  if (changed) useChats.setState({ typing: next });
}, 1000);
