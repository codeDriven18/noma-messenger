import { AlertCircle, Check, CheckCheck, Clock, Download, FileText, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Play, RotateCcw, Video } from 'lucide-react';
import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { Attachment, Chat, Message, Reaction } from '../../api/types';
import { nameColor } from '../../lib/colors';
import { attachmentLabel, duration, fileSize, timeHM } from '../../lib/format';
import { downloadUrl, fitBox } from '../../lib/media';
import { useAuth } from '../../store/auth';
import { useCall } from '../../store/call';
import { isTemp, localPreview, useChats } from '../../store/chats';
import { useUI, type ViewerItem } from '../../store/ui';
import { UserAvatar } from '../ui/Avatar';
import { ProgressRing } from '../ui/primitives';

export const src = (url: string | undefined) => (url ? localPreview.get(url) ?? url : '');

/* ------------------------------------------------------------------ meta */

export function Meta({ message, chat, out, overlay }: { message: Message; chat: Chat; out: boolean; overlay?: boolean }) {
  let tick: React.ReactNode = null;
  if (out && chat.type !== 'channel' && chat.type !== 'saved') {
    if (message.status === 'failed') tick = <AlertCircle size={14} className="tick failed" />;
    else if (message.status === 'sending' || isTemp(message.id)) tick = <Clock size={13} className="tick" />;
    else if (chat.peer_read_id >= message.id) tick = <CheckCheck size={16} className="tick read" />;
    else tick = <Check size={16} className="tick" />;
  } else if (out && message.status === 'sending') {
    tick = <Clock size={13} className="tick" />;
  }
  return (
    <span className={`meta ${overlay ? 'overlay' : ''}`}>
      {message.edited_at && <span className="edited">изм.</span>}
      <span>{timeHM(message.created_at)}</span>
      {tick}
    </span>
  );
}

/* ---------------------------------------------------------------- forward */

export function ForwardHeader({ message }: { message: Message }) {
  const f = message.forward!;
  return (
    <div
      className="forward-head"
      onClick={(e) => {
        e.stopPropagation();
        if (f.user_id) useUI.getState().openModal({ kind: 'userProfile', userId: f.user_id });
      }}
    >
      Переслано от <b style={{ color: nameColor(f.user_id ?? f.chat_id ?? 0) }}>{f.name}</b>
    </div>
  );
}

/* ------------------------------------------------------------------ reply */

