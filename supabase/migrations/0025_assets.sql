-- ============================================================================
-- 0025 — Asset Management. An IT asset register (desktops/laptops) for the
-- Admin/HR "Asset Management" tab. Admin + HR only, at both the app layer and
-- via RLS (auth_role() in ('admin','hr')). No employee assignment for now.
-- ============================================================================

create table assets (
  id             uuid primary key default gen_random_uuid(),
  desktop_name   text        not null,        -- the machine's label / hostname
  brand          text,                        -- laptop/desktop brand
  serial_no      text,
  model_no       text,
  warranty_upto  date,
  warranty_renew date,
  product_id     text,
  device_id      text,
  processor      text,
  ram            text,
  graphics_card  text,
  storage        text,
  antivirus      text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index assets_desktop_name_idx on assets (desktop_name);

comment on table assets is 'IT asset register (desktops/laptops). Admin/HR only.';

-- keep updated_at fresh (set_updated_at() defined in 0001)
create trigger assets_touch before update on assets
  for each row execute function set_updated_at();

-- RLS: admin + HR have full access; everyone else sees nothing. Mirrors the
-- profiles_admin_all shape from 0003. auth_role() already has search_path pinned.
alter table assets enable row level security;

create policy assets_admin_hr on assets
  for all
  using (auth_role() in ('admin', 'hr'))
  with check (auth_role() in ('admin', 'hr'));
