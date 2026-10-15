import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { useUI } from '../../store/ui';
import { Portal } from '../ui/primitives';

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  return (
    <Portal>
      <div className="toasts">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              className={`toast ${t.tone ?? 'info'}`}
              initial={{ opacity: 0, y: 24, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 520, damping: 34 }}
            >
              {t.tone === 'error' ? <AlertCircle size={18} /> : t.tone === 'success' ? <CheckCircle2 size={18} /> : <Info size={18} />}
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Portal>
  );
}
