-- Nearby: Supabase schema. Replaces firestore.rules.
-- Run once in the Supabase SQL editor, or let the "Deploy Supabase schema" workflow push it.
-- The owner email is written here, in src/main.js and in src/owner.js.

create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------- tables

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Friend' check (char_length(name) between 1 and 30),
  email text,
  code text not null unique check (code ~ '^NB-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  username text unique check (username ~ '^[a-z0-9_]{3,20}$'),
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  sharing boolean not null default true,
  discoverable boolean not null default true,
  onboarded boolean not null default false,
  notify_move boolean not null default true,
  history_share boolean not null default false,
  seen bigint,
  created timestamptz not null default now()
);

-- user_id shares their location with friend_id when share = true
create table public.friends (
  user_id uuid not null references public.profiles(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete cascade,
  since timestamptz not null default now(),
  share boolean not null default true,
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create index friends_friend_idx on public.friends(friend_id);

create table public.places (
  user_id uuid not null references public.profiles(id) on delete cascade,
  id text not null,
  name text not null check (char_length(name) <= 40),
  emoji text,
  lat double precision not null,
  lng double precision not null,
  radius real not null default 150,
  alert boolean not null default true,
  primary key (user_id, id)
);

create table public.alerts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  text text not null check (char_length(text) <= 200),
  uid uuid,
  place text,
  emoji text,
  ts timestamptz not null default now()
);
create index alerts_user_idx on public.alerts(user_id, ts desc);

create table public.history (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  ts bigint not null,
  speed real not null default 0
);
create index history_user_ts_idx on public.history(user_id, ts);

create table public.locations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  speed real not null default 0,
  ts bigint not null,
  battery int
);

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  from_name text,
  from_username text,
  to_name text,
  to_username text,
  ts timestamptz not null default now(),
  unique (from_id, to_id),
  check (from_id <> to_id)
);
create index requests_to_idx on public.requests(to_id);

create table public.bans (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  type text not null check (type in ('permanent', 'temporary')),
  until bigint,                       -- epoch ms, null = permanent
  reason text check (char_length(reason) <= 200),
  banned_by uuid,
  ts timestamptz not null default now()
);

create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) <= 60),
  body text not null check (char_length(body) <= 200),
  ts timestamptz not null default now()
);

-- ------------------------------------------------------ private helpers
-- Security definer so policies can look at other rows without recursion.

create function private.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and lower(u.email) = 'ytvas68@gmail.com'
      and u.email_confirmed_at is not null
  );
$$;

create function private.is_banned(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.bans b
    where b.user_id = p_uid
      and (b.until is null or b.until > (extract(epoch from now()) * 1000)::bigint)
  );
$$;

create function private.ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and not private.is_banned(auth.uid());
$$;

-- I have p_uid in my friends list
create function private.is_friend(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friends f where f.user_id = auth.uid() and f.friend_id = p_uid);
$$;

-- p_uid shares their location with me
create function private.sees(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friends f where f.user_id = p_uid and f.friend_id = auth.uid() and f.share);
$$;

create function private.history_visible(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.sees(p_uid)
     and coalesce((select p.history_share from public.profiles p where p.id = p_uid), false);
$$;

create function private.seg() returns text
language sql volatile set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 4);
$$;

create function private.assert_ok() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if private.is_banned(auth.uid()) then raise exception 'Account banned'; end if;
end $$;

grant execute on all functions in schema private to authenticated;

-- ------------------------------------------------------------- RPCs

-- Creates the caller's profile (with a unique friend code) on first sign in.
create function public.ensure_profile() returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  r public.profiles;
  u auth.users;
  i int;
begin
  perform private.assert_ok();
  select * into r from public.profiles where id = auth.uid();
  if found then return r; end if;
  select * into u from auth.users where id = auth.uid();
  for i in 1..10 loop
    begin
      insert into public.profiles (id, name, email, code, seen)
      values (
        auth.uid(),
        left(coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), nullif(u.raw_user_meta_data->>'name', ''), 'Friend'), 30),
        u.email,
        'NB-' || private.seg() || '-' || private.seg(),
        (extract(epoch from now()) * 1000)::bigint
      ) returning * into r;
      return r;
    exception when unique_violation then
      select * into r from public.profiles where id = auth.uid();
      if found then return r; end if;
    end;
  end loop;
  raise exception 'Could not create profile';
end $$;

