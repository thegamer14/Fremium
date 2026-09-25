create extension if not exists pgcrypto;

create table if not exists public.fremium_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  client_version text
);

create table if not exists public.fremium_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_synced_at timestamptz,
  last_event_at timestamptz,
  client_version text
);

create table if not exists public.fremium_listening_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null,
  occurred_at timestamptz not null,
  event_type text not null,
  track_uri text,
  track_name text,
  artist text,
  album text,
  context_uri text,
  position numeric,
  progress numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, event_id)
);

create index if not exists fremium_listening_events_user_time_idx on public.fremium_listening_events (user_id, occurred_at desc);
create index if not exists fremium_listening_events_track_idx on public.fremium_listening_events (user_id, track_uri);

create table if not exists public.fremium_qi_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null default 'global',
  snapshot_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb,
  leaders jsonb not null default '[]'::jsonb,
  current_track jsonb,
  context_uri text,
  client_version text,
  unique (user_id, session_id)
);

create index if not exists fremium_qi_snapshots_user_time_idx on public.fremium_qi_snapshots (user_id, snapshot_at desc);

alter table public.fremium_profiles enable row level security;
alter table public.fremium_sync_state enable row level security;
alter table public.fremium_listening_events enable row level security;
alter table public.fremium_qi_snapshots enable row level security;

drop policy if exists fremium_profiles_owner on public.fremium_profiles;
create policy fremium_profiles_owner on public.fremium_profiles for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists fremium_sync_state_owner on public.fremium_sync_state;
create policy fremium_sync_state_owner on public.fremium_sync_state for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists fremium_listening_events_owner on public.fremium_listening_events;
create policy fremium_listening_events_owner on public.fremium_listening_events for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists fremium_qi_snapshots_owner on public.fremium_qi_snapshots;
create policy fremium_qi_snapshots_owner on public.fremium_qi_snapshots for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on public.fremium_profiles to authenticated;
grant select, insert, update on public.fremium_sync_state to authenticated;
grant select, insert, update on public.fremium_listening_events to authenticated;
grant select, insert, update on public.fremium_qi_snapshots to authenticated;
