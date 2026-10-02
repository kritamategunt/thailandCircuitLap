-- Thailand Circuit AI Track Engineer — initial schema (Supabase / PostgreSQL)
-- Run in Supabase SQL editor, or `supabase db push`.
--
-- Design notes (MVP):
--  * Track GEOMETRY lives in tracks/*.ts (single source of truth, versioned with code).
--    The `tracks` table only anchors foreign keys. track_sectors / track_corners tables are
--    intentionally omitted until geometry needs to be edited at runtime (extension point).
--  * Laps are DERIVED data: recomputed from gps_points by the server (idempotent upsert on
--    (session_id, lap_number) so lap IDs stay stable across recomputes).
--  * Points are idempotent on (session_id, ts) so the offline upload queue can retry safely.
--  * RLS is enabled with NO policies: the anon key can read/write nothing. All access goes
--    through Next.js API routes using the service-role key (server-side only).

create extension if not exists pgcrypto;

create table if not exists tracks (
  id          text primary key,
  name        text not null,
  country     text,
  created_at  timestamptz not null default now()
);

insert into tracks (id, name, country)
values ('thailand-circuit', 'Thailand Circuit', 'TH')
on conflict (id) do nothing;

create table if not exists sessions (
  id                uuid primary key default gen_random_uuid(),
  track_id          text not null references tracks(id),
  name              text,
  status            text not null default 'active' check (status in ('active', 'completed')),
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  write_token_hash  text not null,
  summary           jsonb,
  laps_computed_at  timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists sessions_track_idx on sessions (track_id, started_at desc);

create table if not exists laps (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references sessions(id) on delete cascade,
  lap_number      int  not null,
  kind            text not null check (kind in ('out', 'timed', 'in')),
  is_timed        boolean not null,
  start_ts        bigint not null,           -- epoch ms (device GPS time)
  end_ts          bigint not null,
  lap_time_ms     int    not null,
  distance_m      real   not null,
  max_speed_kmh   real   not null,
  avg_speed_kmh   real   not null,
  gps_quality     jsonb  not null,
  metrics         jsonb  not null,           -- full LapMetrics (forward-compatible)
  updated_at      timestamptz not null default now(),
  unique (session_id, lap_number)
);
create index if not exists laps_session_idx on laps (session_id, lap_number);
create index if not exists laps_best_idx on laps (session_id, lap_time_ms) where is_timed;

create table if not exists lap_sectors (
  lap_id     uuid not null references laps(id) on delete cascade,
  sector_id  text not null,
  start_ts   bigint,
  end_ts     bigint,
  time_ms    int,
  primary key (lap_id, sector_id)
);

create table if not exists gps_points (
  id          bigint generated always as identity primary key,
  session_id  uuid not null references sessions(id) on delete cascade,
  lap_id      uuid references laps(id) on delete set null, -- optional; laps resolve points by time range
  ts          bigint not null,                -- device fix timestamp, epoch ms
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  speed       real,                           -- m/s, null when device does not report it
  accuracy    real not null,
  altitude    real,
  heading     real,
  source      text not null default 'phone-gps', -- extension point: external-gps, imu, ...
  received_at timestamptz not null default now(),
  unique (session_id, ts)
);
create index if not exists gps_points_lap_idx on gps_points (lap_id);
-- (session_id, ts) unique constraint doubles as the main time-range index.

alter table tracks      enable row level security;
alter table sessions    enable row level security;
alter table laps        enable row level security;
alter table lap_sectors enable row level security;
alter table gps_points  enable row level security;
