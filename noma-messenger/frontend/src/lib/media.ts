import type { AttachmentKind } from '../api/types';

export interface LocalAttachment {
  kind: AttachmentKind;
  file: Blob;
  name: string;
  previewUrl: string;
  width?: number;
  height?: number;
  duration?: number;
  waveform?: number[];
  thumbBlob?: Blob;
}

export function imageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}

/** Reads dimensions, duration and grabs a poster frame of a video. */
export function videoInfo(url: string): Promise<{ width: number; height: number; duration: number; thumb?: Blob }> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    let done = false;
    const finish = (thumb?: Blob) => {
      if (done) return;
      done = true;
      resolve({ width: v.videoWidth, height: v.videoHeight, duration: Number.isFinite(v.duration) ? v.duration : 0, thumb });
    };
    v.onloadeddata = () => {
      v.currentTime = Math.min(0.2, (v.duration || 1) / 2);
    };
    v.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight, 1));
        canvas.width = Math.max(1, Math.round(v.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(v.videoHeight * scale));
        canvas.getContext('2d')?.drawImage(v, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => finish(b ?? undefined), 'image/jpeg', 0.8);
      } catch {
        finish();
      }
    };
    v.onerror = () => finish();
    window.setTimeout(() => finish(), 6000);
    v.src = url;
  });
}

export function mediaDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    a.preload = 'metadata';
    a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => resolve(0);
    a.src = url;
  });
}

export async function prepareFiles(files: File[], asDocuments = false): Promise<LocalAttachment[]> {
  const out: LocalAttachment[] = [];
  for (const file of files) {
    const previewUrl = URL.createObjectURL(file);
    const base = { file, name: file.name, previewUrl };
    if (!asDocuments && file.type.startsWith('image/') && !file.type.includes('svg')) {
      out.push({ ...base, kind: 'photo', ...(await imageSize(previewUrl)) });
    } else if (!asDocuments && file.type.startsWith('video/')) {
      const info = await videoInfo(previewUrl);
      out.push({ ...base, kind: 'video', width: info.width, height: info.height, duration: info.duration, thumbBlob: info.thumb });
    } else if (!asDocuments && file.type.startsWith('audio/')) {
      out.push({ ...base, kind: 'audio', duration: await mediaDuration(previewUrl) });
    } else {
      out.push({ ...base, kind: 'file' });
    }
  }
  return out;
}

export function downloadUrl(url: string, name?: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name ?? '';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Fits media into a bubble while keeping its aspect ratio. */
export function fitBox(w = 0, h = 0, maxW = 340, maxH = 380, minW = 160) {
  if (!w || !h) return { width: maxW, height: Math.round(maxW * 0.66) };
  const ratio = w / h;
  let width = Math.min(maxW, w);
  let height = width / ratio;
  if (height > maxH) {
    height = maxH;
    width = height * ratio;
  }
  if (width < minW) {
    width = minW;
    height = Math.min(maxH, width / ratio);
  }
  return { width: Math.round(width), height: Math.round(height) };
}
