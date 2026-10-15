import { Bookmark, Megaphone, Users } from 'lucide-react';
import { memo } from 'react';
import type { Chat, User } from '../../api/types';
import { avatarGradient } from '../../lib/colors';
import { initials } from '../../lib/format';
import { chatTitle, useChats } from '../../store/chats';
import { useAuth } from '../../store/auth';

interface AvatarProps {
  url?: string | null;
  name: string;
  color?: number;
  size?: number;
  round?: boolean;
  online?: boolean;
  icon?: 'saved' | 'group' | 'channel' | null;
  ring?: boolean;
  className?: string;
}

export const Avatar = memo(function Avatar({ url, name, color = 0, size = 48, round = true, online, icon, ring, className = '' }: AvatarProps) {
  const radius = round ? '50%' : `${Math.round(size * 0.32)}px`;
  return (
    <div
      className={`avatar ${ring ? 'avatar-ring' : ''} ${className}`}
      style={{ width: size, height: size, ['--r' as string]: radius }}
    >
      <div className="avatar-face" style={{ background: url ? undefined : avatarGradient(color), borderRadius: radius }}>
        {url ? (
          <img src={url} alt="" draggable={false} loading="lazy" />
        ) : icon === 'saved' ? (
          <Bookmark size={size * 0.42} strokeWidth={2.2} fill="currentColor" />
        ) : (
          <span style={{ fontSize: size * 0.38 }}>{initials(name)}</span>
        )}
      </div>
      {online && <span className="avatar-online" style={{ width: Math.max(10, size * 0.26), height: Math.max(10, size * 0.26) }} />}
    </div>
  );
});

export function UserAvatar({ user, size, ring }: { user: User | undefined; size?: number; ring?: boolean }) {
  return (
    <Avatar
      url={user?.avatar_url}
      name={user?.display_name ?? '?'}
      color={user?.color ?? 0}
      size={size}
      online={user?.online && !user.is_bot}
      ring={ring}
    />
  );
}

export function ChatAvatar({ chat, size = 48, showOnline = true }: { chat: Chat | undefined; size?: number; showOnline?: boolean }) {
  const users = useChats((s) => s.users);
  const me = useAuth((s) => s.me?.id ?? 0);
  if (!chat) return <Avatar name="?" size={size} />;
  if (chat.type === 'saved') return <Avatar name="Избранное" color={1} size={size} icon="saved" />;
  if (chat.type === 'private') {
    const peer = users[chat.member_ids.find((id) => id !== me) ?? 0];
    return (
      <Avatar
        url={peer?.avatar_url}
        name={peer?.display_name ?? '?'}
        color={peer?.color ?? 0}
        size={size}
        online={showOnline && peer?.online && !peer?.is_bot}
      />
    );
  }
  return <Avatar url={chat.avatar_url} name={chatTitle(chat, users, me)} color={chat.color} size={size} round={false} />;
}

export function ChatTypeIcon({ chat, size = 14 }: { chat: Chat; size?: number }) {
  if (chat.type === 'channel') return <Megaphone size={size} className="type-icon" />;
  if (chat.type === 'group') return <Users size={size} className="type-icon" />;
  return null;
}
