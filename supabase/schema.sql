-- Personals — Supabase schema, RLS, and server-side RPCs
-- Safe to run multiple times (idempotent-ish). Runs in the `public` schema.

-- ============================ Tables ============================

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category     text not null,
  title        text not null,
  body         text not null,
  city         text not null,
  age          int,
  gender       text,
  seeking      text,
  contact_pref text not null default 'onsite',
  status       text not null default 'active',
  flag_count   int  not null default 0,
  image_urls   text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '30 days'
);
create index if not exists idx_posts_browse on public.posts(category, city, status, created_at desc);
create index if not exists idx_posts_user on public.posts(user_id);

create table if not exists public.conversations (
  id         bigint generated always as identity primary key,
  post_id    bigint not null references public.posts(id) on delete cascade,
  poster_id  uuid not null references auth.users(id) on delete cascade,
  replier_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(post_id, replier_id)
);

create table if not exists public.messages (
  id              bigint generated always as identity primary key,
  conversation_id bigint not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body            text not null,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_messages_conv on public.messages(conversation_id);

create table if not exists public.favorites (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  post_id    bigint not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table if not exists public.flags (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  post_id    bigint not null references public.posts(id) on delete cascade,
  reason     text,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

-- ============================ Grants ============================
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.posts to anon, authenticated;
grant select, insert, update, delete on public.posts, public.conversations,
  public.messages, public.favorites, public.flags, public.profiles to authenticated;

-- ============================ RLS ============================
alter table public.profiles      enable row level security;
alter table public.posts         enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.favorites     enable row level security;
alter table public.flags         enable row level security;

-- profiles: readable by everyone; you manage your own
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (true);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (id = auth.uid());

-- posts: active posts are public; owners see + manage their own
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts for select
  using (status = 'active' or user_id = auth.uid());
drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert with check (user_id = auth.uid());
drop policy if exists posts_update on public.posts;
create policy posts_update on public.posts for update using (user_id = auth.uid());
drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts for delete using (user_id = auth.uid());

-- conversations: only the two participants
drop policy if exists conv_read on public.conversations;
create policy conv_read on public.conversations for select
  using (poster_id = auth.uid() or replier_id = auth.uid());

-- messages: only within your conversations
drop policy if exists msg_read on public.messages;
create policy msg_read on public.messages for select using (
  exists (select 1 from public.conversations c
          where c.id = conversation_id
            and (c.poster_id = auth.uid() or c.replier_id = auth.uid())));

-- favorites + flags: your own rows
drop policy if exists fav_all on public.favorites;
create policy fav_all on public.favorites for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists flag_insert on public.flags;
create policy flag_insert on public.flags for insert with check (user_id = auth.uid());

-- ============================ Triggers / functions ============================

-- Auto-create a profile when a user signs up (username from signup metadata).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  uname := coalesce(nullif(new.raw_user_meta_data->>'username',''), split_part(new.email,'@',1));
  -- ensure uniqueness
  if exists (select 1 from public.profiles where username = uname) then
    uname := uname || '_' || substr(new.id::text, 1, 4);
  end if;
  insert into public.profiles(id, username) values (new.id, uname)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- keep posts.updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists posts_touch on public.posts;
create trigger posts_touch before update on public.posts
  for each row execute function public.touch_updated_at();

-- Reply to a post: create/find a conversation, add a message. Returns conversation id.
create or replace function public.reply_to_post(p_post_id bigint, p_body text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_poster uuid; v_status text; v_conv bigint; v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  select user_id, status into v_poster, v_status from public.posts where id = p_post_id;
  if v_poster is null then raise exception 'That post no longer exists.'; end if;
  if v_status <> 'active' then raise exception 'That post is no longer accepting replies.'; end if;
  if v_poster = v_me then raise exception 'You cannot reply to your own post.'; end if;
  if coalesce(trim(p_body),'') = '' then raise exception 'Your message is empty.'; end if;

  select id into v_conv from public.conversations where post_id = p_post_id and replier_id = v_me;
  if v_conv is null then
    insert into public.conversations(post_id, poster_id, replier_id)
      values (p_post_id, v_poster, v_me) returning id into v_conv;
  end if;
  insert into public.messages(conversation_id, sender_id, body) values (v_conv, v_me, left(p_body, 4000));
  update public.conversations set updated_at = now() where id = v_conv;
  return v_conv;
end $$;

-- Send a message inside an existing conversation you belong to.
create or replace function public.send_message(p_conversation_id bigint, p_body text)
returns public.messages language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_row public.messages; v_ok boolean;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  select true into v_ok from public.conversations
    where id = p_conversation_id and (poster_id = v_me or replier_id = v_me);
  if not v_ok then raise exception 'You are not part of this conversation.'; end if;
  if coalesce(trim(p_body),'') = '' then raise exception 'Your message is empty.'; end if;
  insert into public.messages(conversation_id, sender_id, body)
    values (p_conversation_id, v_me, left(p_body, 4000)) returning * into v_row;
  update public.conversations set updated_at = now() where id = p_conversation_id;
  return v_row;
end $$;

-- Mark incoming messages in a conversation as read.
create or replace function public.mark_read(p_conversation_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  update public.messages set read_at = now()
   where conversation_id = p_conversation_id and sender_id <> v_me and read_at is null
     and exists (select 1 from public.conversations c where c.id = p_conversation_id
                   and (c.poster_id = v_me or c.replier_id = v_me));
end $$;

-- Toggle a favorite. Returns true if now favorited.
create or replace function public.toggle_favorite(p_post_id bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if exists (select 1 from public.favorites where user_id = v_me and post_id = p_post_id) then
    delete from public.favorites where user_id = v_me and post_id = p_post_id;
    return false;
  end if;
  insert into public.favorites(user_id, post_id) values (v_me, p_post_id);
  return true;
end $$;

-- Flag a post; auto-hide at threshold. Returns new flag count.
create or replace function public.flag_post(p_post_id bigint, p_reason text)
returns int language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_owner uuid; v_count int;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  select user_id into v_owner from public.posts where id = p_post_id;
  if v_owner is null then raise exception 'That post no longer exists.'; end if;
  if v_owner = v_me then raise exception 'You cannot flag your own post.'; end if;
  insert into public.flags(user_id, post_id, reason) values (v_me, p_post_id, left(p_reason,200))
    on conflict (user_id, post_id) do nothing;
  select count(*) into v_count from public.flags where post_id = p_post_id;
  update public.posts set flag_count = v_count,
    status = case when v_count >= 4 then 'removed' else status end
   where id = p_post_id;
  return v_count;
end $$;

-- Repost (renew) your own post.
create or replace function public.repost(p_post_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  update public.posts
     set status = 'active', created_at = now(), updated_at = now(),
         expires_at = now() + interval '30 days'
   where id = p_post_id and user_id = v_me;
end $$;

grant execute on function public.reply_to_post(bigint, text),
  public.send_message(bigint, text), public.mark_read(bigint),
  public.toggle_favorite(bigint), public.flag_post(bigint, text),
  public.repost(bigint) to authenticated;

-- ============================ Storage ============================
insert into storage.buckets (id, name, public)
  values ('post-images', 'post-images', true)
  on conflict (id) do nothing;

drop policy if exists post_images_read on storage.objects;
create policy post_images_read on storage.objects for select
  using (bucket_id = 'post-images');
drop policy if exists post_images_write on storage.objects;
create policy post_images_write on storage.objects for insert to authenticated
  with check (bucket_id = 'post-images' and owner = auth.uid());
drop policy if exists post_images_delete on storage.objects;
create policy post_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'post-images' and owner = auth.uid());
