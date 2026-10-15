import ReactDOM from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import '@fontsource-variable/inter';
import './styles/base.css';
import './styles/layout.css';
import './styles/chat.css';
import './styles/overlays.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useSettings } from './store/settings';

function Root() {
  const animations = useSettings((s) => s.animations);
  return (
    <MotionConfig reducedMotion={animations ? 'never' : 'always'}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </MotionConfig>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />);
