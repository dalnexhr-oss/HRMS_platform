// The at-office / off-site stamp on a punch.
//
// When the punch carries coordinates the chip becomes a link to that exact spot
// on Google Maps. That matters most for an off-site punch: "off-site" on its
// own is an accusation with no evidence, and the person who made it — or the HR
// user reading it back — needs to be able to see *where* in one tap.
//
// three states, all meaningful:
//   true   inside the office geofence
//   false  outside it
//   null   not classified — no coordinates, or no office configured. Rendering
//          nothing is correct here; a null must never read as "off-site".

/** A Google Maps pin at the punch's coordinates, in whichever app the device has. */
export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export function GeoChip({
  withinGeofence,
  lat,
  lng,
}: {
  withinGeofence: boolean | null;
  lat?: number | null;
  lng?: number | null;
}) {
  if (withinGeofence == null) return null;

  const tone = withinGeofence ? 'at-office' : 'off-site';
  const label = withinGeofence ? 'At office' : 'Off-site';
  const hasPoint = typeof lat === 'number' && typeof lng === 'number';

  if (!hasPoint) return <span className={`punch-geo ${tone}`}>{label}</span>;

  return (
    <a
      className={`punch-geo ${tone} is-link`}
      href={mapsUrl(lat as number, lng as number)}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${lat}, ${lng} on Google Maps`}
    >
      {label}
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="10" r="2.4" fill="currentColor" />
      </svg>
      <span className="sr-only"> — open on Google Maps</span>
    </a>
  );
}

export default GeoChip;
