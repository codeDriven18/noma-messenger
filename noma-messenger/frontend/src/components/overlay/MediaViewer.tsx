import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Download, Forward, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { dayLabel, timeHM } from '../../lib/format';
import { downloadUrl } from '../../lib/media';
import { useChats } from '../../store/chats';
import { useUI, type ViewerItem } from '../../store/ui';
import { UserAvatar } from '../ui/Avatar';
import { Portal } from '../ui/primitives';
import { src } from '../message/MessageParts';

export function MediaViewer() {
  const viewer = useUI((s) => s.viewer);
  return (
    <Portal>
      <AnimatePresence>{viewer && <ViewerBody key="viewer" viewer={viewer} />}</AnimatePresence>
    </Portal>
  );
}

function ViewerBody({ viewer }: { viewer: { items: ViewerItem[]; index: number } }) {
  const close = useUI((s) => s.closeViewer);
  const users = useChats((s) => s.users);
  const [index, setIndex] = useState(viewer.index);
  const [dir, setDir] = useState(0);
  const [zoom, setZoom] = useState(1);
  const item = viewer.items[index];
  const count = viewer.items.length;

  const go = (d: number) => {
    const next = index + d;
    if (next < 0 || next >= count) return;
    setDir(d);
    setZoom(1);
    setIndex(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!item) return null;
  const sender = users[item.message.sender_id];
  const a = item.attachment;

  return (
    <motion.div className="viewer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
      <div className="viewer-top" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-who">
          <UserAvatar user={sender} size={38} />
          <div>
            <div className="viewer-name">{sender?.display_name ?? ''}</div>
            <div className="viewer-date">
              {dayLabel(item.message.created_at)} в {timeHM(item.message.created_at)}
            </div>
          </div>
        </div>
        <div className="viewer-count">{count > 1 ? `${index + 1} из ${count}` : ''}</div>
        <div className="viewer-actions">
          <button className="icon-btn" title="Переслать" onClick={() => { close(); useUI.getState().openModal({ kind: 'forward', messageIds: [item.message.id] }); }}>
            <Forward size={20} />
          </button>
          <button className="icon-btn" title="Скачать" onClick={() => downloadUrl(src(a.url), a.name)}>
            <Download size={20} />
          </button>
          <button className="icon-btn" title="Закрыть" onClick={close}>
            <X size={22} />
          </button>
        </div>
      </div>

      <div className="viewer-stage">
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={a.url}
            className="viewer-media"
            custom={dir}
            initial={{ opacity: 0, x: dir * 80, scale: 0.94 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: dir * -80, scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            drag={zoom === 1 ? 'x' : true}
            dragSnapToOrigin={zoom === 1}
            onDragEnd={(_, info) => {
              if (zoom !== 1) return;
              if (info.offset.x < -90) go(1);
              else if (info.offset.x > 90) go(-1);
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {a.kind === 'video' ? (
              <video src={src(a.url)} controls autoPlay playsInline className="viewer-el" />
            ) : (
              <motion.img
                src={src(a.url)}
                alt=""
                className="viewer-el"
                draggable={false}
                animate={{ scale: zoom }}
                onDoubleClick={() => setZoom((z) => (z === 1 ? 2.2 : 1))}
                onWheel={(e) => setZoom((z) => Math.max(1, Math.min(4, z - e.deltaY * 0.002)))}
              />
            )}
          </motion.div>
        </AnimatePresence>
        {index > 0 && (
          <button className="viewer-nav left" onClick={(e) => { e.stopPropagation(); go(-1); }}>
            <ChevronLeft size={28} />
          </button>
        )}
        {index < count - 1 && (
          <button className="viewer-nav right" onClick={(e) => { e.stopPropagation(); go(1); }}>
            <ChevronRight size={28} />
          </button>
        )}
      </div>

      {item.message.text && <div className="viewer-caption" onClick={(e) => e.stopPropagation()}>{item.message.text}</div>}

      {count > 1 && (
        <div className="viewer-strip" onClick={(e) => e.stopPropagation()}>
          {viewer.items.map((it, i) => (
            <button key={it.attachment.url} className={i === index ? 'active' : ''} onClick={() => { setDir(i > index ? 1 : -1); setIndex(i); setZoom(1); }}>
              {it.attachment.kind === 'video' && !it.attachment.thumb ? (
                <video src={`${src(it.attachment.url)}#t=0.1`} muted preload="metadata" />
              ) : (
                <img src={src(it.attachment.thumb ?? it.attachment.url)} alt="" />
              )}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
