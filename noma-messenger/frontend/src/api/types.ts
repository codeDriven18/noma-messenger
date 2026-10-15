export interface User {
  id: number;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  color: number;
  is_bot: boolean;
  online: boolean;
  last_seen: string | null;
}

export type ChatType = 'private' | 'group' | 'channel' | 'saved';
export type Role = 'owner' | 'admin' | 'member';

export type AttachmentKind = 'photo' | 'video' | 'file' | 'voice' | 'video_note' | 'audio';

export interface Attachment {
  kind: AttachmentKind;
  url: string;
  name?: string;
  size?: number;
  mime?: string;
  width?: number;
  height?: number;
  duration?: number;
  waveform?: number[];
  thumb?: string;
}

export interface ReplyPreview {
  id: number;
  sender_id: number | null;
  text: string;
  kind: AttachmentKind | null;
  thumb: string | null;
  deleted: boolean;
}

export interface ForwardInfo {
  user_id: number | null;
  name: string;
  chat_id?: number;
}

export interface Reaction {
  emoji: string;
  count: number;
  user_ids: number[];
}

export interface CallInfo {
  video: boolean;
  status: 'ended' | 'missed' | 'declined' | 'busy' | 'cancelled';
  duration: number;
}

export interface Message {
  id: number;
  chat_id: number;
  sender_id: number;
  type: 'text' | 'system' | 'call';
  text: string;
  attachments: Attachment[];
  reply_to: ReplyPreview | null;
  forward: ForwardInfo | null;
  call: CallInfo | null;
  reactions: Reaction[];
  edited_at: string | null;
  created_at: string;
  client_id: string | null;
  // client-only
  status?: 'sending' | 'failed';
  progress?: number;
}

export interface Chat {
  id: number;
  type: ChatType;
  title: string;
  description: string;
  avatar_url: string | null;
  color: number;
  username: string | null;
  is_public: boolean;
  created_by: number | null;
  created_at: string;
  member_ids: number[];
  member_count: number;
  roles: Record<string, Role>;
  my_role: Role | null;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
  last_read_id: number;
  peer_read_id: number;
  unread_count: number;
  last_message: Message | null;
  pinned_message: Message | null;
}

export interface UploadResult {
  url: string;
  name: string;
  size: number;
  mime: string;
}

export interface CallLogEntry extends Message {
  peer_id: number | null;
}

// Realtime events pushed by the server
export type ServerEvent =
  | { type: 'hello'; user_id: number }
  | { type: 'pong' }
  | { type: 'message.new' | 'message.edit'; message: Message }
  | {
      type: 'message.delete';
      chat_id: number;
      message_ids: number[];
      last_message: Message | null;
      pinned_cleared: boolean;
    }
  | {
      type: 'message.reactions';
      chat_id: number;
      message_id: number;
      reactions: Reaction[];
      actor_id: number;
      emoji: string;
      sender_id: number;
    }
  | { type: 'chat.new' | 'chat.update'; chat: Chat; users: User[] }
  | { type: 'chat.removed'; chat_id: number }
  | { type: 'chat.read'; chat_id: number; user_id: number; last_read_id: number }
  | { type: 'chat.pinned'; chat_id: number; message: Message | null }
  | { type: 'chat.settings'; chat_id: number; pinned: boolean; muted: boolean; archived: boolean }
  | { type: 'typing'; chat_id: number; user_id: number; action: TypingAction }
  | { type: 'presence'; user_id: number; online: boolean; last_seen: string }
  | { type: 'user.update'; user: User }
  | { type: 'call.incoming'; call_id: string; chat_id: number; from_user_id: number; video: boolean }
  | { type: 'call.ringing'; call_id: string; peer_online: boolean }
  | { type: 'call.accepted'; call_id: string }
  | { type: 'call.signal'; call_id: string; data: CallSignal }
  | { type: 'call.ended'; call_id: string; reason: string };

export type TypingAction = 'typing' | 'recording' | 'uploading' | 'video' | 'cancel';

export type CallSignal =
  | { type: 'offer' | 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit }
  | { type: 'media'; mic: boolean; cam: boolean; screen: boolean };
