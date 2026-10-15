import { motion } from 'framer-motion';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { CallLogEntry } from '../../api/types';
import { duration, shortStamp } from '../../lib/format';
import { useAuth } from '../../store/auth';
import { useCall } from '../../store/call';
import { useChats } from '../../store/chats';
import { UserAvatar } from '../ui/Avatar';
import { Empty, Spinner } from '../ui/primitives';
import { LargeTitle } from './Nav';

export function CallsPanel() {
  const [calls, setCalls] = useState<CallLogEntry[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'missed'>('all');
  const users = useChats((s) => s.users);
  const me = useAuth((s) => s.me!.id);
  const phase = useCall((s) => s.phase);

  useEffect(() => {
    if (phase !== 'idle') return;
    api
      .calls()
      .then((res) => {
        useChats.getState().mergeUsers(res.users);
        setCalls(res.calls);
      })
      .catch(() => setCalls([]));
  }, [phase]);

  const list = (calls ?? []).filter((c) => filter === 'all' || (c.call?.status !== 'ended' && c.sender_id !== me));

  return (
    <motion.div className="panel" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}>
      <LargeTitle title="Звонки" />
      <div className="segmented small">
        {(['all', 'missed'] as const).map((f) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {filter === f && <motion.span layoutId="calls-seg" className="seg-pill" />}
            <span className="seg-label">{f === 'all' ? 'Все' : 'Пропущенные'}</span>
          </button>
        ))}
      </div>
      <div className="chat-list">
        {calls === null ? (
          <div className="center-pad">
            <Spinner />
          </div>
        ) : list.length === 0 ? (
          <Empty icon={<Phone size={28} />} title="Звонков пока нет" text="Позвоните другу из любого личного чата — аудио или видео" />
        ) : (
          list.map((c) => {
            const peer = users[c.peer_id ?? 0];
            const outgoing = c.sender_id === me;
            const missed = c.call?.status !== 'ended';
            const Icon = missed && !outgoing ? PhoneMissed : outgoing ? PhoneOutgoing : PhoneIncoming;
            return (
              <div key={c.id} className="row-item call-row" onClick={() => useChats.getState().openChat(c.chat_id)}>
                <UserAvatar user={peer} size={46} />
                <div className="row-text">
                  <div className={`row-title ${missed && !outgoing ? 'danger' : ''}`}>{peer?.display_name ?? 'Пользователь'}</div>
                  <div className="row-sub call-sub">
                    <Icon size={14} className={missed ? 'danger' : 'ok'} />
                    {c.call?.video ? 'Видео' : 'Аудио'} · {shortStamp(c.created_at)}
                    {c.call?.status === 'ended' && ` · ${duration(c.call.duration)}`}
                  </div>
                </div>
                <button
                  className="icon-btn accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (c.peer_id) void useCall.getState().start(c.chat_id, c.peer_id, !!c.call?.video);
                  }}
                >
                  {c.call?.video ? <Video size={20} /> : <Phone size={19} />}
                </button>
              </div>
            );
          })
        )}
      </div>
    </motion.div>
  );
}
