import { motion } from 'framer-motion';
import { BadgeCheck, BellOff, Check, CheckCheck, Clock, Pin } from 'lucide-react';
import { memo, type MouseEvent, type PointerEvent } from 'react';
import type { Chat, User } from '../../api/types';
import { messagePreview, shortStamp } from '../../lib/format';
import { chatTitle, isTemp, type TypingEntry } from '../../store/chats';
import { ChatAvatar, ChatTypeIcon } from '../ui/Avatar';
import { TypingDots, typingText } from '../chat/Typing';

interface Props {
  chat: Chat;
  users: Record<number, User>;
  me: number;
  active: boolean;
  typing: Record<number, TypingEntry> | undefined;
  draft?: string;
  onOpen: (id: number) => void;
  onMenu: (chat: Chat, e: MouseEvent) => void;
}

function spotlight(e: PointerEvent<HTMLDivElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
}

export const ChatListItem = memo(function ChatListItem({ chat, users, me, active, typing, draft, onOpen, onMenu }: Props) {
  const title = chatTitle(chat, users, me);
  const last = chat.last_message;
  const peer = chat.type === 'private' ? users[chat.member_ids.find((id) => id !== me) ?? 0] : undefined;
  const typingEntries = Object.entries(typing ?? {}).filter(([uid]) => Number(uid) !== me);
  const isTyping = typingEntries.length > 0;
  const mine = last && last.sender_id === me && last.type !== 'system';
  const sender = last && chat.type === 'group' && !mine && last.type === 'text' ? users[last.sender_id] : undefined;

  let preview: React.ReactNode;
  if (isTyping) {
    preview = (
      <span className="typing-inline">
        <TypingDots />
        {typingText(typingEntries, users, chat.type !== 'private')}
      </span>
    );
  } else if (draft?.trim() && !active) {
    preview = (
      <>
        <span className="draft-label">Черновик: </span>
        {draft}
      </>
    );
  } else if (last) {
    preview = (
      <>
        {mine && last.type === 'text' && chat.type !== 'saved' && <span className="preview-sender">Вы: </span>}
        {sender && <span className="preview-sender">{sender.display_name.split(' ')[0]}: </span>}
        <span className={last.type === 'system' ? 'preview-system' : ''}>{messagePreview(last)}</span>
      </>
    );
  } else {
    preview = <span className="preview-system">{chat.type === 'private' ? 'Начните диалог' : 'Нет сообщений'}</span>;
  }

  let status: React.ReactNode = null;
  if (mine && chat.type !== 'saved' && chat.type !== 'channel') {
    if (last.status === 'sending' || isTemp(last.id)) status = <Clock size={14} className="tick" />;
    else if (chat.peer_read_id >= last.id) status = <CheckCheck size={16} className="tick read" />;
    else status = <Check size={16} className="tick" />;
  }

  return (
    <motion.div
      layout="position"
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
      className={`chat-item ${active ? 'active' : ''}`}
      onClick={() => onOpen(chat.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(chat, e);
      }}
      onPointerMove={spotlight}
    >
      {active && <motion.div layoutId="chat-active" className="chat-item-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
      <ChatAvatar chat={chat} size={54} />
      <div className="chat-item-body">
        <div className="chat-item-top">
          <span className="chat-item-title">
            <ChatTypeIcon chat={chat} />
            <span className="ellipsis">{title}</span>
            {peer?.is_bot && <BadgeCheck size={15} className="verified" />}
            {chat.muted && <BellOff size={13} className="muted-icon" />}
          </span>
          <span className="chat-item-meta">
            {status}
            <span className="chat-item-time">{shortStamp(last?.created_at ?? chat.created_at)}</span>
          </span>
        </div>
        <div className="chat-item-bottom">
          <span className="chat-item-preview ellipsis">{preview}</span>
          {chat.unread_count > 0 ? (
            <motion.span
              key={chat.unread_count}
              initial={{ scale: 0.5 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 700, damping: 20 }}
              className={`badge ${chat.muted ? 'muted' : ''}`}
            >
              {chat.unread_count > 999 ? '999+' : chat.unread_count}
            </motion.span>
          ) : chat.pinned ? (
            <Pin size={14} className="pin-icon" />
          ) : null}
        </div>
      </div>
    </motion.div>
  );
});
