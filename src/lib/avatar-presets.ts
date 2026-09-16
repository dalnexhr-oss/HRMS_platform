// Bundled avatar IDs shared by rendering and server validation. Keep this list outside use-server
// modules, which may only export async functions.

// '01' … '50'.
export const avatarPresetId: readonly string[] = Array.from({ length: 50 }, (_, i) =>
  String(i + 1).padStart(2, '0'),
);

export type AvatarPresetId = string;

export function isAvatarPresetId(value: string): boolean {
  return avatarPresetId.includes(value);
}

// Public path to the bundled image for a preset id (id is validated first).
export function avatarPresetSrc(id: string): string {
  return `/avatars/${id}.png`;
}

/** Accessible label / tooltip for a preset. */
export function avatarPresetLabel(id: string): string {
  return `Avatar ${Number(id)}`;
}
