// Shared avatar renderer. Resolve uploaded data URLs, then preset IDs, then initials. This
// component has no hooks; AvatarMenu handles editing.
import { isAvatarPresetId, avatarPresetSrc } from '@/lib/avatar-presets';

export function initials(name: string | null | undefined): string {
  return (name ?? '')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// The inner content of an avatar chip: photo, preset image, or initials.
export function AvatarInner({ name, avatar }: { name?: string | null; avatar?: string | null }) {
  if (avatar && avatar.startsWith('data:image/')) {
    // A data-URL photo — next/image can't optimise these.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="av-img" src={avatar} alt="" />;
  }
  if (avatar && avatar.startsWith('preset:')) {
    const id = avatar.slice('preset:'.length);
    if (isAvatarPresetId(id)) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img className="av-img" src={avatarPresetSrc(id)} alt="" />;
    }
  }
  return <>{initials(name)}</>;
}

// A display-only avatar chip. `className` lets callers size it per surface.
export function Avatar({
  name,
  avatar,
  className = '',
}: {
  name?: string | null;
  avatar?: string | null;
  className?: string;
}) {
  return (
    <span className={`av ${className}`.trim()}>
      <AvatarInner name={name} avatar={avatar} />
    </span>
  );
}
