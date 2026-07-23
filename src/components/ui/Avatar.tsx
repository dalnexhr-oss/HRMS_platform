// ============================================================================
// The user's avatar. One component for every surface (topbar, employee bar, the
// /me hero, the account page) so the picture can never drift between them.
//
// The stored value is resolved in this order:
//   'data:image/…'  → the uploaded, client-resized photo
//   'preset:<id>'   → one of the bundled shadcn avatar images (public/avatars/)
//   anything else    → the name's initials on the brand-coloured chip
//
// No 'use client': this renders only markup (no hooks), so it is safe to use
// from Server Components. The interactive picker is <AvatarMenu>.
// ============================================================================
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

/** The inner content of an avatar chip: photo, preset image, or initials. */
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

/** A display-only avatar chip. `className` lets callers size it per surface. */
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
