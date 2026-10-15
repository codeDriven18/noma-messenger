import { AnimatePresence, motion } from 'framer-motion';
import { BadgeCheck, BellOff, ChevronLeft, Copy, Forward, PanelRight, Phone, Search, Trash2, Video, X } from 'lucide-react';
import type { Chat } from '../../api/types';
import { lastSeen, membersLabel, stripMarkup } from '../../lib/format';
import { useAuth } from '../../store/auth';
import { useCall } from '../../store/call';
import { chatPeer, chatTitle, useChats } from '../../store/chats';
import { toast, useUI } from '../../store/ui';
import { ChatAvatar } from '../ui/Avatar';
import { TypingDots, typingText } from './Typing';

export function ChatHeader({ chat }: { chat: Chat }) {
  const users = useChats((s) => s.users);
  const typing = useChats((s) => s.typing[chat.id]);
  const selection = useChats((s) => s.selection);
  const me = useAuth((s) => s.me!.id);
  const { setInfoOpen, setChatSearch } = useUI.getState();
  const infoOpen = useUI((s) => s.infoOpen);
  const peer = chatPeer(chat, users, me);
  const title = chatTitle(chat, users, me);
  const entries = Object.entries(typing ?? {}).filter(([uid]) => Number(uid) !== me);

  let subtitle: React.ReactNode;
  if (entries.length) {
    subtitle = (
      <span className="accent-text typing-inline">
        <TypingDots /> {typingText(entries, users, chat.type !== 'private')}
      </span>
    );
  } else if (chat.type === 'saved') {
    subtitle = 'заметки, файлы и ссылки для себя';
  } else if (chat.type === 'private') {
    subtitle = <span className={peer?.online ? 'accent-text' : ''}>{lastSeen(peer)}</span>;
  } else {
    const online = chat.member_ids.filter((id) => id !== me && users[id]?.online).length;
    subtitle = `${membersLabel(chat.member_count, chat.type === 'channel')}${online && chat.type === 'group' ? `, ${online} в сети` : ''}`;
  }

  const canCall = chat.type === 'private' && peer && !peer.is_bot;

  return (
    <header className="chat-header">
      <AnimatePresence mode="popLayout" initial={false}>
        {selection.length > 0 ? (
          <SelectionBar key="sel" chat={chat} />
        ) : (
          <motion.div key="main" className="chat-header-inner" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button className="nav-back back-btn" onClick={() => useChats.getState().openChat(null)} aria-label="Назад">
              <ChevronLeft size={28} strokeWidth={2.2} />
              <span>Чаты</span>
            </button>
            <button className="chat-header-id" onClick={() => setInfoOpen(!infoOpen)}>
              <span className="hdr-avatar-wide">
                <ChatAvatar chat={chat} size={40} />
              </span>
              <div className="chat-header-text">
                <div className="chat-header-title">
                  <span className="ellipsis">{title}</span>
                  {peer?.is_bot && <BadgeCheck size={15} className="verified" />}
                  {chat.muted && <BellOff size={13} className="muted-icon" />}
                </div>
                <div className="chat-header-sub ellipsis">{subtitle}</div>
              </div>
            </button>
            <div className="chat-header-actions">
              <button className="icon-btn hdr-search" onClick={() => setChatSearch(true)} title="Поиск по чату">
                <Search size={20} />
              </button>
              {canCall && (
                <>
                  <button className="icon-btn hdr-call" title="Аудиозвонок" onClick={() => void useCall.getState().start(chat.id, peer.id, false)}>
                    <Phone size={20} />
                  </button>
                  <button className="icon-btn hdr-video" title="Видеозвонок" onClick={() => void useCall.getState().start(chat.id, peer.id, true)}>
                    <Video size={22} />
                  </button>
                </>
              )}
              <button className={`icon-btn info-toggle ${infoOpen ? 'on' : ''}`} onClick={() => setInfoOpen(!infoOpen)} title="Информация">
                <PanelRight size={20} />
              </button>
            </div>
            <button className="hdr-avatar-narrow" onClick={() => setInfoOpen(true)} aria-label="Профиль">
              <ChatAvatar chat={chat} size={36} showOnline={false} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function SelectionBar({ chat }: { chat: Chat }) {
  const selection = useChats((s) => s.selection);
  const messages = useChats((s) => s.messages[chat.id]);
  const me = useAuth((s) => s.me!.id);
  const { clearSelection, remove } = useChats.getState();
  const openModal = useUI((s) => s.openModal);
  const selected = (messages ?? []).filter((m) => selection.includes(m.id));
  const isAdmin = chat.my_role === 'owner' || chat.my_role === 'admin';
  const canDelete = selected.every((m) => m.sender_id === me || isAdmin || chat.type === 'private' || chat.type === 'saved');

  const copy = () => {
    const text = selected
      .filter((m) => m.text)
      .map((m) => stripMarkup(m.text))
      .join('\n\n');
    void navigator.clipboard?.writeText(text);
    toast('Скопировано');
    clearSelection();
  };

  return (
    <motion.div className="chat-header-inner selection" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
      <button className="icon-btn" onClick={clearSelection}>
        <X size={22} />
      </button>
      <div className="selection-count">
        Выбрано: <b>{selection.length}</b>
      </div>
      <div className="chat-header-actions">
        <button className="icon-btn" onClick={copy} title="Копировать">
          <Copy size={19} />
        </button>
        <button className="icon-btn" onClick={() => openModal({ kind: 'forward', messageIds: [...selection].sort((a, b) => a - b) })} title="Переслать">
          <Forward size={20} />
        </button>
        {canDelete && (
          <button
            className="icon-btn danger"
            title="Удалить"
            onClick={() =>
              openModal({
                kind: 'confirm',
                title: `Удалить ${selection.length} сообщ.?`,
                text: 'Сообщения будут удалены у всех участников чата.',
                action: 'Удалить',
                danger: true,
                onConfirm: () => void remove(chat.id, selection),
              })
            }
          >
            <Trash2 size={19} />
          </button>
        )}
      </div>
    </motion.div>
  );
}
