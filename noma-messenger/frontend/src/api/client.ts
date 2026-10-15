import type { CallLogEntry, Chat, Message, Reaction, Role, UploadResult, User } from './types';

const TOKEN_KEY = 'noma.token';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let token: string | null = localStorage.getItem(TOKEN_KEY);
let unauthorizedHandler: (() => void) | null = null;

export const getToken = () => token;
export function setToken(value: string | null) {
  token = value;
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
}
export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

function errorText(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail[0]?.msg) {
      const first = detail[0] as { msg: string; loc?: string[] };
      const field = first.loc?.[first.loc.length - 1];
      const msg = first.msg.replace(/^Value error, /, '');
      if (field === 'password') return 'Пароль должен быть не короче 6 символов';
      if (field === 'username') return 'Имя пользователя: от 4 символов';
      return msg;
    }
  }
  return fallback;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Нет соединения с сервером');
  }
  if (res.status === 401 && token) unauthorizedHandler?.();
  if (!res.ok) {
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, errorText(payload, `Ошибка ${res.status}`));
  }
  return res.json() as Promise<T>;
}

const get = <T>(p: string) => request<T>('GET', p);
const post = <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {});
const patch = <T>(p: string, b: unknown) => request<T>('PATCH', p, b);
const del = <T>(p: string) => request<T>('DELETE', p);

type AuthResult = { token: string; user: User };
type ChatWithUsers = { chat: Chat; users: User[] };

export const api = {
  register: (username: string, display_name: string, password: string) =>
    post<AuthResult>('/api/auth/register', { username, display_name, password }),
  login: (username: string, password: string) => post<AuthResult>('/api/auth/login', { username, password }),
  me: () => get<User>('/api/auth/me'),
  changePassword: (old_password: string, new_password: string) =>
    post<{ ok: boolean }>('/api/auth/password', { old_password, new_password }),

  updateMe: (data: Partial<Pick<User, 'display_name' | 'username' | 'bio' | 'avatar_url'>> & { remove_avatar?: boolean }) =>
    patch<User>('/api/users/me', data),
  searchUsers: (q: string) => get<User[]>(`/api/users/search?q=${encodeURIComponent(q)}`),
  contacts: () => get<User[]>('/api/users/contacts'),
  user: (id: number) => get<User>(`/api/users/${id}`),
  usersBatch: (ids: number[]) => post<User[]>('/api/users/batch', ids),

  chats: () => get<{ chats: Chat[]; users: User[] }>('/api/chats'),
  chat: (id: number) => get<ChatWithUsers>(`/api/chats/${id}`),
  openPrivate: (user_id: number) => post<ChatWithUsers>('/api/chats/private', { user_id }),
  createGroup: (data: {
    type: 'group' | 'channel';
    title: string;
    description?: string;
    member_ids: number[];
    avatar_url?: string | null;
    username?: string | null;
    is_public?: boolean;
  }) => post<ChatWithUsers>('/api/chats/group', data),
  updateChat: (
    id: number,
    data: { title?: string; description?: string; avatar_url?: string; remove_avatar?: boolean; username?: string; is_public?: boolean },
  ) => patch<Chat>(`/api/chats/${id}`, data),
  deleteChat: (id: number) => del<{ ok: boolean }>(`/api/chats/${id}`),
  chatSettings: (id: number, data: { pinned?: boolean; muted?: boolean; archived?: boolean }) =>
    patch<{ pinned: boolean; muted: boolean; archived: boolean }>(`/api/chats/${id}/settings`, data),
  addMembers: (id: number, user_ids: number[]) => post<{ added: number[] }>(`/api/chats/${id}/members`, { user_ids }),
  removeMember: (id: number, userId: number) => del<{ ok: boolean }>(`/api/chats/${id}/members/${userId}`),
  setRole: (id: number, userId: number, role: Exclude<Role, 'owner'>) =>
    patch<{ ok: boolean }>(`/api/chats/${id}/members/${userId}`, { role }),
  joinChat: (id: number) => post<ChatWithUsers>(`/api/chats/${id}/join`),
  searchPublic: (q: string) => get<Chat[]>(`/api/chats/search?q=${encodeURIComponent(q)}`),
  markRead: (id: number, message_id: number) => post<{ last_read_id: number }>(`/api/chats/${id}/read`, { message_id }),
  pin: (id: number, message_id: number | null) => post<{ message: Message | null }>(`/api/chats/${id}/pin`, { message_id }),
  shared: (id: number, kind: 'media' | 'files' | 'voice' | 'links') => get<Message[]>(`/api/chats/${id}/shared?kind=${kind}`),

  messages: (chatId: number, params: { before?: number; since_id?: number; after?: number; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && qs.set(k, String(v)));
    return get<{ messages: Message[]; has_more: boolean | null }>(`/api/chats/${chatId}/messages?${qs}`);
  },
  searchMessages: (chatId: number, q: string) => get<Message[]>(`/api/chats/${chatId}/search?q=${encodeURIComponent(q)}`),
  sendMessage: (chatId: number, data: { text: string; reply_to_id?: number | null; attachments?: unknown[]; client_id?: string }) =>
    post<Message>(`/api/chats/${chatId}/messages`, data),
  editMessage: (id: number, text: string) => patch<Message>(`/api/messages/${id}`, { text }),
  deleteMessages: (message_ids: number[]) => post<{ deleted: number[] }>('/api/messages/delete', { message_ids }),
  react: (id: number, emoji: string) => post<{ reactions: Reaction[] }>(`/api/messages/${id}/reactions`, { emoji }),
  forward: (message_ids: number[], chat_ids: number[], comment = '') =>
    post<{ count: number }>('/api/messages/forward', { message_ids, chat_ids, comment }),
  calls: () => get<{ calls: CallLogEntry[]; users: User[] }>('/api/calls'),
  config: () => get<{ ice_servers: RTCIceServer[]; max_upload_mb: number }>('/api/config'),

  upload(file: Blob, name: string, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
      xhr.onload = () => {
        let payload: unknown = null;
        try {
          payload = JSON.parse(xhr.responseText);
        } catch {
          /* ignore */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(payload as UploadResult);
        else reject(new ApiError(xhr.status, errorText(payload, 'Не удалось загрузить файл')));
      };
      xhr.onerror = () => reject(new ApiError(0, 'Нет соединения с сервером'));
      signal?.addEventListener('abort', () => xhr.abort());
      const form = new FormData();
      form.append('file', file, name);
      xhr.send(form);
    });
  },
};
