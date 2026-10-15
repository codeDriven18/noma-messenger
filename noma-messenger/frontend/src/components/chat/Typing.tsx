import type { User } from '../../api/types';
import type { TypingEntry } from '../../store/chats';

export function TypingDots() {
  return (
    <span className="typing-dots" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

const ACTION_TEXT: Record<string, string> = {
  typing: 'печатает',
  recording: 'записывает голосовое',
  uploading: 'отправляет файл',
  video: 'записывает видео',
};

export function typingText(entries: [string, TypingEntry][], users: Record<number, User>, withName: boolean): string {
  if (!entries.length) return '';
  const [uid, entry] = entries[0];
  const action = ACTION_TEXT[entry.action] ?? 'печатает';
  if (!withName) return `${action}…`;
  const name = users[Number(uid)]?.display_name.split(' ')[0] ?? 'Кто-то';
  if (entries.length > 1) return `${name} и ещё ${entries.length - 1} ${action === 'печатает' ? 'печатают' : action}…`;
  return `${name} ${action}…`;
}
