-- FK so PostgREST can embed author username on posts (user_id also -> profiles.id)
alter table public.posts drop constraint if exists posts_author_fk;
alter table public.posts add constraint posts_author_fk
  foreign key (user_id) references public.profiles(id) on delete cascade;

-- Enriched conversation list for the current user
create or replace function public.my_conversations()
returns table (id bigint, post_id bigint, post_title text, post_status text,
  role text, counterpart text, last_message text, last_at timestamptz,
  unread int, updated_at timestamptz)
language sql security definer set search_path = public as $$
  select c.id, c.post_id,
    coalesce(p.title,'[deleted post]'), coalesce(p.status,'removed'),
    case when c.poster_id = auth.uid() then 'poster' else 'replier' end,
    case when c.poster_id = auth.uid() then 'Replier' else 'Poster' end,
    (select m.body from messages m where m.conversation_id=c.id order by m.id desc limit 1),
    coalesce((select m.created_at from messages m where m.conversation_id=c.id order by m.id desc limit 1), c.created_at),
    (select count(*)::int from messages m where m.conversation_id=c.id and m.sender_id<>auth.uid() and m.read_at is null),
    c.updated_at
  from conversations c left join posts p on p.id=c.post_id
  where c.poster_id = auth.uid() or c.replier_id = auth.uid()
  order by c.updated_at desc;
$$;

create or replace function public.unread_count()
returns int language sql security definer set search_path = public as $$
  select coalesce(count(*),0)::int from messages m
  join conversations c on c.id=m.conversation_id
  where (c.poster_id=auth.uid() or c.replier_id=auth.uid())
    and m.sender_id<>auth.uid() and m.read_at is null;
$$;

grant execute on function public.my_conversations(), public.unread_count() to authenticated;
