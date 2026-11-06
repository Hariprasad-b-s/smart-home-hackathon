import type { MediaItem } from '@shared/types';
import { Icon } from './Icon';
import s from './MediaThumb.module.css';

/** Square thumbnail button for a photo or video. */
export function MediaThumb({ item, onOpen, size = 'md' }: { item: MediaItem; onOpen: () => void; size?: 'sm' | 'md' }) {
  const label = `${item.kind === 'video' ? 'Play video' : 'Open photo'}${item.caption ? `: ${item.caption}` : ''}`;
  return (
    <button type="button" className={`${s.thumb} ${size === 'sm' ? s.sm : ''}`} onClick={onOpen} aria-label={label} title={item.caption}>
      {item.kind === 'photo' ? (
        <img src={item.url} alt="" loading="lazy" />
      ) : (
        <span className={s.video}>
          <Icon name="play" size={size === 'sm' ? 18 : 26} />
        </span>
      )}
      {item.kind === 'video' ? <span className={s.badge}>Video</span> : null}
    </button>
  );
}
