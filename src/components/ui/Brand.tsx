import Image from 'next/image';

// Shared logo wordmark. CSS inverts the dark artwork on the sidebar and scales it using its
// original 3334×1142 aspect ratio.

const intrinsicW = 234;
const intrinsicH = 80;

export function Brand({
  // Accessible name; the visible "HRMS." suffix is decorative alongside it.
  label = 'Dalnex HRMS',
  priority = false,
}: {
  label?: string;
  priority?: boolean;
}) {
  return (
    <span className="brandmark">
      <Image
        src="/logo.png"
        alt={label}
        width={intrinsicW}
        height={intrinsicH}
        className="brandmark-img"
        priority={priority}
      />
      <span className="brandmark-txt" aria-hidden="true">
        HRMS<span>.</span>
      </span>
    </span>
  );
}
