/**
 * NOMA lives inside `.device` — a phone frame on desktop, the whole screen on phones.
 * Overlays are positioned relative to it, so pointer coordinates must be converted.
 */
export function stageRect(): DOMRect {
  return document.querySelector('.device')?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
}

export function toStage(x: number, y: number) {
  const r = stageRect();
  return { x: x - r.left, y: y - r.top };
}

export function rectInStage(rect: DOMRect) {
  const s = stageRect();
  return new DOMRect(rect.left - s.left, rect.top - s.top, rect.width, rect.height);
}

/** Width of the app surface, used where layout depends on the "screen" size. */
export const stageWidth = () => stageRect().width;
