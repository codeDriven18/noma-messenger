import { AnimatePresence, motion } from 'framer-motion';
import { AtSign, ChevronLeft, Eye, EyeOff, Lock, Mic, Phone, PhoneOff, User as UserIcon, Video } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../../store/auth';
import { Logo, Spinner, Wordmark } from '../ui/primitives';

type Screen = 'welcome' | 'login' | 'register';

const SLIDES = [
  { title: 'Общение.\nПо-новому.', text: 'Живой мессенджер — быстрый, красивый и без лишнего шума.' },
  { title: 'Звонок. Видео.\nЭкран.', text: 'Звоните напрямую, включайте камеру и показывайте экран — в один тап.' },
  { title: 'Голос, кружки\nи реакции.', text: 'Удерживайте микрофон — и говорите. Двойной тап — и ❤️.' },
];

const screenAnim = {
  initial: (dir: number) => ({ x: dir * 60, opacity: 0 }),
  animate: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir * -60, opacity: 0 }),
};

export function AuthScreen() {
  const [screen, setScreen] = useState<Screen>('welcome');
  const [dir, setDir] = useState(1);
  const go = (s: Screen, d = 1) => {
    setDir(d);
    setScreen(s);
  };
  return (
    <div className="auth">
      <AnimatePresence mode="popLayout" custom={dir} initial={false}>
        <motion.div
          key={screen}
          className="auth-screen"
          custom={dir}
          variants={screenAnim}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ type: 'spring', stiffness: 380, damping: 40 }}
        >
          {screen === 'welcome' ? (
            <Welcome onRegister={() => go('register')} onLogin={() => go('login')} />
          ) : (
            <AuthForm mode={screen} onBack={() => go('welcome', -1)} onSwitch={() => go(screen === 'login' ? 'register' : 'login')} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ welcome */

function Welcome({ onRegister, onLogin }: { onRegister: () => void; onLogin: () => void }) {
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setSlide((s) => (s + 1) % SLIDES.length), 5200);
    return () => window.clearTimeout(t);
  }, [slide]);

  return (
    <>
      <header className="auth-top">
        <Wordmark size={20} />
        <span className="pill glass">RU</span>
      </header>

      <motion.div
        className="onboard"
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.25}
        onDragEnd={(_, info) => {
          if (info.offset.x < -50) setSlide((s) => Math.min(SLIDES.length - 1, s + 1));
          if (info.offset.x > 50) setSlide((s) => Math.max(0, s - 1));
        }}
      >
        <div className="onboard-visual">
          <AnimatePresence mode="wait">
            <motion.div
              key={slide}
              className="visual-frame"
              initial={{ opacity: 0, scale: 0.94, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -6 }}
              transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
            >
              {slide === 0 ? <ChatVisual /> : slide === 1 ? <CallVisual /> : <VoiceVisual />}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="onboard-copy">
          <AnimatePresence mode="wait">
            <motion.div key={slide} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }}>
              <h1 className="onboard-title">{SLIDES[slide].title}</h1>
              <p className="onboard-text">{SLIDES[slide].text}</p>
            </motion.div>
          </AnimatePresence>
          <div className="dots">
            {SLIDES.map((_, i) => (
              <button key={i} className={i === slide ? 'active' : ''} onClick={() => setSlide(i)} aria-label={`Слайд ${i + 1}`}>
                <span />
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      <div className="auth-cta">
        <button className="btn-primary big" onClick={onRegister}>
          Создать аккаунт
        </button>
        <button className="btn-ghost big" onClick={onLogin}>
          У меня уже есть аккаунт
        </button>
      </div>
    </>
  );
}

function ChatVisual() {
  return (
    <div className="v-chat">
      <motion.div className="v-bubble in" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        Привет! Ты уже в NOMA? 👋
      </motion.div>
      <motion.div className="v-bubble out" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }}>
        Да, тут всё летает ⚡
        <span className="v-react">❤️</span>
      </motion.div>
      <motion.div className="v-bubble in typing" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.95 }}>
        <i />
        <i />
        <i />
      </motion.div>
    </div>
  );
}

