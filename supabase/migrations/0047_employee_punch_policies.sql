-- Allow employees to submit and maintain only their own live punches.
-- Staff policies from 0003 remain unchanged and continue to cover HR writes.
create policy punch_events_employee_insert on punch_events
  for insert
  with check (
    employee_id = (select employee_id from profiles where id = auth.uid())
  );

create policy attendance_days_employee_insert on attendance_days
  for insert
  with check (
    employee_id = (select employee_id from profiles where id = auth.uid())
  );

create policy attendance_days_employee_update on attendance_days
  for update
  using (
    employee_id = (select employee_id from profiles where id = auth.uid())
  )
  with check (
    employee_id = (select employee_id from profiles where id = auth.uid())
  );