-- A friend code adds instantly.
create function public.add_friend_by_code(p_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare other uuid;
begin
  perform private.assert_ok();
  select id into other from public.profiles where code = upper(trim(p_code));
  if other is null then raise exception 'Code not found'; end if;
  if other = auth.uid() then raise exception 'That is your own code'; end if;
  if exists (select 1 from public.friends where user_id = auth.uid() and friend_id = other) then
    raise exception 'Already friends';
  end if;
  insert into public.friends (user_id, friend_id) values (auth.uid(), other), (other, auth.uid())
    on conflict do nothing;
  delete from public.requests
    where (from_id = auth.uid() and to_id = other) or (from_id = other and to_id = auth.uid());
end $$;

-- A username sends a request (or accepts one they already sent you).
create function public.send_request(p_username text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  me public.profiles;
  rev uuid;
begin
  perform private.assert_ok();
  select * into t from public.profiles where username = lower(ltrim(trim(p_username), '@'));
  if not found then raise exception 'No user found'; end if;
  if t.id = auth.uid() then raise exception 'That is you'; end if;
  if exists (select 1 from public.friends where user_id = auth.uid() and friend_id = t.id) then
    raise exception 'Already friends';
  end if;
  select id into rev from public.requests where from_id = t.id and to_id = auth.uid();
  if rev is not null then
    insert into public.friends (user_id, friend_id) values (auth.uid(), t.id), (t.id, auth.uid())
      on conflict do nothing;
    delete from public.requests where id = rev;
    return jsonb_build_object('status', 'accepted', 'name', t.name);
  end if;
  if not t.discoverable then raise exception 'Could not add that user'; end if;
  select * into me from public.profiles where id = auth.uid();
  insert into public.requests (from_id, to_id, from_name, from_username, to_name, to_username)
  values (auth.uid(), t.id, me.name, me.username, t.name, t.username)
  on conflict (from_id, to_id) do nothing;
  return jsonb_build_object('status', 'sent', 'name', t.name);
end $$;

create function public.accept_request(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.requests;
begin
  perform private.assert_ok();
  select * into r from public.requests where id = p_id and to_id = auth.uid();
  if not found then raise exception 'Request not found'; end if;
  insert into public.friends (user_id, friend_id) values (r.to_id, r.from_id), (r.from_id, r.to_id)
    on conflict do nothing;
  delete from public.requests where id = p_id;
end $$;

create function public.remove_friend(p_uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_ok();
  delete from public.friends
    where (user_id = auth.uid() and friend_id = p_uid) or (user_id = p_uid and friend_id = auth.uid());
end $$;

-- Owner panel: every account with its friend count, last location time and active ban.
create function public.owner_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  select jsonb_build_object(
    'places', (select count(*) from public.places),
    'users', coalesce(jsonb_agg(jsonb_build_object(
      'uid', p.id,
      'name', p.name,
      'username', coalesce(p.username, ''),
      'email', coalesce(p.email, ''),
      'created', (extract(epoch from p.created) * 1000)::bigint,
      'seen', coalesce(p.seen, 0),
      'onboarded', p.onboarded,
      'friends', (select count(*) from public.friends f where f.user_id = p.id),
      'last', coalesce((select l.ts from public.locations l where l.user_id = p.id), 0),
      'ban', (select jsonb_build_object('until', b.until, 'reason', coalesce(b.reason, ''))
              from public.bans b
              where b.user_id = p.id and (b.until is null or b.until > (extract(epoch from now()) * 1000)::bigint))
    ) order by p.created desc), '[]'::jsonb)
  ) into res
  from public.profiles p;
  return res;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.ensure_profile(), public.add_friend_by_code(text), public.send_request(text),
  public.accept_request(uuid), public.remove_friend(uuid), public.owner_overview()
  to authenticated;

-- ---------------------------------------------------- privileges + RLS

revoke all on all tables in schema public from anon, authenticated;

alter table public.profiles   enable row level security;
alter table public.friends    enable row level security;
alter table public.places     enable row level security;
alter table public.alerts     enable row level security;
alter table public.history    enable row level security;
alter table public.locations  enable row level security;
alter table public.requests   enable row level security;
alter table public.bans       enable row level security;
alter table public.broadcasts enable row level security;

-- profiles: rows are created only by ensure_profile(); email, code and created are never client-writable
grant select on public.profiles to authenticated;
grant update (name, username, color, onboarded, sharing, discoverable, notify_move, history_share, seen)
  on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (private.is_owner() or (private.ok() and (id = auth.uid() or private.is_friend(id))));
create policy profiles_update on public.profiles for update to authenticated
  using (private.ok() and id = auth.uid()) with check (private.ok() and id = auth.uid());

-- friends: rows are created and removed only by the RPCs; you can flip your own share switch
grant select on public.friends to authenticated;
grant update (share) on public.friends to authenticated;
create policy friends_select on public.friends for select to authenticated
  using (private.is_owner() or (private.ok() and (user_id = auth.uid() or friend_id = auth.uid())));
create policy friends_update on public.friends for update to authenticated
  using (private.ok() and user_id = auth.uid()) with check (private.ok() and user_id = auth.uid());

-- places
grant select, insert, update, delete on public.places to authenticated;
create policy places_select on public.places for select to authenticated
  using (private.is_owner() or (private.ok() and user_id = auth.uid()));
create policy places_insert on public.places for insert to authenticated
  with check (private.ok() and user_id = auth.uid());
create policy places_update on public.places for update to authenticated
  using (private.ok() and user_id = auth.uid()) with check (private.ok() and user_id = auth.uid());
create policy places_delete on public.places for delete to authenticated
  using (private.ok() and user_id = auth.uid());

-- alerts: written and read by the person they belong to
grant select, insert, delete on public.alerts to authenticated;
create policy alerts_select on public.alerts for select to authenticated
  using (private.ok() and user_id = auth.uid());
create policy alerts_insert on public.alerts for insert to authenticated
  with check (private.ok() and user_id = auth.uid());
create policy alerts_delete on public.alerts for delete to authenticated
  using (private.ok() and user_id = auth.uid());

-- history: own, or friends you share with when the owner of the history turned sharing on
grant select, insert, delete on public.history to authenticated;
create policy history_select on public.history for select to authenticated
  using (private.ok() and (user_id = auth.uid() or private.history_visible(user_id)));
create policy history_insert on public.history for insert to authenticated
  with check (private.ok() and user_id = auth.uid());
create policy history_delete on public.history for delete to authenticated
  using (private.ok() and user_id = auth.uid());

-- locations
grant select, insert, update, delete on public.locations to authenticated;
create policy locations_select on public.locations for select to authenticated
  using (private.is_owner() or (private.ok() and (user_id = auth.uid() or private.sees(user_id))));
create policy locations_insert on public.locations for insert to authenticated
  with check (private.ok() and user_id = auth.uid());
create policy locations_update on public.locations for update to authenticated
  using (private.ok() and user_id = auth.uid()) with check (private.ok() and user_id = auth.uid());
create policy locations_delete on public.locations for delete to authenticated
  using (private.is_owner());

-- requests: created only by send_request(), accepted only by accept_request()
grant select, delete on public.requests to authenticated;
create policy requests_select on public.requests for select to authenticated
  using (private.ok() and (from_id = auth.uid() or to_id = auth.uid()));
create policy requests_delete on public.requests for delete to authenticated
  using (private.ok() and (from_id = auth.uid() or to_id = auth.uid()));

-- bans: readable by the banned person (so a banned app can show the screen) and the owner
grant select, insert, update, delete on public.bans to authenticated;
create policy bans_select on public.bans for select to authenticated
  using (auth.uid() is not null and (user_id = auth.uid() or private.is_owner()));
create policy bans_insert on public.bans for insert to authenticated
  with check (private.is_owner() and user_id <> auth.uid());
create policy bans_update on public.bans for update to authenticated
  using (private.is_owner() and user_id <> auth.uid()) with check (private.is_owner() and user_id <> auth.uid());
create policy bans_delete on public.bans for delete to authenticated
  using (private.is_owner());

-- broadcasts
grant select, insert, delete on public.broadcasts to authenticated;
create policy broadcasts_select on public.broadcasts for select to authenticated
  using (private.ok());
create policy broadcasts_insert on public.broadcasts for insert to authenticated
  with check (private.is_owner());
create policy broadcasts_delete on public.broadcasts for delete to authenticated
  using (private.is_owner());

-- --------------------------------------------------------- realtime

do $$
declare t text;
begin
  foreach t in array array['profiles', 'friends', 'places', 'alerts', 'locations', 'requests', 'bans', 'broadcasts'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
