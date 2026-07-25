-- ============================================================================
-- 0027 — Enforce the item stock invariant in the database.
-- assignItem() checks remaining in the app, but the check-then-insert is not
-- atomic: two concurrent assigns could both pass and drive remaining negative.
-- This trigger makes it authoritative — active (not-returned) assigned quantity
-- can never exceed items.total_quantity. The FOR UPDATE lock on the item row
-- serialises concurrent assigns to the same item.
-- ============================================================================

create or replace function fn_guard_item_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_total  int;
  v_active int;
begin
  -- Lock the item row so concurrent assignments to the same item serialise.
  select total_quantity into v_total from items where id = new.item_id for update;
  if v_total is null then
    raise exception 'Item % does not exist.', new.item_id using errcode = '23503';
  end if;

  -- Sum of currently-held quantity for this item, excluding the row being written.
  select coalesce(sum(quantity), 0) into v_active
    from item_assignments
    where item_id = new.item_id and not returned and id <> new.id;

  if not new.returned then
    v_active := v_active + new.quantity;
  end if;

  if v_active > v_total then
    raise exception
      'Cannot assign % — only % of % left for this item.',
      new.quantity, v_total - (v_active - (case when new.returned then 0 else new.quantity end)), v_total
      using errcode = '23514';
  end if;

  return new;
end $$;

drop trigger if exists item_assignments_guard on item_assignments;
create trigger item_assignments_guard
  before insert or update on item_assignments
  for each row execute function fn_guard_item_assignment();
