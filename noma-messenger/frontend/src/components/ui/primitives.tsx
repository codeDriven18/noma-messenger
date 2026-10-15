import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

export const spring = { type: 'spring', stiffness: 520, damping: 38, mass: 0.9 } as const;
export const softSpring = { type: 'spring', stiffness: 300, damping: 30 } as const;

/** The NOMA glyph: one continuous stroke drawing an N. */
export function Glyph({ size = 20, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M5.5 19V6.2a1 1 0 0 1 1.75-.66l9.5 12.9a1 1 0 0 0 1.75-.66V5" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** App icon: white squircle, black glyph. */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <span className="app-icon" style={{ width: size, height: size, borderRadius: size * 0.28 }}>
      <Glyph size={size * 0.56} color="#000" />
    </span>
  );
}

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      <Glyph size={size * 0.95} />
      noma
    </span>
  );
}

export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`switch ${checked ? 'on' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      <motion.span className="switch-knob" layout transition={spring} />
    </button>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}

export function ProgressRing({ value, size = 48, stroke = 3 }: { value: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="progress-ring">
      <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="progress-ring-bg" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={stroke}
        className="progress-ring-fg"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0.03, Math.min(1, value)))}
      />
    </svg>
  );
}

/** Overlays render inside the device frame so they stay within the "phone" on desktop. */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.getElementById('noma-layer') ?? document.body);
}

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  width?: number;
  footer?: ReactNode;
  left?: ReactNode;
  className?: string;
}

/** iOS sheet: slides up from the bottom on phones, centred card on wide screens. */
export function Sheet({ open, onClose, title, children, width = 440, footer, left, className = '' }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <Portal>
      <AnimatePresence>
        {open && (
          <motion.div className="sheet-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
            <motion.div
              className={`sheet ${className}`}
              style={{ ['--sheet-w' as string]: `${width}px` }}
              initial={{ opacity: 0, y: 60 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 60 }}
              transition={{ type: 'spring', stiffness: 420, damping: 40 }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <span className="sheet-grabber" />
              {title !== undefined && (
                <div className="sheet-head">
                  <div className="sheet-head-side">{left}</div>
                  <div className="sheet-title">{title}</div>
                  <div className="sheet-head-side right">
                    <button className="sheet-close" onClick={onClose} aria-label="Закрыть">
                      <X size={15} strokeWidth={2.6} />
                    </button>
                  </div>
                </div>
              )}
              <div className="sheet-body">{children}</div>
              {footer && <div className="sheet-foot">{footer}</div>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Portal>
  );
}

export function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
      {children}
    </div>
  );
}
