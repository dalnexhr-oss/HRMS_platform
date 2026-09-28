import Image from 'next/image';
import Link from 'next/link';
import type { Route } from 'next';
import type { MouseEventHandler } from 'react';

// The entire wordmark links home. The default route resolves the dashboard by account role.

const intrinsicW = 234;
const intrinsicH = 80;

function Brand({
  // Accessible name; the visible "HRMS." suffix is decorative alongside it.
  label = 'Dalnex HRMS',
  priority = false,
  href = '/',
  onClick,
}: {
  label?: string;
  priority?: boolean;
  href?: Route;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <Link
      className="brandmark"
      href={href}
      aria-label={`${label} — go to dashboard`}
      prefetch={false}
      onClick={onClick}
    >
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
    </Link>
  );
}

export { Brand };
