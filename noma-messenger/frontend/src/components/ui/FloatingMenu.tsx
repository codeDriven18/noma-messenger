import { AnimatePresence, motion } from 'framer-motion';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { stageRect, toStage } from '../../lib/stage';
import { Portal } from './primitives';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onClick: () => void;
}

interface Props {
  at: { x: number; y: number } | null;
  items: MenuItem[];
  onClose: () => void;
}

export function FloatingMenu({ at, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!at || !ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    const stage = stageRect();
    const local = toStage(at.x, at.y);
    setPos({
      x: Math.max(8, Math.min(local.x, stage.width - width - 8)),
      y: Math.max(8, Math.min(local.y, stage.height - height - 8)),
    });
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [at, onClose]);

  return (
    <Portal>
      <AnimatePresence>
        {at && (
          <motion.div
            ref={ref}
            className="floating-menu"
            style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? 'visible' : 'hidden' }}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 600, damping: 36 }}
          >
            {items.map((it) => (
              <button
                key={it.label}
                className={`menu-item ${it.danger ? 'danger' : ''}`}
                onClick={() => {
                  onClose();
                  it.onClick();
                }}
              >
                {it.icon}
                <span>{it.label}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </Portal>
  );
}
