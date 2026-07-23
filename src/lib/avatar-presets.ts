// ============================================================================
// The built-in avatar choices — 50 illustrated "notionists" faces (monochrome
// ink on a light-grey circle, matching the shadcn/ui avatar look), bundled into
// public/avatars/ (01.png … 50.png) so they load locally with no network/CORS
// dependency. Kept in a plain, JSX-free module so it can be imported both by the
// <Avatar> component (which draws them) and by the updateAvatar server action
// (which validates against them). A 'use server' file cannot itself export a
// const, so the list has to live outside it.
// ============================================================================

/** '01' … '50'. */
export const AVATAR_PRESET_IDS: readonly string[] = Array.from({ length: 50 }, (_, i) =>
  String(i + 1).padStart(2, '0'),
);

export type AvatarPresetId = string;

export function isAvatarPresetId(value: string): boolean {
  return AVATAR_PRESET_IDS.includes(value);
}

/** Public path to the bundled image for a preset id (id is validated first). */
export function avatarPresetSrc(id: string): string {
  return `/avatars/${id}.png`;
}

/** Accessible label / tooltip for a preset. */
export function avatarPresetLabel(id: string): string {
  return `Avatar ${Number(id)}`;
}
