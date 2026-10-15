import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, Check, ChevronLeft, FileText, Image as ImageIcon, Lock, Mic, Paperclip, Pencil, Reply, Smile, Trash2, Video, X } from 'lucide-react';
import { type ClipboardEvent, type KeyboardEvent, type PointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Chat } from '../../api/types';
import { nameColor } from '../../lib/colors';
import { attachmentLabel, duration, stripMarkup } from '../../lib/format';
import { prepareFiles } from '../../lib/media';
import { useRecorder } from '../../hooks/useRecorder';
import { useAuth } from '../../store/auth';
import { isTemp, useChats } from '../../store/chats';
import { useSettings } from '../../store/settings';
import { toast, useUI } from '../../store/ui';
import { EmojiPanel } from './EmojiPanel';

const MAX_NOTE = 60;

export function Composer({ chat }: { chat: Chat }) {
  const chatId = chat.id;
  const draft = useChats((s) => s.drafts[chatId] ?? '');
  const reply = useChats((s) => s.reply[chatId] ?? null);
  const editing = useChats((s) => s.editing[chatId] ?? null);
  const users = useChats((s) => s.users);
  const me = useAuth((s) => s.me!.id);
  const sendOnEnter = useSettings((s) => s.sendOnEnter);
  const [text, setText] = useState(draft);
  const [emoji, setEmoji] = useState(false);
  const [attach, setAttach] = useState(false);
  const [mode, setMode] = useState<'voice' | 'video_note'>('voice');
  const [locked, setLocked] = useState(false);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [levels, setLevels] = useState<number[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const press = useRef<{ x: number; y: number; t: number; timer: number } | null>(null);
  const rec = useRecorder();
  const recording = rec.state !== 'idle';

  // draft persistence
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!editing) useChats.getState().setDraft(chatId, text);
    }, 300);
    return () => window.clearTimeout(t);
  }, [text, chatId, editing]);

  // entering edit mode fills the input
  useEffect(() => {
    if (editing) {
      setText(editing.text);
      requestAnimationFrame(() => {
        taRef.current?.focus();
        const len = taRef.current?.value.length ?? 0;
        taRef.current?.setSelectionRange(len, len);
      });
    }
  }, [editing]);

  useEffect(() => {
    if (reply) taRef.current?.focus();
  }, [reply]);

  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) taRef.current?.focus();
  }, [chatId]);

  // autosize
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
    ta.style.overflowY = ta.scrollHeight > 180 ? 'auto' : 'hidden';
  }, [text]);

  // live waveform while recording
  useEffect(() => {
    if (rec.state === 'recording') setLevels((l) => [...l.slice(-47), rec.level]);
    else if (rec.state === 'idle') setLevels([]);
  }, [rec.level, rec.state]);

  const finishRecording = useCallback(
    async (send: boolean) => {
      setLocked(false);
      setDrag({ x: 0, y: 0 });
      useChats.getState().sendTyping(chatId, 'cancel');
      if (!send) {
        rec.cancel();
        return;
      }
      const res = await rec.stop();
      if (!res) return;
      if (res.duration < 0.7) {
        toast('Слишком короткая запись');
        return;
      }
      const ext = res.mime.includes('mp4') ? 'mp4' : res.mime.includes('ogg') ? 'ogg' : 'webm';
      void useChats.getState().send(chatId, '', [
        {
          kind: res.kind,
          file: res.blob,
          name: `${res.kind === 'voice' ? 'voice' : 'video'}.${ext}`,
          previewUrl: URL.createObjectURL(res.blob),
          duration: res.duration,
          waveform: res.kind === 'voice' ? res.waveform : undefined,
          width: res.kind === 'video_note' ? 480 : undefined,
          height: res.kind === 'video_note' ? 480 : undefined,
        },
      ]);
    },
    [chatId, rec],
  );

  // video notes stop automatically after a minute
  useEffect(() => {
    if (rec.kind === 'video_note' && rec.state === 'recording' && rec.elapsed >= MAX_NOTE) void finishRecording(true);
  }, [rec.elapsed, rec.kind, rec.state, finishRecording]);

  const submit = () => {
    const value = text.trim();
    const store = useChats.getState();
    if (editing) {
      if (value && value !== editing.text) void store.edit(chatId, editing.id, value);
      store.setEditing(chatId, null);
      setText('');
      store.setDraft(chatId, '');
      return;
    }
    if (!value) return;
    setText('');
    store.sendTyping(chatId, 'cancel');
    void store.send(chatId, value);
    setEmoji(false);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      const send = sendOnEnter ? !e.shiftKey : e.ctrlKey || e.metaKey;
      if (send) {
        e.preventDefault();
        submit();
        return;
      }
    }
    if (e.key === 'Escape') {
      if (editing) {
        useChats.getState().setEditing(chatId, null);
        setText('');
      } else if (reply) useChats.getState().setReply(chatId, null);
    }
    if (e.key === 'ArrowUp' && !text) {
      const list = useChats.getState().messages[chatId] ?? [];
      const lastMine = [...list].reverse().find((m) => m.sender_id === me && m.type === 'text' && !isTemp(m.id) && (m.text || m.attachments.length));
      if (lastMine) {
        e.preventDefault();
        useChats.getState().setEditing(chatId, lastMine);
      }
    }
  };

  const onChange = (v: string) => {
    setText(v);
    if (v.trim() && !editing) useChats.getState().sendTyping(chatId, 'typing');
  };

  const onPaste = async (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (!files.length) return;
    e.preventDefault();
    const items = await prepareFiles(files);
    useUI.getState().openModal({ kind: 'sendFiles', chatId, items });
  };

  const pickFiles = async (list: FileList | null, asDocs: boolean) => {
    if (!list?.length) return;
    const items = await prepareFiles(Array.from(list).slice(0, 10), asDocs);
    useUI.getState().openModal({ kind: 'sendFiles', chatId, items });
  };

  const insertEmoji = (e: string) => {
    const ta = taRef.current;
    if (!ta) return setText((t) => t + e);
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? text.length;
    const next = text.slice(0, start) + e + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + e.length, start + e.length);
    });
  };

  /* ---------------------------------------------------- hold to record */
  const onMicDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (recording) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const m = mode;
    press.current = {
      x: e.clientX,
      y: e.clientY,
      t: Date.now(),
      timer: window.setTimeout(() => {
        rec
          .start(m)
          .then((ok) => ok && useChats.getState().sendTyping(chatId, m === 'voice' ? 'recording' : 'video'))
          .catch((err: Error) => toast(err.message, 'error'));
      }, 180),
    };
  };
  const onMicMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!press.current || locked || rec.state !== 'recording') return;
    const dx = Math.min(0, e.clientX - press.current.x);
    const dy = Math.min(0, e.clientY - press.current.y);
    setDrag({ x: dx, y: dy });
    if (dx < -130) {
      press.current = null;
      void finishRecording(false);
    } else if (dy < -80) {
      setLocked(true);
      setDrag({ x: 0, y: 0 });
      navigator.vibrate?.(12);
    }
  };
  const onMicUp = () => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    window.clearTimeout(p.timer);
    if (Date.now() - p.t < 180 && rec.state === 'idle') {
      setMode((m) => (m === 'voice' ? 'video_note' : 'voice'));
      return;
    }
    if (locked) return;
    void finishRecording(true);
  };

  const hasText = text.trim().length > 0;
  const action: 'send' | 'edit' | 'record' = editing ? 'edit' : hasText ? 'send' : 'record';
  const banner = editing ?? reply;
  const bannerSender = banner ? users[banner.sender_id] : undefined;
  const level = rec.level;

  return (
    <div className="composer-wrap">
      <AnimatePresence>
        {emoji && <EmojiPanel onPick={insertEmoji} onClose={() => setEmoji(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {rec.kind === 'video_note' && rec.stream && (
          <motion.div className="note-preview" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}>
            <video
              autoPlay
              muted
              playsInline
              ref={(v) => {
                if (v && v.srcObject !== rec.stream) v.srcObject = rec.stream;
              }}
            />
            <svg viewBox="0 0 300 300" className="note-preview-ring">
              <circle cx="150" cy="150" r="146" strokeDasharray={917} strokeDashoffset={917 * (1 - Math.min(1, rec.elapsed / MAX_NOTE))} />
            </svg>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="composer-row">
        <motion.div className={`composer ${recording ? 'recording' : ''}`} layout transition={{ type: 'spring', stiffness: 500, damping: 40 }}>
          <AnimatePresence initial={false}>
            {banner && !recording && (
              <motion.div className="composer-banner" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                <div className="composer-banner-inner" style={{ ['--q' as string]: nameColor(banner.sender_id) }}>
                  {editing ? <Pencil size={18} className="accent-text" /> : <Reply size={18} className="accent-text" />}
                  <div className="banner-text" onClick={() => void useChats.getState().jumpTo(chatId, banner.id)}>
                    <div className="banner-title">{editing ? 'Редактирование' : `Ответ ${bannerSender?.display_name ?? ''}`}</div>
                    <div className="banner-body ellipsis">
                      {banner.text ? stripMarkup(banner.text) : attachmentLabel(banner.attachments[0], banner.attachments.length)}
                    </div>
                  </div>
                  <button
                    className="icon-btn small"
                    onClick={() => {
                      if (editing) {
                        useChats.getState().setEditing(chatId, null);
                        setText('');
                      } else useChats.getState().setReply(chatId, null);
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {recording ? (
            <div className="rec-strip">
              <span className="rec-dot" />
              <span className="rec-time">{duration(rec.elapsed)}</span>
              {locked ? (
                <div className="rec-wave">
                  {levels.map((l, i) => (
                    <span key={i} style={{ height: `${Math.max(10, l * 100)}%` }} />
                  ))}
                </div>
              ) : (
                <motion.div className="rec-hint" style={{ x: drag.x * 0.6, opacity: 1 + drag.x / 160 }}>
                  <ChevronLeft size={16} /> Влево — отмена
                </motion.div>
              )}
              {locked && (
                <button className="icon-btn danger" onClick={() => void finishRecording(false)} title="Удалить запись">
                  <Trash2 size={19} />
                </button>
              )}
            </div>
          ) : (
            <div className="composer-main">
              <div className="attach-anchor">
                <button className="icon-btn" onClick={() => setAttach((v) => !v)} title="Прикрепить">
                  <Paperclip size={21} />
                </button>
                <AnimatePresence>
                  {attach && (
                    <motion.div
                      className="attach-menu"
                      initial={{ opacity: 0, y: 10, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.9 }}
                      onMouseLeave={() => setAttach(false)}
                    >
                      <button onClick={() => { setAttach(false); photoInput.current?.click(); }}>
                        <span className="attach-ico photo"><ImageIcon size={18} /></span> Фото или видео
                      </button>
                      <button onClick={() => { setAttach(false); fileInput.current?.click(); }}>
                        <span className="attach-ico file"><FileText size={18} /></span> Файл
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <textarea
                ref={taRef}
                rows={1}
                value={text}
                placeholder={chat.type === 'channel' ? 'Публикация…' : 'Сообщение'}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={onKey}
                onPaste={(e) => void onPaste(e)}
              />
              <button className={`icon-btn emoji-toggle ${emoji ? 'on' : ''}`} onClick={() => setEmoji((v) => !v)} title="Эмодзи">
                <Smile size={22} />
              </button>
            </div>
          )}
        </motion.div>

        <div className="action-slot">
          <AnimatePresence>
            {recording && !locked && rec.state === 'recording' && (
              <motion.div className="lock-hint" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: Math.max(-40, drag.y * 0.5) }} exit={{ opacity: 0, y: 20 }}>
                <Lock size={16} />
                <span className="lock-arrow" />
              </motion.div>
            )}
          </AnimatePresence>
          {recording && <span className="level-ring" style={{ transform: `scale(${1.15 + level * 1.1})` }} />}
          <motion.button
            className={`send-orb ${action} ${recording ? 'live' : ''}`}
            animate={{ scale: recording ? 1.35 : 1, x: recording && !locked ? drag.x * 0.25 : 0, y: recording && !locked ? drag.y * 0.25 : 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            whileTap={action !== 'record' ? { scale: 0.9 } : undefined}
            onClick={() => {
              if (locked) void finishRecording(true);
              else if (action !== 'record') submit();
            }}
            onPointerDown={action === 'record' && !locked ? onMicDown : undefined}
            onPointerMove={action === 'record' ? onMicMove : undefined}
            onPointerUp={action === 'record' ? onMicUp : undefined}
            onPointerCancel={action === 'record' ? onMicUp : undefined}
            onContextMenu={(e) => e.preventDefault()}
            title={action === 'record' ? (mode === 'voice' ? 'Удерживайте для голосового · нажмите для видео' : 'Удерживайте для видео · нажмите для голоса') : 'Отправить'}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={locked ? 'send' : action === 'record' ? mode : action}
                className="orb-icon"
                initial={{ scale: 0.3, rotate: -90, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                exit={{ scale: 0.3, rotate: 90, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 600, damping: 30 }}
              >
                {locked ? <ArrowUp size={22} strokeWidth={2.6} /> : action === 'send' ? <ArrowUp size={22} strokeWidth={2.6} /> : action === 'edit' ? <Check size={22} strokeWidth={2.8} /> : mode === 'voice' ? <Mic size={22} /> : <Video size={22} />}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        </div>
      </div>

      <input ref={photoInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { void pickFiles(e.target.files, false); e.target.value = ''; }} />
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { void pickFiles(e.target.files, true); e.target.value = ''; }} />
    </div>
  );
}
