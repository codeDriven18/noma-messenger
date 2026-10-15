import { AnimatePresence, motion } from 'framer-motion';
import { Bell, BellOff, Pin, Search, Upload, X } from 'lucide-react';
import { type DragEvent, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { Chat, Message } from '../../api/types';
import { messagePreview, shortStamp } from '../../lib/format';
import { RichText } from '../../lib/markup';
import { prepareFiles } from '../../lib/media';
import { useChats } from '../../store/chats';
import { toast, useUI } from '../../store/ui';
import { Composer } from '../composer/Composer';
import { UserAvatar } from '../ui/Avatar';
import { Spinner } from '../ui/primitives';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';

/** Publishes the height of an overlay bar as a CSS variable on the chat view. */
function useHeightVar(ref: RefObject<HTMLElement>, root: RefObject<HTMLElement>, name: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    const host = root.current;
    if (!el || !host) return;
    const apply = () => host.style.setProperty(name, `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, root, name]);
}

export function ChatView({ chatId }: { chatId: number }) {
  const chat = useChats((s) => s.chats[chatId]);
  const searching = useUI((s) => s.chatSearch);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const viewRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  useHeightVar(topRef, viewRef, '--top-h');
  useHeightVar(bottomRef, viewRef, '--bottom-h');

  if (!chat) return null;
  const member = chat.my_role !== null;
  const canPost = member && (chat.type !== 'channel' || chat.my_role === 'owner' || chat.my_role === 'admin');

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!canPost) return;
    const files = Array.from(e.dataTransfer.files).slice(0, 10);
    if (!files.length) return;
    const items = await prepareFiles(files);
    useUI.getState().openModal({ kind: 'sendFiles', chatId, items });
  };

  return (
    <motion.div
      ref={viewRef}
      className="chat-view"
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 38 }}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files') || !canPost) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragLeave={() => {
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDragOver={(e) => canPost && e.preventDefault()}
      onDrop={(e) => void onDrop(e)}
    >
      <MessageList key={chat.id} chat={chat} readOnly={!canPost} />
      <div className="chat-top" ref={topRef}>
        <ChatHeader chat={chat} />
        <AnimatePresence>{searching && <ChatSearch key="search" chat={chat} />}</AnimatePresence>
        <AnimatePresence>{chat.pinned_message && !searching && <PinnedBar key="pin" chat={chat} message={chat.pinned_message} />}</AnimatePresence>
      </div>
      <div className="chat-bottom" ref={bottomRef}>
        {canPost ? <Composer chat={chat} /> : !member ? <JoinBar chat={chat} /> : <ChannelBar chat={chat} />}
      </div>
      <AnimatePresence>
        {dragging && (
          <motion.div className="drop-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="drop-card" initial={{ scale: 0.9 }} animate={{ scale: 1 }}>
              <Upload size={36} />
              <div>Отпустите, чтобы отправить</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function PinnedBar({ chat, message }: { chat: Chat; message: Message }) {
  const canUnpin = chat.type === 'private' || chat.type === 'saved' || chat.my_role === 'owner' || chat.my_role === 'admin';
  return (
    <motion.div className="pinned-bar" initial={{ height: 0, opacity: 0 }} animate={{ height: 52, opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
      <button className="pinned-main" onClick={() => void useChats.getState().jumpTo(chat.id, message.id)}>
        <span className="pinned-line" />
        <div className="pinned-text">
          <div className="pinned-title">
            <Pin size={12} /> Закреплённое сообщение
          </div>
          <div className="pinned-body ellipsis">{messagePreview(message)}</div>
        </div>
      </button>
      {canUnpin && (
        <button className="icon-btn small" onClick={() => void useChats.getState().pin(chat.id, null)} title="Открепить">
          <X size={16} />
        </button>
      )}
    </motion.div>
  );
}

function ChatSearch({ chat }: { chat: Chat }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Message[] | null>(null);
  const users = useChats((s) => s.users);
  const close = () => useUI.getState().setChatSearch(false);

  useEffect(() => {
    if (!q.trim()) {
      setResults(null);
      return;
    }
    let alive = true;
    const t = window.setTimeout(() => {
      api
        .searchMessages(chat.id, q.trim())
        .then((r) => alive && setResults(r))
        .catch(() => alive && setResults([]));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q, chat.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <motion.div className="chat-search" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
      <div className="search-box inline">
        <Search size={17} />
        <input autoFocus placeholder="Поиск по сообщениям" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="search-clear" onClick={close}>
          <X size={14} />
        </button>
      </div>
      {q.trim() && (
        <div className="chat-search-results">
          {results === null ? (
            <div className="center-pad small">
              <Spinner size={18} />
            </div>
          ) : results.length === 0 ? (
            <div className="muted-center">Ничего не найдено</div>
          ) : (
            results.map((m) => (
              <button
                key={m.id}
                className="row-item"
                onClick={() => {
                  void useChats.getState().jumpTo(chat.id, m.id);
                  close();
                }}
              >
                <UserAvatar user={users[m.sender_id]} size={36} />
                <div className="row-text">
                  <div className="row-title">
                    {users[m.sender_id]?.display_name ?? '…'} <span className="row-time">{shortStamp(m.created_at)}</span>
                  </div>
                  <div className="row-sub ellipsis">
                    <RichText text={m.text.slice(0, 140)} highlight={q.trim()} />
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </motion.div>
  );
}

function JoinBar({ chat }: { chat: Chat }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="bottom-bar">
      <motion.button
        className="btn-primary wide"
        whileTap={{ scale: 0.97 }}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await useChats.getState().joinChat(chat.id);
          } catch (e) {
            toast((e as Error).message, 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner /> : chat.type === 'channel' ? 'Подписаться' : 'Вступить в группу'}
      </motion.button>
    </div>
  );
}

function ChannelBar({ chat }: { chat: Chat }) {
  return (
    <div className="bottom-bar">
      <motion.button
        className="btn-ghost wide"
        whileTap={{ scale: 0.97 }}
        onClick={() => void useChats.getState().updateSettings(chat.id, { muted: !chat.muted })}
      >
        {chat.muted ? <Bell size={18} /> : <BellOff size={18} />}
        {chat.muted ? 'Включить уведомления' : 'Выключить уведомления'}
      </motion.button>
    </div>
  );
}
