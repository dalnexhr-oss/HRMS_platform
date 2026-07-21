import Image from 'next/image';

// ============================================================================
// The Dalnex brand mark: the logo wordmark followed by "HRMS.".
//
// One component for every surface so the logo can never drift out of sync
// between the sidebar, the login card and the employee top bar.
//
// The artwork in public/logo.png is DARK on a transparent background, so on the
// dark-teal sidebar it is rendered white via a CSS filter (see .brand
// .brandmark-img in globals.css). On light surfaces it renders as-is.
//
// Intrinsic size is the real aspect ratio (3334x1142 ~ 2.92:1) scaled down;
// each surface then sets the height in CSS and the width follows automatically.
// ============================================================================

const INTRINSIC_W = 234;
const INTRINSIC_H = 80;

export function Brand({
  /** Accessible name; the visible "HRMS." suffix is decorative alongside it. */
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
        width={INTRINSIC_W}
        height={INTRINSIC_H}
        className="brandmark-img"
        priority={priority}
      />
      <span className="brandmark-txt" aria-hidden="true">
        HRMS<span>.</span>
      </span>
    </span>
  );
}
