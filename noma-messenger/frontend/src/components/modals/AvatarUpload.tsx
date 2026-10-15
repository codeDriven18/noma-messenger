import { Camera, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../../api/client';
import { toast } from '../../store/ui';
import { Avatar } from '../ui/Avatar';
import { Spinner } from '../ui/primitives';

/** Square-crops and downsizes before upload so avatars stay light. */
async function squareImage(file: File, size = 512): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(size, s);
    canvas.getContext('2d')!.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.9));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function AvatarUpload({
  url,
  name,
  color,
  round = true,
  onChange,
}: {
  url: string | null;
  name: string;
  color: number;
  round?: boolean;
  onChange: (url: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Выберите изображение', 'error');
      return;
    }
    setBusy(true);
    try {
      const blob = await squareImage(file);
      const res = await api.upload(blob, 'avatar.jpg');
      onChange(res.url);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="avatar-upload">
      <button className="avatar-upload-btn" onClick={() => input.current?.click()}>
        <Avatar url={url} name={name || '?'} color={color} size={96} round={round} />
        <span className="avatar-upload-cam">{busy ? <Spinner size={18} /> : <Camera size={18} />}</span>
      </button>
      {url && (
        <button className="link danger small" onClick={() => onChange(null)}>
          <Trash2 size={13} /> Удалить фото
        </button>
      )}
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}
