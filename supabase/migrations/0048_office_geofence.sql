-- ============================================================================
-- 0048 — office location for punch geofencing
--
-- Location is CLASSIFIED, never enforced: a punch is always accepted, with or
-- without coordinates. These keys only decide whether it is stamped at-office
-- or off-site (punch_events.within_geofence, which has existed since 0001 and
-- was previously never written).
--
-- office_lat / office_lng are seeded null so the app can tell "not configured
-- yet" (punches stay unclassified) from "configured at 0,0". Set them from
-- Settings -> Rule flags, or with:
--   update settings set value = '19.076090'::jsonb where key = 'office_lat';
-- ============================================================================

insert into settings (key, value, label, description) values
  ('office_lat', 'null'::jsonb, 'Office latitude',
   'Decimal degrees, e.g. 19.076090. Leave empty to stop classifying punches.'),
  ('office_lng', 'null'::jsonb, 'Office longitude',
   'Decimal degrees, e.g. 72.877426. Leave empty to stop classifying punches.'),
  ('geofence_radius_m', '50'::jsonb, 'Office radius (metres)',
   'A punch inside this distance is stamped at-office. The phone''s own GPS accuracy is added on top, so a poor fix at the door is not called off-site.'),
  ('punch_require_location', 'true'::jsonb, 'Require location to punch',
   'On: a punch is refused unless the browser shares a location — ANY location, office or not. Off: a punch with location blocked is accepted and simply left unclassified. This is about whether location is SHARED, not about where the person is; being off-site never blocks a punch either way.')
on conflict (key) do nothing;

-- Employees already insert their own punch_events (0047). They must also be
-- able to read back settings to know whether an office is configured — the
-- blanket settings read policy from 0003 covers this, and 0004 did not narrow
-- settings, so nothing further is needed here.
