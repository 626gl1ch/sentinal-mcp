-- ========== SECURITY HARDENING & PRIVILEGE ESCALATION PREVENTION ==========

-- Prevent non-admin users from escalating their own profile privileges via client SQL
create or replace function public.prevent_self_admin_escalation()
returns trigger as $$
begin
  -- If is_admin is being changed from false to true
  if (old.is_admin is null or old.is_admin = false) and new.is_admin = true then
    -- Check if caller is service_role or already an admin
    if auth.role() != 'service_role' and not exists (
      select 1 from public.profiles where id = auth.uid() and is_admin = true
    ) then
      raise exception 'Unauthorized: Only service role or existing administrators can grant admin privileges.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists check_admin_escalation on public.profiles;

create trigger check_admin_escalation
  before update of is_admin on public.profiles
  for each row execute procedure public.prevent_self_admin_escalation();
