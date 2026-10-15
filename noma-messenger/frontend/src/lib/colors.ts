/** iOS-contacts style avatars: soft graphite gradients, white initials. */
export const AVATAR_GRADIENTS = [
  ['#A5A5AA', '#7C7C82'],
  ['#9A9AA1', '#6E6E75'],
  ['#B0B0B5', '#85858B'],
  ['#8E8E95', '#636369'],
  ['#A0A0A6', '#76767C'],
  ['#ABABB0', '#808086'],
  ['#96969C', '#6A6A70'],
  ['#B4B4B9', '#8A8A90'],
];

export const avatarGradient = (color: number) => {
  const [a, b] = AVATAR_GRADIENTS[Math.abs(color) % AVATAR_GRADIENTS.length];
  return `linear-gradient(180deg, ${a} 0%, ${b} 100%)`;
};

/** Muted iOS system tints for sender names in groups. */
export const nameColor = (id: number) => {
  const palette = ['#64D2FF', '#30D158', '#FFD60A', '#BF5AF2', '#FF9F0A', '#5E5CE6', '#66D4CF', '#FF6482'];
  return palette[Math.abs(id) % palette.length];
};

export interface AccentTheme {
  id: string;
  name: string;
  color: string;
  on: string; // text colour on top of the accent
  rgb: string;
}

export const ACCENTS: AccentTheme[] = [
  { id: 'mono', name: 'Моно', color: '#FFFFFF', on: '#000000', rgb: '255, 255, 255' },
  { id: 'blue', name: 'Синий', color: '#0A84FF', on: '#FFFFFF', rgb: '10, 132, 255' },
  { id: 'indigo', name: 'Индиго', color: '#5E5CE6', on: '#FFFFFF', rgb: '94, 92, 230' },
  { id: 'violet', name: 'Фиолет', color: '#7B5CFF', on: '#FFFFFF', rgb: '123, 92, 255' },
  { id: 'teal', name: 'Бирюза', color: '#00C7AA', on: '#001A16', rgb: '0, 199, 170' },
  { id: 'orange', name: 'Янтарь', color: '#FF9F0A', on: '#1F1300', rgb: '255, 159, 10' },
];
