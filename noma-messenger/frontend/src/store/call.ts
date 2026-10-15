import { create } from 'zustand';
import type { CallSignal, ServerEvent } from '../api/types';
import { socket } from '../lib/socket';
import { sounds, startRingback, startRingtone, stopLoop } from '../lib/sounds';
import { useChats } from './chats';
import { useSettings } from './settings';
import { toast } from './ui';

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';

interface MediaFlags {
  mic: boolean;
  cam: boolean;
  screen: boolean;
}

interface CallState {
  phase: CallPhase;
  callId: string | null;
  chatId: number | null;
  peerId: number | null;
  direction: 'out' | 'in';
  video: boolean;
  peerOnline: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  mic: boolean;
  cam: boolean;
  screen: boolean;
  remote: MediaFlags;
  startedAt: number | null;
  minimized: boolean;
  endText: string;
  facing: 'user' | 'environment';
  start: (chatId: number, peerId: number, video: boolean) => Promise<void>;
  accept: (withVideo?: boolean) => Promise<void>;
  decline: () => void;
  hangup: () => void;
  toggleMic: () => void;
  toggleCam: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  flipCamera: () => Promise<void>;
  setMinimized: (v: boolean) => void;
  handleEvent: (ev: ServerEvent) => void;
}

let iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
export const setIceServers = (servers: RTCIceServer[]) => {
  if (servers?.length) iceServers = servers;
};

let pc: RTCPeerConnection | null = null;
let local: MediaStream | null = null;
let remote: MediaStream | null = null;
let cameraTrack: MediaStreamTrack | null = null;
let screenTrack: MediaStreamTrack | null = null;
let videoSender: RTCRtpSender | null = null;
let iceQueue: RTCIceCandidateInit[] = [];
let endTimer: number | undefined;

const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const videoConstraints = (facing: 'user' | 'environment'): MediaTrackConstraints => ({
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
  facingMode: facing,
});

const newId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const REASONS: Record<string, string> = {
  declined: 'Звонок отклонён',
  busy: 'Абонент занят',
  timeout: 'Нет ответа',
  hangup: 'Звонок завершён',
  unavailable: 'Звонок недоступен',
  already_in_call: 'Вы уже в звонке',
  disconnected: 'Соединение потеряно',
  failed: 'Не удалось соединиться',
  gone: 'Звонок завершён',
};

function mediaSupported() {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Звонки работают только по HTTPS или на localhost', 'error');
    return false;
  }
  if (typeof RTCPeerConnection === 'undefined') {
    toast('Браузер не поддерживает звонки', 'error');
    return false;
  }
  return true;
}

async function acquire(video: boolean, facing: 'user' | 'environment'): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: video ? videoConstraints(facing) : false });
  } catch (e) {
    if (video) {
      toast('Камера недоступна — продолжаем без видео');
      return navigator.mediaDevices.getUserMedia({ audio: AUDIO });
    }
    throw e;
  }
}