export function ReplyQuote({ message, onJump }: { message: Message; onJump?: () => void }) {
  const r = message.reply_to!;
  const users = useChats((s) => s.users);
  const sender = r.sender_id ? users[r.sender_id] : undefined;
  return (
    <div
      className="reply-quote"
      style={{ ['--q' as string]: nameColor(r.sender_id ?? 0) }}
      onClick={(e) => {
        e.stopPropagation();
        if (!r.deleted) onJump?.();
      }}
    >
      {r.thumb && <img src={src(r.thumb)} alt="" className="reply-thumb" />}
      <div className="reply-text">
        <div className="reply-name">{r.deleted ? 'Сообщение удалено' : sender?.display_name ?? 'Пользователь'}</div>
        <div className="reply-body ellipsis">
          {r.deleted ? '…' : r.text ? r.text.replace(/(\*\*|__|~~|\|\||`)/g, '') : attachmentLabel({ kind: r.kind ?? 'file', url: '' })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ media */

function albumRows(n: number): number[] {
  const map: Record<number, number[]> = { 1: [1], 2: [2], 3: [1, 2], 4: [2, 2], 5: [2, 3], 6: [3, 3], 7: [2, 2, 3], 8: [2, 3, 3], 9: [3, 3, 3], 10: [2, 2, 3, 3] };
  return map[n] ?? [n];
}

export function collectViewerItems(chatId: number, focus: Message, att: Attachment): { items: ViewerItem[]; index: number } {
  const list = useChats.getState().messages[chatId] ?? [focus];
  const items: ViewerItem[] = [];
  for (const m of list) for (const a of m.attachments) if (a.kind === 'photo' || a.kind === 'video') items.push({ attachment: a, message: m });
  const index = Math.max(0, items.findIndex((i) => i.attachment.url === att.url));
  return items.length ? { items, index } : { items: [{ attachment: att, message: focus }], index: 0 };
}

export function MediaAlbum({ message, items, hasCaption }: { message: Message; items: Attachment[]; hasCaption: boolean }) {
  const open = (a: Attachment) => {
    if (message.status === 'sending') return;
    const { items: all, index } = collectViewerItems(message.chat_id, message, a);
    useUI.getState().openViewer(all, index);
  };
  const uploading = message.status === 'sending' && message.progress !== undefined;

  if (items.length === 1) {
    const a = items[0];
    const box = fitBox(a.width, a.height, 360, 420, hasCaption ? 240 : 160);
    return (
      <div className="media-single" style={{ width: box.width, height: box.height }} onClick={(e) => { e.stopPropagation(); open(a); }}>
        <MediaTile att={a} />
        {uploading && <UploadOverlay value={message.progress ?? 0} />}
      </div>
    );
  }
  const rows = albumRows(items.length);
  let k = 0;
  return (
    <div className="media-album">
      {rows.map((count, ri) => (
        <div className="album-row" key={ri} style={{ height: count === 1 ? 220 : count === 2 ? 160 : 112 }}>
          {items.slice(k, (k += count)).map((a) => (
            <div key={a.url} className="album-cell" onClick={(e) => { e.stopPropagation(); open(a); }}>
              <MediaTile att={a} />
            </div>
          ))}
        </div>
      ))}
      {uploading && <UploadOverlay value={message.progress ?? 0} />}
    </div>
  );
}

function MediaTile({ att }: { att: Attachment }) {
  const [loaded, setLoaded] = useState(false);
  if (att.kind === 'video') {
    return (
      <>
        {att.thumb ? (
          <img src={src(att.thumb)} alt="" className={`media-img ${loaded ? 'loaded' : ''}`} onLoad={() => setLoaded(true)} draggable={false} />
        ) : (
          <video src={`${src(att.url)}#t=0.1`} className="media-img loaded" preload="metadata" muted playsInline />
        )}
        <span className="play-badge">
          <Play size={22} fill="currentColor" />
        </span>
        {att.duration ? <span className="duration-badge">{duration(att.duration)}</span> : null}
      </>
    );
  }
  return <img src={src(att.url)} alt="" className={`media-img ${loaded ? 'loaded' : ''}`} onLoad={() => setLoaded(true)} draggable={false} />;
}

function UploadOverlay({ value }: { value: number }) {
  return (
    <div className="upload-overlay">
      <ProgressRing value={value} size={52} stroke={3} />
      <span className="upload-pct">{Math.round(value * 100)}%</span>
    </div>
  );
}

/* ------------------------------------------------------------------- files */

