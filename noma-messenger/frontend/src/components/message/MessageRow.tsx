import { AnimatePresence, motion, useDragControls, useMotionValue, useTransform } from 'framer-motion';
import { Check, MoreHorizontal, Reply, SmilePlus } from 'lucide-react';
import { memo, type MouseEvent, type PointerEvent, useRef, useState } from 'react';
import type { Chat, Message, User } from '../../api/types';
import { myId } from '../../store/auth';
import { isTemp, useChats } from '../../store/chats';
import { useUI } from '../../store/ui';
import { UserAvatar } from '../ui/Avatar';
import { MessageBubble } from './MessageBubble';

interface Props {
  message: Message;
  chat: Chat;
  out: boolean;
  first: boolean;
  last: boolean;
  sender?: User;
  showName: boolean;
  showAvatar: boolean;
  selecting: boolean;
  selected: boolean;
  animate: boolean;
  flash: boolean;
  readOnly: boolean;
}

const QUICK = '❤️';

export const MessageRow = memo(function MessageRow(p: Props) {
  const { message, chat, out, selecting, selected } = p;
  const rowRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const controls = useDragControls();
  const x = useMotionValue(0);
  const replyOpacity = useTransform(x, [-70, -20, 0], [1, 0.2, 0]);
  const replyScale = useTransform(x, [-70, -20], [1, 0.5]);
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number }[]>([]);
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);

  const temp = isTemp(message.id);
  const interactive = message.type !== 'system';

  const openMenu = () => {
    if (!bubbleRef.current || selecting) return;
    navigator.vibrate?.(8);
    useUI.getState().openMenu(message, bubbleRef.current.getBoundingClientRect());
  };

  const onClick = () => {
    if (selecting && interactive && !temp) useChats.getState().toggleSelect(message.id);
  };

  const onDouble = (e: MouseEvent) => {
    if (selecting || temp || !interactive || p.readOnly) return;
    window.getSelection()?.removeAllRanges();
    const r = rowRef.current!.getBoundingClientRect();
    const id = Date.now();
    setBursts((b) => [...b, { id, x: e.clientX - r.left, y: e.clientY - r.top }]);
    window.setTimeout(() => setBursts((b) => b.filter((i) => i.id !== id)), 900);
    const mine = message.reactions.find((rr) => rr.emoji === QUICK)?.user_ids.includes(myId());
    if (!mine) void useChats.getState().react(message, QUICK);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!interactive || temp) return;
    if (e.pointerType === 'touch') {
      if (!selecting && !p.readOnly) controls.start(e);
      press.current = {
        x: e.clientX,
        y: e.clientY,
        fired: false,
        timer: window.setTimeout(() => {
          if (press.current) press.current.fired = true;
          openMenu();
        }, 420),
      };
    }
  };
  const cancelPress = (e?: PointerEvent) => {
    if (!press.current) return;
    if (e && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) < 8 && e.type === 'pointermove') return;
    window.clearTimeout(press.current.timer);
    press.current = null;
  };

  if (message.type === 'system') {
    return (
      <div className="system-row">
        <span className="system-pill">{message.text}</span>
      </div>
    );
  }

  return (
    <motion.div
      ref={rowRef}
      data-mid={message.id}
      className={`msg-row ${out ? 'out' : 'in'} ${p.last ? 'last' : ''} ${selected ? 'selected' : ''} ${selecting ? 'selecting' : ''} ${p.flash ? 'flash' : ''}`}
      initial={p.animate ? { opacity: 0, y: 18, scale: 0.96 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 520, damping: 34 }}
      onClick={onClick}
      onDoubleClick={onDouble}
      onContextMenu={(e) => {
        e.preventDefault();
        if (press.current?.fired || temp) return;
        openMenu();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={cancelPress}
      onPointerUp={() => cancelPress()}
      onPointerCancel={() => cancelPress()}
    >
      <AnimatePresence>
        {selecting && (
          <motion.span className={`select-check ${selected ? 'on' : ''}`} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}>
            {selected && <Check size={14} strokeWidth={3.2} />}
          </motion.span>
        )}
      </AnimatePresence>

      {!out && chat.type === 'group' && (
        <div className="msg-avatar">
          {p.showAvatar && (
            <button onClick={(e) => { e.stopPropagation(); if (p.sender) useUI.getState().openModal({ kind: 'userProfile', userId: p.sender.id }); }}>
              <UserAvatar user={p.sender} size={34} />
            </button>
          )}
        </div>
      )}

      <motion.div
        className="msg-drag"
        drag={selecting || p.readOnly ? false : 'x'}
        dragControls={controls}
        dragListener={false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.45, right: 0 }}
        dragDirectionLock
        style={{ x }}
        onDragEnd={(_, info) => {
          if (info.offset.x < -60) {
            navigator.vibrate?.(10);
            useChats.getState().setReply(chat.id, message);
          }
        }}
      >
        <div ref={bubbleRef} className="bubble-wrap">
          <MessageBubble message={message} chat={chat} out={out} first={p.first} last={p.last} sender={p.sender} showName={p.showName} />
          {!selecting && !temp && (
            <div className="hover-actions">
              {!p.readOnly && (
                <button title="Ответить" onClick={(e) => { e.stopPropagation(); useChats.getState().setReply(chat.id, message); }}>
                  <Reply size={16} />
                </button>
              )}
              <button title="Реакция" onClick={(e) => { e.stopPropagation(); openMenu(); }}>
                <SmilePlus size={16} />
              </button>
              <button title="Ещё" onClick={(e) => { e.stopPropagation(); openMenu(); }}>
                <MoreHorizontal size={16} />
              </button>
            </div>
          )}
        </div>
        <motion.span className="swipe-reply" style={{ opacity: replyOpacity, scale: replyScale }}>
          <Reply size={18} />
        </motion.span>
      </motion.div>

      {bursts.map((b) => (
        <HeartBurst key={b.id} x={b.x} y={b.y} />
      ))}
    </motion.div>
  );
});

function HeartBurst({ x, y }: { x: number; y: number }) {
  const parts = Array.from({ length: 7 }, (_, i) => (i / 7) * Math.PI * 2);
  return (
    <span className="burst" style={{ left: x, top: y }}>
      <motion.span className="burst-main" initial={{ scale: 0, opacity: 1 }} animate={{ scale: [0, 1.6, 1.2], opacity: [1, 1, 0], y: -30 }} transition={{ duration: 0.8 }}>
        {QUICK}
      </motion.span>
      {parts.map((a, i) => (
        <motion.span
          key={i}
          className="burst-dot"
          initial={{ x: 0, y: 0, opacity: 1, scale: 0.6 }}
          animate={{ x: Math.cos(a) * 46, y: Math.sin(a) * 46, opacity: 0, scale: 1 }}
          transition={{ duration: 0.65, ease: 'easeOut' }}
        />
      ))}
    </span>
  );
}
