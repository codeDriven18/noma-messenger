import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, CheckCircle2, ChevronDown, Copy, Download, Forward, Pencil, Pin, PinOff, Reply, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { ALL_REACTIONS, QUICK_REACTIONS } from '../../lib/emoji';
import { stripMarkup } from '../../lib/format';
import { downloadUrl } from '../../lib/media';
import { rectInStage, stageRect } from '../../lib/stage';
import type { Message } from '../../api/types';
import { useAuth } from '../../store/auth';
import { useChats } from '../../store/chats';
import { toast, useUI } from '../../store/ui';
import { Portal } from '../ui/primitives';
import { MessageBubble } from './MessageBubble';
import { src } from './MessageParts';

interface Action {
  label: string;
  icon: ReactNode;
  danger?: boolean;
  run: () => void;
}

export function MessageMenu() {
  const menu = useUI((s) => s.menu);
  const close = useUI((s) => s.closeMenu);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onResize = () => close();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [menu, close]);
  return (
    <Portal>
      <AnimatePresence>{menu && <MenuBody key={menu.message.id} menu={menu} />}</AnimatePresence>
    </Portal>
  );
}

function MenuBody({ menu }: { menu: { message: Message; rect: DOMRect } }) {
  const close = useUI((s) => s.closeMenu);
  const openModal = useUI((s) => s.openModal);
  const chat = useChats((s) => s.chats[menu.message.chat_id]);
  const live = useChats((s) => s.messages[menu.message.chat_id]?.find((m) => m.id === menu.message.id)) ?? menu.message;
  const users = useChats((s) => s.users);
  const me = useAuth((s) => s.me!.id);
  const [expanded, setExpanded] = useState(false);
  const m = live;
  const rect = rectInStage(menu.rect);
  const out = m.sender_id === me;

  const actions = useMemo<Action[]>(() => {
    if (!chat) return [];
    const store = useChats.getState();
    const isAdmin = chat.my_role === 'owner' || chat.my_role === 'admin';
    const canPost = chat.my_role !== null && (chat.type !== 'channel' || isAdmin);
    const canPin = chat.type === 'private' || chat.type === 'saved' || isAdmin;
    const canDelete = out || isAdmin || chat.type === 'private' || chat.type === 'saved';
    const list: Action[] = [];
    if (canPost) list.push({ label: 'Ответить', icon: <Reply size={18} />, run: () => store.setReply(chat.id, m) });
    if (m.text) {
      list.push({
        label: 'Копировать текст',
        icon: <Copy size={18} />,
        run: () => {
          void navigator.clipboard?.writeText(stripMarkup(m.text));
          toast('Текст скопирован');
        },
      });
    }
    if (out && m.type === 'text' && !m.forward && (m.text || m.attachments.length) && !m.attachments.some((a) => a.kind === 'voice' || a.kind === 'video_note')) {
      list.push({ label: 'Изменить', icon: <Pencil size={18} />, run: () => store.setEditing(chat.id, m) });
    }
    if (canPin && m.type === 'text') {
      const pinned = chat.pinned_message?.id === m.id;
      list.push({
        label: pinned ? 'Открепить' : 'Закрепить',
        icon: pinned ? <PinOff size={18} /> : <Pin size={18} />,
        run: () => void store.pin(chat.id, pinned ? null : m.id),
      });
    }
    if (m.type === 'text') {
      list.push({ label: 'Переслать', icon: <Forward size={18} />, run: () => openModal({ kind: 'forward', messageIds: [m.id] }) });
      const saved = Object.values(store.chats).find((c) => c.type === 'saved');
      if (saved && saved.id !== chat.id) {
        list.push({
          label: 'В Избранное',
          icon: <Bookmark size={18} />,
          run: () => void store.forward([m.id], [saved.id]).then(() => toast('Сохранено в Избранное', 'success')),
        });
      }
    }
    if (m.attachments.length) {
      list.push({
        label: m.attachments.length > 1 ? 'Скачать всё' : 'Скачать',
        icon: <Download size={18} />,
        run: () => m.attachments.forEach((a) => downloadUrl(src(a.url), a.name)),
      });
    }
    list.push({ label: 'Выбрать', icon: <CheckCircle2 size={18} />, run: () => store.toggleSelect(m.id) });
    if (canDelete) {
      list.push({
        label: 'Удалить',
        icon: <Trash2 size={18} />,
        danger: true,
        run: () =>
          openModal({
            kind: 'confirm',
            title: 'Удалить сообщение?',
            text: chat.type === 'saved' ? 'Сообщение будет удалено.' : 'Сообщение будет удалено у всех участников.',
            action: 'Удалить',
            danger: true,
            onConfirm: () => void store.remove(chat.id, [m.id]),
          }),
      });
    }
    return list;
  }, [chat, m, out, openModal]);

  if (!chat) return null;

  const canReact = chat.my_role !== null;
  const stage = stageRect();
  const vw = stage.width;
  const vh = stage.height;
  const barH = canReact ? 56 : 0;
  const actionsH = expanded ? 260 : actions.length * 44 + 12;
  const bubbleH = Math.min(rect.height, vh * 0.42);
  const total = barH + 10 + bubbleH + 10 + actionsH;
  let top = rect.top - barH - 10;
  if (top + total > vh - 12) top = vh - 12 - total;
  if (top < 12) top = 12;
  const bubbleTop = top + barH + 10;
  const menuW = 240;
  const alignLeft = out ? Math.max(12, Math.min(rect.right - menuW, vw - menuW - 12)) : Math.max(12, Math.min(rect.left, vw - menuW - 12));
  const barW = expanded ? 340 : QUICK_REACTIONS.length * 44 + 52;
  const barLeft = out ? Math.max(12, Math.min(rect.right - barW, vw - barW - 12)) : Math.max(12, Math.min(rect.left, vw - barW - 12));
  const sender = users[m.sender_id];
  const myReaction = m.reactions.find((r) => r.user_ids.includes(me))?.emoji;

  const react = (e: string) => {
    void useChats.getState().react(m, e);
    close();
  };

  return (
    <motion.div className="focus-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={close} onContextMenu={(e) => { e.preventDefault(); close(); }}>
      <motion.div
        className={`focus-bubble ${out ? 'out' : 'in'}`}
        style={{ left: rect.left, top: rect.top, width: rect.width, maxHeight: vh * 0.42 }}
        initial={{ y: 0, scale: 1 }}
        animate={{ y: bubbleTop - rect.top, scale: 1.02 }}
        exit={{ y: 0, scale: 1, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <MessageBubble message={m} chat={chat} out={out} first last sender={sender} showName={chat.type === 'group' && !out} />
      </motion.div>

      {canReact && m.type !== 'system' && (
        <motion.div
          className={`reaction-bar ${expanded ? 'expanded' : ''}`}
          style={{ left: barLeft, top, width: barW }}
          initial={{ opacity: 0, scale: 0.6, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ type: 'spring', stiffness: 520, damping: 30 }}
          onClick={(e) => e.stopPropagation()}
        >
          {!expanded ? (
            <>
              {QUICK_REACTIONS.map((e, i) => (
                <motion.button
                  key={e}
                  className={myReaction === e ? 'mine' : ''}
                  initial={{ opacity: 0, y: 12, scale: 0.4 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: 0.03 * i, type: 'spring', stiffness: 600, damping: 22 }}
                  whileHover={{ scale: 1.35, y: -4 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => react(e)}
                >
                  {e}
                </motion.button>
              ))}
              <button className="reaction-more" onClick={() => setExpanded(true)}>
                <ChevronDown size={18} />
              </button>
            </>
          ) : (
            <div className="reaction-grid">
              {ALL_REACTIONS.map((e) => (
                <motion.button key={e} className={myReaction === e ? 'mine' : ''} whileHover={{ scale: 1.3 }} whileTap={{ scale: 0.9 }} onClick={() => react(e)}>
                  {e}
                </motion.button>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {!expanded && (
        <motion.div
          className="action-menu"
          style={{ left: alignLeft, top: bubbleTop + bubbleH + 10, width: menuW }}
          initial={{ opacity: 0, scale: 0.85, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 520, damping: 34 }}
          onClick={(e) => e.stopPropagation()}
        >
          {actions.map((a) => (
            <button
              key={a.label}
              className={`menu-item ${a.danger ? 'danger' : ''}`}
              onClick={() => {
                close();
                a.run();
              }}
            >
              <span>{a.label}</span>
              {a.icon}
            </button>
          ))}
        </motion.div>
      )}
    </motion.div>
  );
}
