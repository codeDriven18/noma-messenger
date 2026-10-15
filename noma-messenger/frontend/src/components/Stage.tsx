import { motion } from 'framer-motion';
import { Maximize2, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import { type ReactNode, useEffect, useState } from 'react';
import { useSettings } from '../store/settings';
import { Wordmark } from './ui/primitives';

function useQr(text: string) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 1, width: 360, color: { dark: '#000000', light: '#FFFFFF' }, errorCorrectionLevel: 'M' })
      .then(setSrc)
      .catch(() => setSrc(null));
  }, [text]);
  return src;
}

/**
 * The page around the app. On a computer NOMA sits in a phone frame with the
 * brand and a QR code beside it (or fills the window in "wide" mode); on a
 * phone the frame disappears and the app takes the whole screen.
 */
export function Stage({ children }: { children: ReactNode }) {
  const layout = useSettings((s) => s.layout);
  const setSettings = useSettings((s) => s.set);
  const qr = useQr(window.location.origin);

  return (
    <div className="stage" data-layout={layout}>
      <div className="ambient" aria-hidden>
        <span className="glow g1" />
        <span className="glow g2" />
      </div>

      {layout === 'phone' && (
        <motion.aside className="stage-aside" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15, duration: 0.5 }}>
          <Wordmark size={26} />
          <p className="stage-lead">Мессенджер — в новом формате.</p>
          <p className="stage-text">NOMA создан для телефона — отсканируйте код, чтобы открыть его там, или общайтесь прямо здесь.</p>
          {qr && (
            <div className="stage-qr">
              <img src={qr} alt="QR-код для открытия NOMA на телефоне" />
            </div>
          )}
          <p className="stage-hint">
            <Smartphone size={13} /> Наведите камеру телефона на код
          </p>
          <button className="pill glass" onClick={() => setSettings({ layout: 'wide' })}>
            <Maximize2 size={14} /> Во весь экран
          </button>
        </motion.aside>
      )}

      <div className="device">
        {children}
        <div id="noma-layer" />
      </div>
    </div>
  );
}
