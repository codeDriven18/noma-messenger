import { motion } from 'framer-motion';
import { MessageCircle, Phone, Settings, Smartphone } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../../store/auth';
import { useChats } from '../../store/chats';
import { useSettings } from '../../store/settings';
import { type Tab, useUI } from '../../store/ui';
import { UserAvatar } from '../ui/Avatar';
import { Logo, spring } from '../ui/primitives';

const TABS: { id: Tab; label: string; icon: typeof MessageCircle }[] = [
  { id: 'chats', label: 'Чаты', icon: MessageCircle },
  { id: 'calls', label: 'Звонки', icon: Phone },
  { id: 'settings', label: 'Настройки', icon: Settings },
];

function useUnreadTotal() {
  return useChats((s) =>
    Object.values(s.chats).reduce((n, c) => n + (c.my_role !== null && !c.muted && !c.archived ? Math.min(c.unread_count, 1) : 0), 0),
  );
}

/** iOS large-title header shared by the sidebar panels. */
export function LargeTitle({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="panel-head">
      <div className="panel-bar">{actions && <div className="panel-actions">{actions}</div>}</div>
      <h2 className="panel-title">{title}</h2>
    </header>
  );
}

export function Rail() {
  const tab = useUI((s) => s.tab);
  const setTab = useUI((s) => s.setTab);
  const me = useAuth((s) => s.me);
  const unread = useUnreadTotal();
  const setSettings = useSettings((s) => s.set);
  return (
    <nav className="rail">
      <div className="rail-logo">
        <Logo size={36} />
      </div>
      <div className="rail-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`rail-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)} title={t.label}>
            {tab === t.id && <motion.span layoutId="rail-pill" className="rail-pill" transition={spring} />}
            <t.icon size={22} strokeWidth={tab === t.id ? 2.2 : 1.8} />
            {t.id === 'chats' && unread > 0 && <span className="rail-badge">{unread}</span>}
          </button>
        ))}
      </div>
      <button className="rail-btn" title="Режим телефона" onClick={() => setSettings({ layout: 'phone' })}>
        <Smartphone size={20} strokeWidth={1.8} />
      </button>
      <button className="rail-me" onClick={() => setTab('settings')} title="Профиль">
        <UserAvatar user={me ? { ...me, online: false } : undefined} size={36} />
      </button>
    </nav>
  );
}

export function TabBar() {
  const tab = useUI((s) => s.tab);
  const setTab = useUI((s) => s.setTab);
  const unread = useUnreadTotal();
  return (
    <nav className="tabbar">
      {TABS.map((t) => (
        <button key={t.id} className={`tab-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
          {tab === t.id && <motion.span layoutId="tab-pill" className="tab-pill" transition={spring} />}
          <span className="tab-icon">
            <t.icon size={22} strokeWidth={tab === t.id ? 2.2 : 1.8} />
            {t.id === 'chats' && unread > 0 && <span className="rail-badge">{unread}</span>}
          </span>
          <span className="tab-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
