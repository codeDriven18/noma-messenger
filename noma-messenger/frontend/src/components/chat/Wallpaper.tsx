import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../../store/auth';
import { useChats } from '../../store/chats';
import { useSettings } from '../../store/settings';

/**
 * Chat background: two slow ambient glows on true black. When the other
 * side types, a soft light rises from the bottom; a new message sends a
 * quiet ripple through it.
 */
export function Wallpaper() {
  const live = useSettings((s) => s.liveChat);
  const activeId = useChats((s) => s.activeId);
  const pulse = useChats((s) => s.pulse);
  const me = useAuth((s) => s.me?.id ?? 0);
  const typing = useChats((s) => (activeId ? Object.keys(s.typing[activeId] ?? {}).filter((k) => Number(k) !== me).length > 0 : false));

  return (
    <div className={`wallpaper ${live && typing ? 'typing' : ''}`}>
      <div className="wp-glows">
        <span className="glow g1" />
        <span className="glow g2" />
      </div>
      <div className="wp-pattern" />
      <div className="wp-glow" />
      <AnimatePresence>
        {live && pulse > 0 && (
          <motion.span
            key={pulse}
            className="wp-ripple"
            initial={{ scale: 0.3, opacity: 0.4 }}
            animate={{ scale: 2.4, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
