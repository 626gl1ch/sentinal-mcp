-- ========== ADD ADMIN AND UNLIMITED PLAN ACCESS ==========

-- 1. Add is_admin flag to public.profiles table
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- 2. Create or replace a function to auto-assign "team" (unlimited) tier for admins
create or replace function public.handle_admin_tier_assignment()
returns trigger as $$
begin
  -- If the user profile is flagged or updated as is_admin = true
  if new.is_admin = true then
    insert into public.subscriptions (user_id, stripe_customer_id, stripe_subscription_id, tier, status)
    values (
      new.id,
      'admin_customer_' || encode(sha256(new.id::text::bytea), 'hex'),
      'admin_sub_' || encode(sha256(new.id::text::bytea), 'hex'),
      'team', -- Unlimited tier
      'active'
    )
    on conflict (stripe_subscription_id) do update set
      tier = 'team',
      status = 'active';
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- 3. Create trigger to run when profiles are updated or created
create or replace trigger on_profile_admin_update
  after insert or update of is_admin on public.profiles
  for each row execute procedure public.handle_admin_tier_assignment();

-- 4. Expose profile admin metadata to client read (optional, profiles policy already allows reading own)
-- The existing policy is: "Users read own profile" on public.profiles for select using (auth.uid() = id);

-- 5. Helper function (to run via admin dashboard or execute_sql) to set an email as admin
-- Note: This matches the user in auth.users by email and updates their profile
create or replace function public.set_user_as_admin_by_email(target_email text)
returns void as $$
declare
  target_user_id uuid;
begin
  select id into target_user_id from auth.users where email = target_email;
  if target_user_id is not null then
    update public.profiles set is_admin = true where id = target_user_id;
  else
    raise exception 'User with email % not found', target_email;
  end if;
end;
$$ language plpgsql security definer;
