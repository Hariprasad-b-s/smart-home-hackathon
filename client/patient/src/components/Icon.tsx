/** Patient-app icon set (24×24 stroke icons). Decorative unless `title` is given. */
const PATHS = {
  home: 'M3.5 11L12 4l8.5 7M5.5 9.5V20h5v-5.5h3V20h5V9.5',
  clipboard:
    'M9 4.5H6.5A1.5 1.5 0 0 0 5 6v13.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H15M9 3h6v3H9zM8.5 11h7M8.5 15h5',
  pill: 'M10.2 20.2a4.5 4.5 0 0 1-6.4-6.4l10-10a4.5 4.5 0 0 1 6.4 6.4l-10 10zM8.8 8.8l6.4 6.4',
  inhaler: 'M9 3.5h4.5V9H17a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2V3.5zM7 14h-3.5v-3H7',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5',
  lungs:
    'M12 4v7.5M12 11.5c-1 1.5-3 2-4.5 1.5M12 11.5c1 1.5 3 2 4.5 1.5M7.5 7.5C5 8.5 3.5 12 3.5 16c0 2.5 1 4 3 4 2.4 0 3-1.5 3-4V9c0-1-.8-1.8-2-1.5zM16.5 7.5c2.5 1 4 4.5 4 8.5 0 2.5-1 4-3 4-2.4 0-3-1.5-3-4V9c0-1 .8-1.8 2-1.5z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  flame:
    'M12 21c-4 0-6.5-2.7-6.5-6.3 0-3.7 3-5.7 4-9.2 2.3 1.6 3.3 3.7 3.2 5.8 1-.6 1.7-1.7 2-3 1.8 1.6 3.8 3.9 3.8 6.4C18.5 18.3 16 21 12 21z',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8L12 3.5z',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4.5V11h-6.5',
  bluetooth: 'M7 7l10 10-5 4V3l5 4L7 17',
  wifiOff:
    'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4-2.3M19 13a10 10 0 0 0-2.5-1.8M2 9.5a15 15 0 0 1 4.5-2.8M22 9.5A15 15 0 0 0 10.5 5.1M12 20v.1',
  alert: 'M12 3.5L2.5 20h19L12 3.5zM12 10v4.5M12 17.2v.3',
  swap: 'M4 8h13M13.5 4.5L17 8l-3.5 3.5M20 16H7M10.5 12.5L7 16l3.5 3.5',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.4M12 16.8v.3',
  mic: 'M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7',
  pause: 'M8.5 5v14M15.5 5v14',
  camera: 'M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.5-2.5h5.4L16.2 7h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  image: 'M4.5 5.5h15v13h-15zM4.5 15.5l4.5-4.5 4 4 2.5-2.5 4 4M15 9.5v.1',
  video: 'M3.5 6.5h11v11h-11zM14.5 10.5l6-3.5v10l-6-3.5',
  send: 'M4 12l16-8-6 16-2.5-6.5L4 12zM11.5 13.5L20 4',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5',
  chat: 'M4.5 5.5h15v10h-8l-4.5 4v-4h-2.5z',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.5 2.6 3.5 5.2',
  keyboard: 'M3.5 7h17v10h-17zM7 10.5v.1M10.5 10.5v.1M14 10.5v.1M17.5 10.5v.1M8 14h8',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, title, className }: { name: IconName; size?: number; title?: string; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
