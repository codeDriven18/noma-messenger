import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { EMOJI_CATEGORIES } from '../../lib/emoji';

const RECENT_KEY = 'noma.recentEmoji';

export function pushRecent(e: string) {
  try {
    const list: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...list.filter((x) => x !== e)].slice(0, 32)));
  } catch {
    /* ignore */
  }
}

export function EmojiPanel({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [recent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    } catch {
      return [];
    }
  });
  const [active, setActive] = useState(recent.length ? 'recent' : EMOJI_CATEGORIES[0].id);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current?.contains(target) || target.closest('.emoji-toggle')) return;
      onClose();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [onClose]);

  const cats = [...(recent.length ? [{ id: 'recent', icon: '', name: 'Недавние', list: recent }] : []), ...EMOJI_CATEGORIES];

  const jump = (id: string) => {
    setActive(id);
    gridRef.current?.querySelector(`[data-cat="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <motion.div
      ref={ref}
      className="emoji-panel"
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 520, damping: 36 }}
    >
      <div className="emoji-grid" ref={gridRef}>
        {cats.map((c) => (
          <div key={c.id} data-cat={c.id}>
            <div className="emoji-cat-title">{c.name}</div>
            <div className="emoji-cat">
              {c.list.map((e, i) => (
                <button
                  key={`${e}-${i}`}
                  onClick={() => {
                    pushRecent(e);
                    onPick(e);
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="emoji-tabs">
        {cats.map((c) => (
          <button key={c.id} className={active === c.id ? 'active' : ''} onClick={() => jump(c.id)} title={c.name}>
            {c.id === 'recent' ? <Clock size={17} /> : c.icon}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