export const useCall = create<CallState>((set, get) => {
  const signal = (data: CallSignal) => {
    const id = get().callId;
    if (id) socket.send({ type: 'call.signal', call_id: id, data });
  };
  const sendMediaState = () => {
    const { mic, cam, screen } = get();
    signal({ type: 'media', mic, cam, screen });
  };
  const refreshLocal = () => set({ localStream: local ? new MediaStream(local.getTracks()) : null });

  const cleanup = () => {
    stopLoop();
    local?.getTracks().forEach((t) => t.stop());
    screenTrack?.stop();
    pc?.close();
    pc = null;
    local = null;
    remote = null;
    cameraTrack = null;
    screenTrack = null;
    videoSender = null;
    iceQueue = [];
  };

  const finish = (text: string) => {
    if (get().phase === 'idle') return;
    cleanup();
    window.clearTimeout(endTimer);
    if (!text) {
      set(initial());
      return;
    }
    sounds.callEnd();
    set({ phase: 'ended', endText: text, localStream: null, remoteStream: null, minimized: false });
    endTimer = window.setTimeout(() => {
      if (get().phase === 'ended') set(initial());
    }, 1800);
  };

  const createPeer = () => {
    const peer = new RTCPeerConnection({ iceServers });
    pc = peer;
    remote = new MediaStream();
    set({ remoteStream: remote });
    peer.ontrack = (e) => {
      if (pc !== peer || !remote) return;
      if (!remote.getTracks().includes(e.track)) remote.addTrack(e.track);
      set({ remoteStream: new MediaStream(remote.getTracks()) });
    };
    peer.onicecandidate = (e) => {
      if (e.candidate) signal({ type: 'ice', candidate: e.candidate.toJSON() });
    };
    peer.onconnectionstatechange = () => {
      if (pc !== peer) return;
      if (peer.connectionState === 'connected') {
        stopLoop();
        if (get().phase !== 'active') set({ phase: 'active', startedAt: get().startedAt ?? Date.now() });
      } else if (peer.connectionState === 'failed') {
        const id = get().callId;
        if (id) socket.send({ type: 'call.end', call_id: id });
        finish(REASONS.failed);
      }
    };
    return peer;
  };

  const flushIce = async () => {
    if (!pc?.remoteDescription) return;
    const queued = iceQueue;
    iceQueue = [];
    for (const c of queued) await pc.addIceCandidate(c).catch(() => undefined);
  };

  const onSignal = async (data: CallSignal) => {
    if (data.type === 'media') {
      set({ remote: { mic: data.mic, cam: data.cam, screen: data.screen } });
      return;
    }
    if (data.type === 'ice') {
      if (pc?.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => undefined);
      else iceQueue.push(data.candidate);
      return;
    }
    if (data.type === 'offer' && pc && local) {
      await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      const audioTrack = local.getAudioTracks()[0] ?? null;
      for (const t of pc.getTransceivers()) {
        const kind = t.receiver.track?.kind;
        if (kind === 'audio') {
          await t.sender.replaceTrack(audioTrack);
          t.direction = 'sendrecv';
        } else if (kind === 'video') {
          await t.sender.replaceTrack(screenTrack ?? cameraTrack);
          t.direction = 'sendrecv';
          videoSender = t.sender;
        }
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signal({ type: 'answer', sdp: answer.sdp ?? '' });
      await flushIce();
      sendMediaState();
      return;
    }
    if (data.type === 'answer' && pc) {
      await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      await flushIce();
    }
  };

  const startAsCaller = async () => {
    if (!local) return;
    const peer = createPeer();
    const audioTrack = local.getAudioTracks()[0];
    peer.addTransceiver(audioTrack ?? 'audio', { direction: 'sendrecv', streams: [local] });
    const vt = peer.addTransceiver(screenTrack ?? cameraTrack ?? 'video', { direction: 'sendrecv', streams: [local] });
    videoSender = vt.sender;
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    signal({ type: 'offer', sdp: offer.sdp ?? '' });
    sendMediaState();
  };

  const initial = () => ({
    phase: 'idle' as CallPhase,
    callId: null,
    chatId: null,
    peerId: null,
    direction: 'out' as const,
    video: false,
    peerOnline: true,
    localStream: null,
    remoteStream: null,
    mic: true,
    cam: false,
    screen: false,
    remote: { mic: true, cam: false, screen: false },
    startedAt: null,
    minimized: false,
    endText: '',
  });

  return {
    ...initial(),
    facing: 'user',

    async start(chatId, peerId, video) {
      if (get().phase !== 'idle' && get().phase !== 'ended') {
        toast('Сначала завершите текущий звонок');
        return;
      }
      if (!mediaSupported()) return;
      window.clearTimeout(endTimer);
      cleanup();
      const callId = newId();
      set({ ...initial(), phase: 'outgoing', callId, chatId, peerId, direction: 'out', video, cam: video });
      startRingback();
      try {
        local = await acquire(video, get().facing);
      } catch {
        toast('Нет доступа к микрофону', 'error');
        set(initial());
        stopLoop();
        return;
      }
      if (get().callId !== callId) {
        local.getTracks().forEach((t) => t.stop());
        return;
      }
      cameraTrack = local.getVideoTracks()[0] ?? null;
      set({ cam: !!cameraTrack });
      refreshLocal();
      if (!socket.send({ type: 'call.invite', call_id: callId, chat_id: chatId, video })) {
        finish('Нет соединения с сервером');
      }
    },

    async accept(withVideo) {
      const { callId, phase, video } = get();
      if (!callId || phase !== 'incoming') return;
      if (!mediaSupported()) return;
      stopLoop();
      set({ phase: 'connecting' });
      try {
        local = await acquire(withVideo ?? video, get().facing);
      } catch {
        toast('Нет доступа к микрофону', 'error');
        get().decline();
        return;
      }
      cameraTrack = local.getVideoTracks()[0] ?? null;
      set({ cam: !!cameraTrack, startedAt: null });
      refreshLocal();
      createPeer();
      socket.send({ type: 'call.accept', call_id: callId });
    },

    decline() {
      const id = get().callId;
      if (id) socket.send({ type: 'call.reject', call_id: id });
      finish('');
    },

    hangup() {
      const id = get().callId;
      if (id) socket.send({ type: 'call.end', call_id: id });
      finish(REASONS.hangup);
    },

    toggleMic() {
      const track = local?.getAudioTracks()[0];
      if (!track) return;
      track.enabled = !track.enabled;
      set({ mic: track.enabled });
      sendMediaState();
    },

    async toggleCam() {
      if (!local) return;
      if (get().cam && cameraTrack) {
        cameraTrack.stop();
        local.removeTrack(cameraTrack);
        cameraTrack = null;
        if (!get().screen) await videoSender?.replaceTrack(null);
        set({ cam: false });
      } else {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(get().facing) });
          cameraTrack = s.getVideoTracks()[0];
          local.addTrack(cameraTrack);
          if (!get().screen) await videoSender?.replaceTrack(cameraTrack);
          set({ cam: true });
        } catch {
          toast('Камера недоступна', 'error');
          return;
        }
      }
      refreshLocal();
      sendMediaState();
    },

    async toggleScreen() {
      if (get().screen) {
        screenTrack?.stop();
        screenTrack = null;
        await videoSender?.replaceTrack(cameraTrack);
        set({ screen: false });
      } else {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          toast('Демонстрация экрана не поддерживается');
          return;
        }
        try {
          const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
          screenTrack = s.getVideoTracks()[0];
          screenTrack.onended = () => {
            if (get().screen) void get().toggleScreen();
          };
          await videoSender?.replaceTrack(screenTrack);
          set({ screen: true });
        } catch {
          return;
        }
      }
      sendMediaState();
    },

    async flipCamera() {
      const facing = get().facing === 'user' ? 'environment' : 'user';
      set({ facing });
      if (!get().cam || !local) return;
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(facing) });
        const track = s.getVideoTracks()[0];
        if (cameraTrack) {
          cameraTrack.stop();
          local.removeTrack(cameraTrack);
        }
        cameraTrack = track;
        local.addTrack(track);
        if (!get().screen) await videoSender?.replaceTrack(track);
        refreshLocal();
      } catch {
        toast('Не удалось переключить камеру');
      }
    },

    setMinimized: (minimized) => set({ minimized }),

    handleEvent(ev) {
      const s = get();
      switch (ev.type) {
        case 'call.incoming': {
          if (s.phase !== 'idle' && s.phase !== 'ended') {
            socket.send({ type: 'call.reject', call_id: ev.call_id });
            return;
          }
          window.clearTimeout(endTimer);
          cleanup();
          set({
            ...initial(),
            phase: 'incoming',
            callId: ev.call_id,
            chatId: ev.chat_id,
            peerId: ev.from_user_id,
            direction: 'in',
            video: ev.video,
          });
          useChats.getState().ensureUsers([ev.from_user_id]);
          startRingtone();
          const caller = useChats.getState().users[ev.from_user_id];
          if (document.hidden && useSettings.getState().notifications && 'Notification' in window && Notification.permission === 'granted') {
            try {
              const n = new Notification(caller?.display_name ?? 'Входящий звонок', {
                body: ev.video ? 'Входящий видеозвонок' : 'Входящий звонок',
                icon: '/favicon.svg',
                tag: `call-${ev.call_id}`,
                requireInteraction: true,
              });
              n.onclick = () => {
                window.focus();
                n.close();
              };
            } catch {
              /* ignore */
            }
          }
          break;
        }
        case 'call.ringing':
          if (ev.call_id === s.callId) set({ peerOnline: ev.peer_online });
          break;
        case 'call.accepted':
          if (ev.call_id === s.callId && s.direction === 'out') {
            stopLoop();
            set({ phase: 'connecting' });
            void startAsCaller().catch(() => get().hangup());
          }
          break;
        case 'call.signal':
          if (ev.call_id === s.callId) void onSignal(ev.data).catch((e) => console.error('signal failed', e));
          break;
        case 'call.ended':
          if (ev.call_id === s.callId) {
            finish(ev.reason === 'answered_elsewhere' ? '' : REASONS[ev.reason] ?? REASONS.hangup);
          }
          break;
        default:
          break;
      }
    },
  };
});

window.addEventListener('beforeunload', () => {
  const { callId, phase } = useCall.getState();
  if (callId && phase !== 'idle' && phase !== 'ended') {
    socket.send({ type: phase === 'incoming' ? 'call.reject' : 'call.end', call_id: callId });
  }
});
