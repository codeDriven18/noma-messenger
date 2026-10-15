import { AnimatePresence, motion } from 'framer-motion';
import { SquarePen, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { socket } from '../lib/socket';
import { useAuth } from '../store/auth';
import { setIceServers, useCall } from '../store/call';
import { useChats } from '../store/chats';
import { useSettings } from '../store/settings';
import { toast, useUI } from '../store/ui';
import { ChatView } from './chat/ChatView';
import { Wallpaper } from './chat/Wallpaper';
import { InfoPanel } from './info/InfoPanel';
import { MessageMenu } from './message/MessageMenu';
import { ModalHost } from './modals/Modals';
import { CallScreen } from './overlay/CallScreen';
import { Island } from './overlay/Island';
import { MediaViewer } from './overlay/MediaViewer';
import { Spotlight } from './overlay/Spotlight';
import { Toasts } from './overlay/Toasts';
import { CallsPanel } from './sidebar/CallsPanel';
import { ChatsPanel } from './sidebar/ChatsPanel';
import { Rail, TabBar } from './sidebar/Nav';
import { SettingsPanel } from './sidebar/SettingsPanel';
import { Logo } from './ui/primitives';

export function Messenger() {
  const token = useAuth((s) => s.token)!;
  const activeId = useChats((s) => s.activeId);
  const tab = useUI((s) => s.tab);
  const infoOpen = useUI((s) => s.infoOpen);
  const [status, setStatus] = useState(socket.status);

  useEffect(() => {
    const off = socket.on((ev) => {
      if (ev.type.startsWith('call.')) useCall.getState().handleEvent(ev);
      else useChats.getState().handleEvent(ev);
    });
    const offStatus = socket.onStatus(setStatus);
    socket.connect(token);
    useChats
      .getState()
      .loadChats()
      .catch((e) => toast((e as Error).message, 'error'));
    api
      .config()
      .then((c) => setIceServers(c.ice_servers))
      .catch(() => undefined);
    return () => {
      off();
      offStatus();
    };
  }, [token]);

  // ask for notification permission on the first interaction
  useEffect(() => {
    const ask = () => {
      if (useSettings.getState().notifications && 'Notification' in window && Notification.permission === 'default') {
        void Notification.requestPermission();
      }
      window.removeEventListener('pointerdown', ask);
    };
    window.addEventListener('pointerdown', ask);
    return () => window.removeEventListener('pointerdown', ask);
  }, []);

  // Escape closes panels; unread counter in the tab title
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const ui = useUI.getState();
      const chats = useChats.getState();
      if (ui.modal || ui.menu || ui.viewer || ui.spotlight) return;
      if (chats.selection.length) chats.clearSelection();
      else if (ui.chatSearch) ui.setChatSearch(false);
      else if (ui.infoOpen) ui.setInfoOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const unsub = useChats.subscribe((s) => {
      const unread = Object.values(s.chats).filter((c) => c.my_role !== null && !c.muted && c.unread_count > 0).length;
      document.title = unread ? `(${unread}) NOMA` : 'NOMA';
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      unsub();
    };
  }, []);

  return (
    <div className={`app ${activeId ? 'chat-open' : ''} ${infoOpen && activeId ? 'info-open' : ''}`}>
      <Rail />
      <aside className="sidebar">
        <AnimatePresence mode="wait" initial={false}>
          {tab === 'chats' ? <ChatsPanel key="chats" /> : tab === 'calls' ? <CallsPanel key="calls" /> : <SettingsPanel key="settings" />}
        </AnimatePresence>
        <TabBar />
      </aside>
      <main className="main">
        <Wallpaper />
        {activeId ? <ChatView key={activeId} chatId={activeId} /> : <Welcome />}
        <AnimatePresence>
          {status === 'offline' && (
            <motion.div className="conn-banner" initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -40, opacity: 0 }}>
              <WifiOff size={14} /> Соединение потеряно — переподключаемся…
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      <AnimatePresence>{infoOpen && activeId && <InfoPanel key={`info-${activeId}`} chatId={activeId} />}</AnimatePresence>

      <Island />
      <CallScreen />
      <MessageMenu />
      <MediaViewer />
      <ModalHost />
      <Spotlight />
      <Toasts />
    </div>
  );
}

function Welcome() {
  return (
    <div className="welcome">
      <motion.div className="welcome-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}>
        <Logo size={72} />
        <h2>Выберите чат</h2>
        <p>или начните новый разговор</p>
        <button className="pill glass" onClick={() => useUI.getState().openModal({ kind: 'newChat' })}>
          <SquarePen size={14} /> Новый чат
        </button>
        <div className="welcome-hint">
          <kbd>Ctrl</kbd> <kbd>K</kbd> — быстрый поиск
        </div>
      </motion.div>
    </div>
  );
}
