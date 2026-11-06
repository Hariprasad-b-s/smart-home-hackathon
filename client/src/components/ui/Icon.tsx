/**
 * Small local inline-SVG icon set (24×24, stroke icons). No icon library.
 * Decorative by default (aria-hidden); pass `title` to make an icon meaningful.
 */
import type { SVGProps } from 'react';

const PATHS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  checkCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l2.8 2.8L16.5 9.5',
  alertTriangle: 'M12 3.5L2.5 20h19L12 3.5zM12 10v4.5M12 17.2v.3',
  alertOctagon: 'M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2L8.2 3zM12 7.5v5.5M12 16.2v.3',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.8v.3',
  minusCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12h8',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.4M12 16.8v.3',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
  chevronDown: 'M5 9l7 7 7-7',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM16 16l5 5',
  download: 'M12 4v11M7 10.5l5 5 5-5M4.5 19.5h15',
  printer: 'M7 8V3.5h10V8M7 17H4.5V9.5a1.5 1.5 0 0 1 1.5-1.5h12a1.5 1.5 0 0 1 1.5 1.5V17H17M7 14h10v6.5H7z',
  presentation: 'M3.5 4.5h17M5 4.5v10h14v-10M12 14.5V18M8.5 21l3.5-3 3.5 3',
  calendar: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12zM4 10h16M8.5 3v4M15.5 3v4',
  pill: 'M10.2 20.2a4.5 4.5 0 0 1-6.4-6.4l10-10a4.5 4.5 0 0 1 6.4 6.4l-10 10zM8.8 8.8l6.4 6.4',
  inhaler: 'M9 3.5h4.5V9H17a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2V3.5zM7 14h-3.5v-3H7',
  lungs: 'M12 4v7.5M12 11.5c-1 1.5-3 2-4.5 1.5M12 11.5c1 1.5 3 2 4.5 1.5M7.5 7.5C5 8.5 3.5 12 3.5 16c0 2.5 1 4 3 4 2.4 0 3-1.5 3-4V9c0-1-.8-1.8-2-1.5zM16.5 7.5c2.5 1 4 4.5 4 8.5 0 2.5-1 4-3 4-2.4 0-3-1.5-3-4V9c0-1 .8-1.8 2-1.5z',
  clipboard: 'M9 4.5H6.5A1.5 1.5 0 0 0 5 6v13.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H15M9 3h6v3H9zM8.5 11h7M8.5 15h5',
  activity: 'M3 12h4l2.5-6.5 5 13L17 12h4',
  flag: 'M5 21V4M5 4.5h11.5l-2 4 2 4H5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2',
  database: 'M4.5 6c0-1.7 3.4-3 7.5-3s7.5 1.3 7.5 3-3.4 3-7.5 3-7.5-1.3-7.5-3zM4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3',
  shuffle: 'M3.5 7h3.5c4 0 6 10 10 10h3.5M18 14l2.5 3-2.5 3M3.5 17H7c1.6 0 2.8-1.5 3.8-3.3M13.2 10.3C14.2 8.5 15.4 7 17 7h3.5M18 4l2.5 3L18 10',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8L12 3.5z',
  heart: 'M12 20s-7.5-4.5-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.5 12 20 12 20z',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.5 2.6 3.5 5.2',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6v.1M4.5 12v.1M4.5 18v.1',
  beaker: 'M9 3.5h6M10 3.5v6L4.8 18.3A1.5 1.5 0 0 0 6.1 20.5h11.8a1.5 1.5 0 0 0 1.3-2.2L14 9.5v-6M7 14.5h10',
  tag: 'M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.1 7.1a1 1 0 0 1-1.4 0L3.5 12.2zM8 8v.1',
  moon: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z',
  bell: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15l1.5-2zM10 20.5a2 2 0 0 0 4 0',
  message: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5v-9z',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v4M9 21h6',
  play: 'M8 5.5v13l10.5-6.5L8 5.5z',
  image: 'M4 6a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V6zM4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 18M15.5 9.5v.1',
  send: 'M4 12l16-8-6 16-2.5-6.5L4 12zM11.5 13.5L20 4',
  grip: 'M9 6v.1M15 6v.1M9 12v.1M15 12v.1M9 18v.1M15 18v.1',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 6a9.6 9.6 0 0 1 1.4-.1c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.3M6.6 6.7A16.5 16.5 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.2-1M9.9 9.9a3 3 0 0 0 4.2 4.2',
  columns: 'M4 5h16v14H4zM12 5v14',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4',
  monitor: 'M3.5 5.5A1.5 1.5 0 0 1 5 4h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 16H5a1.5 1.5 0 0 1-1.5-1.5v-9zM9 20h6M12 16v4',
  school: 'M2.5 9L12 4.5 21.5 9 12 13.5 2.5 9zM6.5 11v5c1.5 1.5 3.5 2.5 5.5 2.5s4-1 5.5-2.5v-5M21.5 9v5.5',
  sparkle: 'M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8L12 3.5zM18.5 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z',
  logout: 'M14.5 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4M10 16.5L5.5 12 10 7.5M5.5 12H16',
  refresh: 'M20 11.5A8 8 0 0 0 5.6 6.8L4 8.5M4 4v4.5h4.5M4 12.5a8 8 0 0 0 14.4 4.7l1.6-1.7M20 20v-4.5h-4.5',
  filter: 'M4 5h16l-6.2 7.5V19l-3.6 1.5v-8L4 5z',
} as const;

export type IconName = keyof typeof PATHS;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  title?: string;
}

export function Icon({ name, size = 18, title, strokeWidth = 1.8, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
