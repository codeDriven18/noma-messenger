import type { Attachment, Message, User } from '../api/types';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export const toDate = (iso: string | null | undefined) => (iso ? new Date(iso) : new Date(0));

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function timeHM(iso: string | null | undefined): string {
  const d = toDate(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Chat-list style stamp: time today, weekday this week, date otherwise. */
export function shortStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = toDate(iso);
  const now = new Date();
  if (sameDay(d, now)) return timeHM(iso);
  const diff = (now.getTime() - d.getTime()) / 86400000;
  if (diff < 6) return WEEKDAYS[d.getDay()];
  if (d.getFullYear() === now.getFullYear()) return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`;
}

export function dayLabel(iso: string): string {
  const d = toDate(iso);
  const now = new Date();
  if (sameDay(d, now)) return 'Сегодня';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Вчера';
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

export const dayKey = (iso: string) => {
  const d = toDate(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function lastSeen(user: User | undefined): string {
  if (!user) return '';
  if (user.is_bot) return 'официальный аккаунт';
  if (user.online) return 'в сети';
  if (!user.last_seen) return 'был(а) недавно';
  const d = toDate(user.last_seen);
  const now = new Date();
  const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return 'был(а) только что';
  if (mins < 60) return `был(а) ${mins} ${plural(mins, 'минуту', 'минуты', 'минут')} назад`;
  if (sameDay(d, now)) return `был(а) сегодня в ${timeHM(user.last_seen)}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return `был(а) вчера в ${timeHM(user.last_seen)}`;
  return `был(а) ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

export const membersLabel = (n: number, channel = false) =>
  channel ? `${n} ${plural(n, 'подписчик', 'подписчика', 'подписчиков')}` : `${n} ${plural(n, 'участник', 'участника', 'участников')}`;

export function fileSize(bytes = 0): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`;
}

export function duration(sec = 0): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

const KIND_LABEL: Record<string, string> = {
  photo: '🖼 Фото',
  video: '🎬 Видео',
  file: '📎 Файл',
  voice: '🎤 Голосовое сообщение',
  video_note: '⭕ Видеосообщение',
  audio: '🎵 Аудио',
};

export function attachmentLabel(att: Attachment | undefined, count = 1): string {
  if (!att) return '';
  if (count > 1 && (att.kind === 'photo' || att.kind === 'video')) return `🖼 Альбом · ${count}`;
  if (att.kind === 'file' || att.kind === 'audio') return `📎 ${att.name ?? 'Файл'}`;
  return KIND_LABEL[att.kind] ?? 'Вложение';
}

export const stripMarkup = (text: string) => text.replace(/(\*\*|__|~~|\|\||```|`)/g, '');

export function messagePreview(m: Message | null | undefined): string {
  if (!m) return '';
  if (m.type === 'call' && m.call) {
    const kind = m.call.video ? 'Видеозвонок' : 'Звонок';
    if (m.call.status === 'ended') return `📞 ${kind} · ${duration(m.call.duration)}`;
    if (m.call.status === 'missed') return `📞 Пропущенный ${kind.toLowerCase()}`;
    if (m.call.status === 'declined') return `📞 Отклонённый ${kind.toLowerCase()}`;
    return `📞 ${kind}`;
  }
  const text = stripMarkup(m.text).replace(/\s+/g, ' ').trim();
  if (m.attachments.length) {
    const label = attachmentLabel(m.attachments[0], m.attachments.length);
    return text ? `${label.split(' ')[0]} ${text}` : label;
  }
  return text;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p.match(/[\p{L}\p{N}]/u)?.[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s*){1,3}$/u;
export const isEmojiOnly = (text: string) => text.length > 0 && text.length <= 24 && EMOJI_ONLY.test(text.trim());
