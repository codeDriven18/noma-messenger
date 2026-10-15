import { AnimatePresence, motion } from 'framer-motion';
import { Lock, Mic, MicOff, Minimize2, MonitorUp, PhoneOff, SwitchCamera, Video, VideoOff } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { avatarGradient } from '../../lib/colors';
import { useCall } from '../../store/call';
import { useChats } from '../../store/chats';
import { UserAvatar } from '../ui/Avatar';
import { Portal } from '../ui/primitives';
import { useCallTimer } from './Island';

function StreamVideo({ stream, muted, mirror, className }: { stream: MediaStream | null; muted?: boolean; mirror?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (v && v.srcObject !== stream) {
      v.srcObject = stream;
      if (stream) void v.play().catch(() => undefined);
    }
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={`${className ?? ''} ${mirror ? 'mirror' : ''}`} />;
}

function RemoteAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = ref.current;
    if (a && a.srcObject !== stream) {
      a.srcObject = stream;
      if (stream) void a.play().catch(() => undefined);
    }
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

export function CallScreen() {
  const call = useCall();
  const users = useChats((s) => s.users);
  const timer = useCallTimer();
  const constraints = useRef<HTMLDivElement>(null);
  const visible = call.phase !== 'idle' && call.phase !== 'incoming' && !call.minimized;
  const live = call.phase !== 'idle' && call.phase !== 'incoming' && call.phase !== 'ended';
  const peer = call.peerId ? users[call.peerId] : undefined;
  const remoteVideo = (call.remote.cam || call.remote.screen) && call.remoteStream?.getVideoTracks().length;
  const localVideo = (call.cam || call.screen) && call.localStream;

  let status: string;
  if (call.phase === 'ended') status = call.endText;
  else if (call.phase === 'outgoing') status = call.peerOnline ? 'Вызов…' : 'Ожидание ответа…';
  else if (call.phase === 'connecting') status = 'Соединение…';
  else status = timer ?? '';

  return (
    <Portal>
      {live && <RemoteAudio stream={call.remoteStream} />}
      <AnimatePresence>
        {visible && (
          <motion.div
            ref={constraints}
            className={`call-screen ${remoteVideo ? 'has-video' : ''}`}
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96, borderRadius: 40 }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
          >
            <div className="call-bg" style={{ background: peer?.avatar_url ? undefined : avatarGradient(peer?.color ?? 0) }}>
              {peer?.avatar_url && <img src={peer.avatar_url} alt="" />}
            </div>
            <div className="call-glows">
              <span className="glow g1" />
              <span className="glow g2" />
            </div>

            {remoteVideo ? (
              <StreamVideo stream={call.remoteStream} muted className={`remote-video ${call.remote.screen ? 'contain' : ''}`} />
            ) : null}

            <div className="call-top">
              <button className="call-round small" onClick={() => call.setMinimized(true)} title="Свернуть">
                <Minimize2 size={18} />
              </button>
              <div className="call-secure">
                <Lock size={12} /> Звонок зашифрован
              </div>
              <span style={{ width: 44 }} />
            </div>

            <div className={`call-center ${remoteVideo ? 'compact' : ''}`}>
              {!remoteVideo && (
                <div className={`call-avatar ${call.phase === 'outgoing' || call.phase === 'connecting' ? 'ringing' : ''} ${call.phase === 'active' && call.remote.mic ? 'talking' : ''}`}>
                  <span className="ring r1" />
                  <span className="ring r2" />
                  <span className="ring r3" />
                  <UserAvatar user={peer} size={132} />
                </div>
              )}
              <div className="call-name">{peer?.display_name ?? 'Звонок'}</div>
              <motion.div key={status} className="call-status" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                {status}
                {call.phase === 'active' && !call.remote.mic && <span className="call-muted-peer"> · микрофон выключен</span>}
              </motion.div>
            </div>

            {localVideo && (
              <motion.div className="local-pip" drag dragConstraints={constraints} dragElastic={0.15} dragMomentum={false} whileDrag={{ scale: 1.04 }}>
                <StreamVideo stream={call.localStream} muted mirror={!call.screen && call.facing === 'user'} />
              </motion.div>
            )}

            {call.phase !== 'ended' && (
              <motion.div className="call-controls" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }}>
                <ControlButton active={call.screen} onClick={() => void call.toggleScreen()} label="Экран" hideOnMobile>
                  <MonitorUp size={22} />
                </ControlButton>
                <ControlButton active={call.cam} onClick={() => void call.toggleCam()} label="Камера">
                  {call.cam ? <Video size={22} /> : <VideoOff size={22} />}
                </ControlButton>
                {call.cam && (
                  <ControlButton onClick={() => void call.flipCamera()} label="Повернуть" mobileOnly>
                    <SwitchCamera size={22} />
                  </ControlButton>
                )}
                <ControlButton active={call.mic} onClick={() => call.toggleMic()} label={call.mic ? 'Микрофон' : 'Выкл.'} warn={!call.mic}>
                  {call.mic ? <Mic size={22} /> : <MicOff size={22} />}
                </ControlButton>
                <ControlButton onClick={() => call.hangup()} label="Завершить" danger>
                  <PhoneOff size={24} />
                </ControlButton>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Portal>
  );
}

function ControlButton({
  children,
  onClick,
  label,
  active,
  danger,
  warn,
  hideOnMobile,
  mobileOnly,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
  danger?: boolean;
  warn?: boolean;
  hideOnMobile?: boolean;
  mobileOnly?: boolean;
}) {
  return (
    <div className={`call-ctl ${hideOnMobile ? 'hide-mobile' : ''} ${mobileOnly ? 'mobile-only' : ''}`}>
      <motion.button
        className={`call-round ${active ? 'active' : ''} ${danger ? 'hangup' : ''} ${warn ? 'warn' : ''}`}
        whileTap={{ scale: 0.88 }}
        whileHover={{ scale: 1.06 }}
        onClick={onClick}
      >
        {children}
      </motion.button>
      <span>{label}</span>
    </div>
  );
}