function CallVisual() {
  return (
    <div className="v-call">
      <div className="v-call-avatar">
        <span className="v-ring r1" />
        <span className="v-ring r2" />
        <span className="v-face">АС</span>
      </div>
      <div className="v-call-name">Алина</div>
      <div className="v-call-sub">Видеозвонок…</div>
      <div className="v-call-btns">
        <span className="v-round red">
          <PhoneOff size={22} />
        </span>
        <span className="v-round glass">
          <Video size={22} />
        </span>
        <span className="v-round green">
          <Phone size={22} />
        </span>
      </div>
    </div>
  );
}

function VoiceVisual() {
  const bars = [6, 12, 18, 10, 22, 16, 8, 20, 14, 24, 12, 6, 16, 20, 10, 18, 8, 14, 22, 12];
  return (
    <div className="v-voice">
      <div className="v-island">
        <span className="v-island-dot">
          <Mic size={12} />
        </span>
        <span className="v-island-time">0:07</span>
        <span className="v-island-bars">
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />
          ))}
        </span>
      </div>
      <div className="v-voice-row">
        <div className="v-circle" />
        <div className="v-bubble out voice">
          <span className="v-play" />
          <span className="v-wave">
            {bars.map((h, i) => (
              <i key={i} style={{ height: h, animationDelay: `${i * 0.05}s` }} />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- form */

function AuthForm({ mode, onBack, onSwitch }: { mode: 'login' | 'register'; onBack: () => void; onSwitch: () => void }) {
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { login, register } = useAuth();
  const isLogin = mode === 'login';
  const valid = username.trim().length >= 4 && password.length >= (isLogin ? 1 : 6) && (isLogin || name.trim().length > 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setError('');
    setBusy(true);
    try {
      if (isLogin) await login(username, password);
      else await register(username, name, password);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit}>
      <header className="auth-top">
        <button type="button" className="nav-back" onClick={onBack}>
          <ChevronLeft size={24} strokeWidth={2.4} />
          Назад
        </button>
      </header>

      <div className="auth-form-body">
        <Logo size={72} />
        <h1 className="auth-title">{isLogin ? 'С возвращением' : 'Создайте аккаунт'}</h1>
        <p className="auth-sub">{isLogin ? 'Войдите в аккаунт NOMA.' : 'Это займёт полминуты.'}</p>

        <div className="group">
          {!isLogin && (
            <label className="group-field">
              <UserIcon size={18} />
              <input placeholder="Как вас зовут" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoFocus />
            </label>
          )}
          <label className="group-field">
            <AtSign size={18} />
            <input
              placeholder="имя пользователя"
              autoComplete="username"
              autoCapitalize="none"
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
              autoFocus={isLogin}
            />
          </label>
          <label className="group-field">
            <Lock size={18} />
            <input
              type={show ? 'text' : 'password'}
              placeholder="Пароль (от 6 символов)"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}>
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </label>
        </div>
        {!isLogin && <p className="auth-note">Латиница, цифры и «_», от 4 символов. Имя пользователя увидят ваши друзья.</p>}

        <AnimatePresence>
          {error && (
            <motion.div className="auth-error" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {error}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="auth-cta sticky">
        <button className="btn-primary big" disabled={!valid || busy}>
          {busy ? <Spinner /> : isLogin ? 'Войти' : 'Продолжить'}
        </button>
        <p className="auth-foot">
          {isLogin ? 'Впервые в NOMA? ' : 'Уже есть аккаунт? '}
          <button type="button" className="link" onClick={onSwitch}>
            {isLogin ? 'Создать аккаунт' : 'Войти'}
          </button>
        </p>
      </div>
    </form>
  );
}