export function FileRow({ message, att }: { message: Message; att: Attachment }) {
  const ext = (att.name?.split('.').pop() ?? 'file').slice(0, 4).toUpperCase();
  const uploading = message.status === 'sending' && message.progress !== undefined;
  return (
    <div className="file-row" onClick={(e) => { e.stopPropagation(); if (!uploading) downloadUrl(src(att.url), att.name); }}>
      <div className="file-icon">
        {uploading ? <ProgressRing value={message.progress ?? 0} size={46} stroke={3} /> : (
          <>
            <FileText size={20} className="file-icon-glyph" />
            <span className="file-ext">{ext}</span>
            <span className="file-dl"><Download size={18} /></span>
          </>
        )}
      </div>
      <div className="file-info">
        <div className="file-name ellipsis">{att.name ?? 'Файл'}</div>
        <div className="file-size">{uploading ? `${fileSize((att.size ?? 0) * (message.progress ?? 0))} из ${fileSize(att.size)}` : fileSize(att.size)}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- video note */

export function VideoNote({ message, att }: { message: Message; att: Attachment }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const uploading = message.status === 'sending' && message.progress !== undefined;
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onTime = () => setProgress(v.duration ? v.currentTime / v.duration : 0);
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
      v.muted = true;
    };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnd);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnd);
    };
  }, []);
  const toggle = () => {
    const v = ref.current;
    if (!v || uploading) return;
    if (playing) {
      v.pause();
      setPlaying(false);
    } else {
      v.muted = false;
      if (progress === 0) v.currentTime = 0;
      void v.play();
      setPlaying(true);
    }
  };
  const r = 118;
  const c = 2 * Math.PI * r;
  return (
    <motion.div className={`video-note ${playing || uploading ? 'playing' : ''}`} onClick={(e) => { e.stopPropagation(); toggle(); }} whileTap={{ scale: 0.97 }}>
      <video ref={ref} src={`${src(att.url)}#t=0.1`} playsInline muted preload="metadata" poster={att.thumb ? src(att.thumb) : undefined} />
      <svg className="video-note-ring" viewBox="0 0 240 240">
        <circle cx="120" cy="120" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - (uploading ? message.progress ?? 0 : progress))} />
      </svg>
      {!playing && !uploading && (
        <span className="video-note-badge">
          <Play size={12} fill="currentColor" /> {duration(att.duration)}
        </span>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------- call */

export function CallBubble({ message, out, chat }: { message: Message; out: boolean; chat: Chat }) {
  const c = message.call!;
  const me = useAuth((s) => s.me!.id);
  const missed = c.status !== 'ended';
  const Icon = missed && !out ? PhoneMissed : out ? PhoneOutgoing : PhoneIncoming;
  const kind = c.video ? 'видеозвонок' : 'звонок';
  const label =
    c.status === 'ended'
      ? `${out ? 'Исходящий' : 'Входящий'} ${kind}`
      : c.status === 'missed'
        ? out ? `Отменённый ${kind}` : `Пропущенный ${kind}`
        : c.status === 'busy'
          ? 'Абонент был занят'
          : `Отклонённый ${kind}`;
  const peer = chat.member_ids.find((id) => id !== me);
  return (
    <div className="call-bubble">
      <button
        className={`call-bubble-icon ${missed ? 'missed' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          if (peer) void useCall.getState().start(chat.id, peer, c.video);
        }}
        title="Перезвонить"
      >
        {c.video ? <Video size={20} /> : <Phone size={18} />}
      </button>
      <div>
        <div className="call-bubble-title">{label}</div>
        <div className="call-bubble-sub">
          <Icon size={13} className={missed ? 'danger' : 'ok'} />
          {timeHM(message.created_at)}
          {c.status === 'ended' && `, ${duration(c.duration)}`}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- reactions */

export function Reactions({ message, compact }: { message: Message; compact?: boolean }) {
  const me = useAuth((s) => s.me!.id);
  const users = useChats((s) => s.users);
  if (!message.reactions.length) return null;
  return (
    <div className={`reactions ${compact ? 'compact' : ''}`}>
      {message.reactions.map((r: Reaction) => {
        const mine = r.user_ids.includes(me);
        return (
          <motion.button
            key={r.emoji}
            layout
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 700, damping: 22 }}
            className={`reaction ${mine ? 'mine' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              void useChats.getState().react(message, r.emoji);
            }}
            title={r.user_ids.map((id) => users[id]?.display_name ?? '').join(', ')}
          >
            <motion.span key={`${r.emoji}-${r.count}`} className="reaction-emoji" initial={{ scale: 1.6 }} animate={{ scale: 1 }}>
              {r.emoji}
            </motion.span>
            {r.count <= 3 && r.user_ids.length <= 3 && message.reactions.length < 4 ? (
              <span className="reaction-avatars">
                {r.user_ids.map((id) => (
                  <UserAvatar key={id} user={users[id]} size={18} />
                ))}
              </span>
            ) : (
              <span className="reaction-count">{r.count}</span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

export function RetryButton({ message }: { message: Message }) {
  if (message.status !== 'failed' || !message.client_id) return null;
  return (
    <button className="retry-btn" onClick={(e) => { e.stopPropagation(); void useChats.getState().retry(message.client_id!); }}>
      <RotateCcw size={14} /> Повторить
    </button>
  );
}
