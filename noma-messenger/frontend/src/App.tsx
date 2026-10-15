import { useEffect } from 'react';
import { AuthScreen } from './components/auth/AuthScreen';
import { Messenger } from './components/Messenger';
import { Stage } from './components/Stage';
import { Logo } from './components/ui/primitives';
import { useAuth } from './store/auth';
import { applySettings, useSettings } from './store/settings';

export default function App() {
  const token = useAuth((s) => s.token);
  const me = useAuth((s) => s.me);
  const settings = useSettings();

  useEffect(() => applySettings(settings), [settings]);

  useEffect(() => {
    if (token && !me) void useAuth.getState().loadMe();
  }, [token, me]);

  return (
    <Stage>
      {!token ? (
        <AuthScreen />
      ) : !me ? (
        <div className="splash">
          <div className="splash-logo">
            <Logo size={72} />
          </div>
        </div>
      ) : (
        <Messenger />
      )}
    </Stage>
  );
}
