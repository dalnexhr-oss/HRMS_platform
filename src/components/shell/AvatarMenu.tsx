'use client';

// ============================================================================
// The clickable avatar chip in the top bar. Clicking it opens a small popover to
//   • upload a photo (resized client-side to 128×128 so it stays a few KB), or
//   • pick one of the bundled shadcn avatar images, or
//   • remove the picture (back to initials).
// The chosen value is persisted by the updateAvatar server action.
// ============================================================================
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AvatarInner } from '@/components/ui/Avatar';
import { updateAvatar } from '@/lib/actions/profile';
import { AVATAR_PRESET_IDS, avatarPresetLabel } from '@/lib/avatar-presets';

/** Draw the file onto a 128×128 canvas (centre-cropped) and return a JPEG data URL. */
async function fileToAvatarDataUrl(file: File): Promise<string> {
  const SIZE = 128;
  // imageOrientation:'from-image' honours EXIF so portrait phone photos aren't
  // stored sideways.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  if (!bitmap.width || !bitmap.height) {
    bitmap.close?.();
    throw new Error('That image could not be read. Try a different photo.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not process the image.');
  // Fill first so a transparent PNG/WebP doesn't turn black under JPEG.
  ctx.fillStyle = '#0E7A8F';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const scale = Math.max(SIZE / bitmap.width, SIZE / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.82);
}

export function AvatarMenu({
  name,
  avatar,
  align = 'right',
}: {
  name?: string | null;
  avatar?: string | null;
  /** Which edge the popover anchors to. 'right' for a right-aligned trigger
   *  (topbar); 'left' when the trigger sits at the left (account page). */
  align?: 'left' | 'right';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Drive the display from local state so a pick/remove is reflected instantly,
  // then reconcile with the server value once the refresh lands. Without this the
  // chip only changes after router.refresh() round-trips, which reads as "the
  // button did nothing" (especially for Remove).
  const [current, setCurrent] = useState<string | null | undefined>(avatar);
  useEffect(() => {
    setCurrent(avatar);
  }, [avatar]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const commit = (value: string | null) => {
    setError(null);
    startTransition(async () => {
      const res = await updateAvatar(value);
      if (!res.ok) {
        setError(res.error ?? 'Could not update your picture.');
        return;
      }
      setCurrent(value); // reflect immediately
      setOpen(false);
      router.refresh();
    });
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Please choose a PNG, JPEG or WebP image.');
      return;
    }
    setError(null);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      commit(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that image.');
    }
  };

  return (
    <div ref={boxRef} className="avatar-menu">
      <button
        type="button"
        className="av av-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Change your picture"
      >
        <AvatarInner name={name} avatar={current} />
      </button>

      {open && (
        <div role="menu" className={`avatar-pop${align === 'left' ? ' align-left' : ''}`}>
          <div className="avatar-pop-hd">Your picture</div>

          <button
            type="button"
            className="btn primary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => fileRef.current?.click()}
            disabled={pending}
          >
            {pending ? 'Saving…' : 'Upload a photo'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onFile}
            hidden
          />

          <div className="avatar-pop-lab">Or pick an avatar</div>
          <div className="avatar-swatches">
            {AVATAR_PRESET_IDS.map((id) => {
              const value = `preset:${id}`;
              const selected = current === value;
              return (
                <button
                  key={id}
                  type="button"
                  className={`av avatar-swatch${selected ? ' is-selected' : ''}`}
                  title={avatarPresetLabel(id)}
                  aria-label={avatarPresetLabel(id)}
                  aria-pressed={selected}
                  onClick={() => commit(value)}
                  disabled={pending}
                >
                  <AvatarInner name={name} avatar={value} />
                </button>
              );
            })}
          </div>

          {current && (
            <button
              type="button"
              className="btn quiet"
              style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
              onClick={() => commit(null)}
              disabled={pending}
            >
              Remove picture
            </button>
          )}

          {error && (
            <div className="login-error" role="alert" style={{ marginTop: 8, fontSize: 12 }}>
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
