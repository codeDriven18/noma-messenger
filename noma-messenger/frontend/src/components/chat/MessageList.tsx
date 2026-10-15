import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown } from 'lucide-react';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Chat, Message } from '../../api/types';
import { dayKey, dayLabel } from '../../lib/format';
import { useAuth } from '../../store/auth';
import { isTemp, useChats } from '../../store/chats';
import { MessageRow } from '../message/MessageRow';
import { Spinner } from '../ui/primitives';

const GROUP_GAP = 5 * 60 * 1000;

function canGroup(a: Message | undefined, b: Message | undefined) {
  if (!a || !b) return false;
  if (a.sender_id !== b.sender_id || a.type === 'system' || b.type === 'system') return false;
  if (dayKey(a.created_at) !== dayKey(b.created_at)) return false;
  return Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) < GROUP_GAP;
}

export function MessageList({ chat, readOnly }: { chat: Chat; readOnly: boolean }) {
  const messages = useChats((s) => s.messages[chat.id]);
  const hasMore = useChats((s) => s.hasMore[chat.id]);
  const loading = useChats((s) => s.loading[chat.id]);
  const users = useChats((s) => s.users);
  const selection = useChats((s) => s.selection);
  const flash = useChats((s) => s.flash);
  const me = useAuth((s) => s.me!.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fab, setFab] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [, force] = useState(0);

  const mountMax = useRef<number | null>(null);
  const unreadFrom = useRef<number>(chat.unread_count > 0 ? chat.last_read_id : -1);
  const initial = useRef(false);
  const prevFirst = useRef<number | null>(null);
  const prevLastKey = useRef<string | null>(null);
  const prevHeight = useRef(0);
  const atBottom = useRef(true);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !messages) return;
    if (!initial.current) {
      if (!messages.length && loading) return;
      initial.current = true;
      mountMax.current = messages.reduce((m, x) => (isTemp(x.id) ? m : Math.max(m, x.id)), 0);
      const sep = el.querySelector<HTMLElement>('.unread-sep');
      el.scrollTop = sep ? sep.offsetTop - 90 : el.scrollHeight;
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
      if (atBottom.current) useChats.getState().markRead(chat.id);
      requestAnimationFrame(() => markStuckPills(el));
      force((n) => n + 1);
    } else {
      const first = messages[0]?.id ?? null;
      if (prevFirst.current !== null && first !== null && first < prevFirst.current) {
        el.scrollTop += el.scrollHeight - prevHeight.current;
      }
      const last = messages[messages.length - 1];
      const key = last ? last.client_id ?? `id${last.id}` : null;
      if (last && key !== prevLastKey.current) {
        if (last.sender_id === me || atBottom.current) requestAnimationFrame(() => scrollToBottom(true));
        else setNewCount((n) => n + 1);
      }
    }
    prevFirst.current = messages[0]?.id ?? null;
    const last = messages[messages.length - 1];
    prevLastKey.current = last ? last.client_id ?? `id${last.id}` : null;
    prevHeight.current = el.scrollHeight;
  }, [messages, loading, me, chat.id, scrollToBottom]);

  // keep the view pinned to the bottom while media / fonts settle
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const inner = el.firstElementChild;
    if (!inner) return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
      prevHeight.current = el.scrollHeight;
    });
    ro.observe(inner);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!flash) return;
    const el = scrollRef.current?.querySelector(`[data-mid="${flash.id}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = window.setTimeout(() => force((n) => n + 1), 2100);
    return () => window.clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    const onFocus = () => atBottom.current && useChats.getState().markRead(chat.id);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [chat.id]);

  const scrollIdle = useRef<number | undefined>(undefined);
  const markStuckPills = (el: HTMLElement) => {
    el.querySelectorAll<HTMLElement>('.day-pill-wrap').forEach((wrap) => {
      const section = wrap.parentElement!.getBoundingClientRect().top;
      wrap.classList.toggle('stuck', wrap.getBoundingClientRect().top - section > 2);
    });
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.classList.add('scrolling');
    window.clearTimeout(scrollIdle.current);
    scrollIdle.current = window.setTimeout(() => el.classList.remove('scrolling'), 1100);
    markStuckPills(el);
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const bottom = dist < 140;
    if (bottom !== atBottom.current) {
      atBottom.current = bottom;
      useChats.setState({ atBottom: bottom });
    }
    if (bottom) {
      if (newCount) setNewCount(0);
      if (!document.hidden) useChats.getState().markRead(chat.id);
    }
    setFab(dist > 480);
    if (el.scrollTop < 500 && hasMore && !loading) void useChats.getState().loadMessages(chat.id, true);
    prevHeight.current = el.scrollHeight;
  };

  const rendered = useMemo(() => {
    if (!messages) return null;
    const days: { key: string; date: string; items: JSX.Element[] }[] = [];
    let sepPlaced = false;
    messages.forEach((m, i) => {
      const dk = dayKey(m.created_at);
      if (days[days.length - 1]?.key !== dk) days.push({ key: dk, date: m.created_at, items: [] });
      const dayItems = days[days.length - 1].items;
      const prev = messages[i - 1];
      const next = messages[i + 1];
      const out_ = m.sender_id === me;
      const first = !canGroup(prev, m);
      const last = !canGroup(m, next);
      const items: JSX.Element[] = [];
      if (!sepPlaced && unreadFrom.current >= 0 && m.id > unreadFrom.current && !out_ && !isTemp(m.id)) {
        sepPlaced = true;
        items.push(
          <div key="unread-sep" className="unread-sep">
            <span>Непрочитанные сообщения</span>
          </div>,
        );
      }
      items.push(
        <MessageRow
          key={m.client_id ?? `id${m.id}`}
          message={m}
          chat={chat}
          out={out_}
          first={first}
          last={last}
          sender={users[m.sender_id]}
          showName={chat.type === 'group' && !out_ && first}
          showAvatar={chat.type === 'group' && !out_ && last}
          selecting={selection.length > 0}
          selected={selection.includes(m.id)}
          animate={mountMax.current !== null && m.id > mountMax.current}
          flash={!!flash && flash.id === m.id && Date.now() - flash.at < 2000}
          readOnly={readOnly}
        />,
      );
      dayItems.push(<Fragment key={`f-${m.client_id ?? m.id}`}>{items}</Fragment>);
    });
    return days.map((d) => (
      <section key={`d-${d.key}`} className="day-section">
        <div className="day-pill-wrap">
          <span className="day-pill">{dayLabel(d.date)}</span>
        </div>
        {d.items}
      </section>
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, users, selection, flash, me, chat, readOnly, mountMax.current]);

  return (
    <div className="messages-wrap">
      <div className="messages" ref={scrollRef} onScroll={onScroll}>
        <div className="messages-inner">
          {loading && hasMore !== false && (
            <div className="center-pad small">
              <Spinner size={18} />
            </div>
          )}
          {messages && !messages.length && !loading && <EmptyChat chat={chat} readOnly={readOnly} />}
          {rendered}
        </div>
      </div>
      <AnimatePresence>
        {fab && (
          <motion.button
            className="fab"
            initial={{ scale: 0.4, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.4, opacity: 0, y: 20 }}
            onClick={() => {
              scrollToBottom(true);
              setNewCount(0);
            }}
          >
            <ArrowDown size={22} />
            {(newCount > 0 || chat.unread_count > 0) && <span className="fab-badge">{Math.max(newCount, chat.unread_count)}</span>}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function EmptyChat({ chat, readOnly }: { chat: Chat; readOnly: boolean }) {
  const greet = ['👋', '😊', '🔥', '💙'];
  return (
    <motion.div className="chat-empty" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
      <div className="chat-empty-title">{chat.type === 'saved' ? 'Ваше личное облако' : 'Здесь пока тихо'}</div>
      <div className="chat-empty-text">
        {chat.type === 'saved'
          ? 'Пересылайте сюда сообщения, сохраняйте файлы и заметки — они доступны на всех устройствах.'
          : readOnly
            ? 'В канале пока нет публикаций.'
            : 'Отправьте сообщение или поприветствуйте собеседника:'}
      </div>
      {!readOnly && chat.type !== 'saved' && (
        <div className="greet-row">
          {greet.map((g) => (
            <motion.button key={g} whileHover={{ scale: 1.2, rotate: -8 }} whileTap={{ scale: 0.9 }} onClick={() => void useChats.getState().send(chat.id, g)}>
              {g}
            </motion.button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
