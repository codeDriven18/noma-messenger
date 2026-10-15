import { AnimatePresence, motion } from 'framer-motion';
import { Mic, Pause, Phone, PhoneOff, Play, Video, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { duration } from '../../lib/format';
import { useCall } from '../../store/call';
import { useChats } from '../../store/chats';
import { usePlayer } from '../../store/player';
import { useUI } from '../../store/ui';
import { Avatar, UserAvatar } from '../ui/Avatar';

export function useCallTimer() {
  const startedAt = useCall((s) => s.startedAt);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [startedAt]);
  return startedAt ? duration((now - startedAt) / 1000) : null;
}

function Bars({ live = true }: { live?: boolean }) {
  return (
    <span className={`island-bars ${live ? 'live' : ''}`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </span>
  );
}

export function Island() {
  const call = useCall();
  const users = useChats((s) => s.users);
  const notices = useUI((s) => s.notices);
  const player = usePlayer();
  const timer = useCallTimer();
  const peer = call.peerId ? users[call.peerId] : undefined;

  let mode: 'incoming' | 'call' | 'notice' | 'player' | null = null;
  if (call.phase === 'incoming') mode = 'incoming';
  else if (call.minimized && call.phase !== 'idle' && call.phase !== 'ended') mode = 'call';
  else if (notices.length) mode = 'notice';
  else if (player.message) mode = 'player';

  const notice = notices[notices.length - 1];
  const sender = player.message ? users[player.message.sender_id] : undefined;

  return (
    <div className="island-anchor">
      <AnimatePresence>
        {mode && (
          <motion.div
            layout
            className={`island ${mode}`}
            initial={{ opacity: 0, y: -30, scale: 0.6 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -24, scale: 0.6 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            style={{ borderRadius: mode === 'incoming' || mode === 'notice' ? 30 : 26 }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {mode === 'incoming' && (
                <motion.div key="incoming" className="island-content incoming" initial={{ opacity: 0, filter: 'blur(6px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} exit={{ opacity: 0 }}>
                  <div className="island-ripple">
                    <UserAvatar user={peer} size={48} />
                  </div>
                  <div className="island-text">
                    <div className="island-title">{peer?.display_name ?? 'Входящий звонок'}</div>
                    <div className="island-sub">{call.video ? 'Входящий видеозвонок…' : 'Входящий звонок…'}</div>
                  </div>
                  <motion.button className="island-btn decline" whileTap={{ scale: 0.88 }} onClick={() => call.decline()} title="Отклонить">
                    <PhoneOff size={20} />
                  </motion.button>
                  <motion.button className="island-btn accept" whileTap={{ scale: 0.88 }} onClick={() => void call.accept()} title="Принять">
                    {call.video ? <Video size={20} /> : <Phone size={20} />}
                  </motion.button>
                </motion.div>
              )}
              {mode === 'call' && (
                <motion.button key="call" className="island-content call" onClick={() => call.setMinimized(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <UserAvatar user={peer} size={28} />
                  <span className="island-call-time">{call.phase === 'active' ? timer : call.phase === 'outgoing' ? 'Вызов…' : 'Соединение…'}</span>
                  {!call.mic && <Mic size={14} className="danger" />}
                  <Bars />
                </motion.button>
              )}
              {mode === 'notice' && notice && (
                <motion.div
                  key={`n-${notice.id}`}
                  className="island-content notice"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  onClick={() => {
                    useChats.getState().openChat(notice.chatId);
                    useUI.setState({ tab: 'chats' });
                    useUI.getState().dropNotice(notice.id);
                  }}
                >
                  <Avatar url={notice.avatar.url} name={notice.avatar.name} color={notice.avatar.color} size={40} round={notice.avatar.round} />
                  <div className="island-text">
                    <div className="island-title ellipsis">{notice.title}</div>
                    <div className="island-sub ellipsis">{notice.text}</div>
                  </div>
                  <button
                    className="island-x"
                    onClick={(e) => {
                      e.stopPropagation();
                      useUI.getState().dropNotice(notice.id);
                    }}
                  >
                    <X size={14} />
                  </button>
                </motion.div>
              )}
              {mode === 'player' && player.message && (
                <motion.div key="player" className="island-content player" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <button className="island-play" onClick={() => player.toggle(player.message!, player.url!)}>
                    {player.playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                  </button>
                  <div className="island-text" onClick={() => void useChats.getState().jumpTo(player.message!.chat_id, player.message!.id)}>
                    <div className="island-title ellipsis">{sender?.display_name ?? 'Голосовое'}</div>
                    <div className="island-progress">
                      <span style={{ width: `${player.duration ? (player.time / player.duration) * 100 : 0}%` }} />
                    </div>
                  </div>
                  <Bars live={player.playing} />
                  <button className="island-x" onClick={() => player.stop()}>
                    <X size={14} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
