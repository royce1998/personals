-- Public badge only (never the raw number)
alter table public.profiles
  add column if not exists phone_verified boolean not null default false;

-- Private store: raw E.164 number + carrier line type. Only the owner can read
-- their own row; writes happen exclusively via the edge function (service role).
create table if not exists public.phone_verifications (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  phone_e164  text not null,
  line_type   text,
  verified_at timestamptz not null default now()
);
create unique index if not exists uq_phone_verifications_phone
  on public.phone_verifications(phone_e164);

alter table public.phone_verifications enable row level security;
drop policy if exists pv_read_own on public.phone_verifications;
create policy pv_read_own on public.phone_verifications
  for select using (user_id = auth.uid());

grant select on public.phone_verifications to authenticated;
-- deliberately NO insert/update/delete grants -> only service_role can write.
