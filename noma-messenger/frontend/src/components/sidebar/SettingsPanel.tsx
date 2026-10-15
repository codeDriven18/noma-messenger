import { motion } from 'framer-motion';
import { Bell, Check, ChevronRight, Keyboard, KeyRound, LogOut, Monitor, Sparkles, Volume2, Zap } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { api } from '../../api/client';
import { ACCENTS } from '../../lib/colors';
import { useAuth } from '../../store/auth';
import { type Wallpaper, useSettings } from '../../store/settings';
import { toast, useUI } from '../../store/ui';
import { UserAvatar } from '../ui/Avatar';
import { Switch } from '../ui/primitives';
import { LargeTitle } from './Nav';

const WALLPAPERS: { id: Wallpaper; name: string }[] = [
  { id: 'ambient', name: 'Эмбиент' },
  { id: 'black', name: 'Чёрный' },
  { id: 'dots', name: 'Точки' },
  { id: 'grid', name: 'Сетка' },
];

function Row({ icon, label, children, onClick }: { icon: ReactNode; label: string; children?: ReactNode; onClick?: () => void }) {
  return (
    <div className={`set-row ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <span className="set-icon">{icon}</span>
      <span className="set-label">{label}</span>
      <span className="set-value">{children ?? (onClick ? <ChevronRight size={18} /> : null)}</span>
    </div>
  );
}

export function SettingsPanel() {
  const me = useAuth((s) => s.me!);
  const logout = useAuth((s) => s.logout);
  const s = useSettings();
  const openModal = useUI((st) => st.openModal);
  const [pwOpen, setPwOpen] = useState(false);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const desktop = window.matchMedia('(min-width: 900px)').matches;

  const toggleNotifications = async (v: boolean) => {
    if (v && 'Notification' in window && Notification.permission === 'default') {
      const res = await Notification.requestPermission();
      if (res !== 'granted') toast('Браузер запретил уведомления');
    }
    s.set({ notifications: v });
  };

  const changePassword = async () => {
    try {
      await api.changePassword(oldPw, newPw);
      toast('Пароль изменён', 'success');
      setPwOpen(false);
      setOldPw('');
      setNewPw('');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <motion.div className="panel settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      <LargeTitle title="Настройки" />
      <div className="settings-scroll">
        <button className="profile-row" onClick={() => openModal({ kind: 'editProfile' })}>
          <UserAvatar user={{ ...me, online: false }} size={60} />
          <div className="profile-row-text">
            <div className="profile-row-name">{me.display_name}</div>
            <div className="profile-row-sub">@{me.username}{me.bio ? ` · ${me.bio}` : ''}</div>
          </div>
          <ChevronRight size={20} className="chev" />
        </button>

        <div className="set-group-title">Оформление</div>
        <div className="set-group">
          <div className="set-block">
            <div className="preview-chat">
              <div className="bubble-preview in">Как тебе новый NOMA?</div>
              <div className="bubble-preview out">Чисто. Как iPhone 🖤</div>
            </div>
            <div className="set-block-label">Акцент</div>
            <div className="swatches">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  className={`swatch ${s.accent === a.id ? 'active' : ''}`}
                  style={{ background: a.color, color: a.on }}
                  title={a.name}
                  onClick={() => s.set({ accent: a.id })}
                >
                  {s.accent === a.id && <Check size={15} strokeWidth={3} />}
                </button>
              ))}
            </div>
          </div>
          <div className="set-block">
            <div className="set-block-label">Фон чата</div>
            <div className="wallpapers">
              {WALLPAPERS.map((w) => (
                <button key={w.id} className={`wallpaper-thumb wp-${w.id} ${s.wallpaper === w.id ? 'active' : ''}`} onClick={() => s.set({ wallpaper: w.id })}>
                  <span>{w.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="set-block">
            <label className="slider-row">
              <span>Текст</span>
              <input type="range" min={14} max={20} value={s.fontSize} onChange={(e) => s.set({ fontSize: Number(e.target.value) })} />
              <b>{s.fontSize}</b>
            </label>
            <label className="slider-row">
              <span>Скругление</span>
              <input type="range" min={8} max={24} value={s.radius} onChange={(e) => s.set({ radius: Number(e.target.value) })} />
              <b>{s.radius}</b>
            </label>
          </div>
          {desktop && (
            <div className="set-row">
              <span className="set-icon">
                <Monitor size={17} />
              </span>
              <span className="set-label">На компьютере</span>
              <div className="segmented inline">
                {(['phone', 'wide'] as const).map((l) => (
                  <button key={l} className={s.layout === l ? 'active' : ''} onClick={() => s.set({ layout: l })}>
                    {s.layout === l && <motion.span layoutId="layout-seg" className="seg-pill" />}
                    <span className="seg-label">{l === 'phone' ? 'Телефон' : 'Широкий'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <Row icon={<Zap size={17} />} label="Анимации">
            <Switch checked={s.animations} onChange={(v) => s.set({ animations: v })} />
          </Row>
          <Row icon={<Sparkles size={17} />} label="Живой фон">
            <Switch checked={s.liveChat} onChange={(v) => s.set({ liveChat: v })} />
          </Row>
        </div>
        <div className="set-hint">Живой фон мягко светится, когда собеседник печатает.</div>

        <div className="set-group-title">Уведомления</div>
        <div className="set-group">
          <Row icon={<Bell size={17} />} label="Уведомления">
            <Switch checked={s.notifications} onChange={(v) => void toggleNotifications(v)} />
          </Row>
          <Row icon={<Volume2 size={17} />} label="Звуки">
            <Switch checked={s.sounds} onChange={(v) => s.set({ sounds: v })} />
          </Row>
        </div>

        <div className="set-group-title">Чаты</div>
        <div className="set-group">
          <Row icon={<Keyboard size={17} />} label="Отправка по Enter">
            <Switch checked={s.sendOnEnter} onChange={(v) => s.set({ sendOnEnter: v })} />
          </Row>
        </div>
        <div className="set-hint">{s.sendOnEnter ? 'Shift + Enter — новая строка.' : 'Ctrl + Enter — отправить сообщение.'}</div>

        <div className="set-group-title">Безопасность</div>
        <div className="set-group">
          <Row icon={<KeyRound size={17} />} label="Сменить пароль" onClick={() => setPwOpen((v) => !v)} />
          {pwOpen && (
            <div className="set-block pw-form">
              <input className="input dark" type="password" placeholder="Текущий пароль" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
              <input className="input dark" type="password" placeholder="Новый пароль (от 6 символов)" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
              <button className="btn-primary" disabled={!oldPw || newPw.length < 6} onClick={() => void changePassword()}>
                Сохранить
              </button>
            </div>
          )}
        </div>

        {desktop && (
          <>
            <div className="set-group-title">Горячие клавиши</div>
            <div className="set-group shortcuts">
              <div>
                <span>Быстрый поиск</span> <kbd>Ctrl</kbd> <kbd>K</kbd>
              </div>
              <div>
                <span>Изменить последнее</span> <kbd>↑</kbd>
              </div>
              <div>
                <span>Реакция ❤️</span> <kbd>Двойной клик</kbd>
              </div>
            </div>
          </>
        )}

        <div className="set-group logout">
          <button className="set-row clickable danger-row" onClick={logout}>
            <LogOut size={18} /> Выйти
          </button>
        </div>
        <div className="set-footer">NOMA 1.0</div>
      </div>
    </motion.div>
  );
}
