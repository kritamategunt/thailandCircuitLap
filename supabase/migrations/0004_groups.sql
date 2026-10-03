-- Groups: friends ride together and watch each other live. The group UUID in /group/<id> is the
-- capability (same model as /live/<session id>) — anyone with the link can watch and join.
create table if not exists groups (
  id          uuid primary key default gen_random_uuid(),
  track_id    text not null references tracks(id),
  name        text,
  created_at  timestamptz not null default now()
);

alter table sessions add column if not exists group_id uuid references groups(id) on delete set null;
create index if not exists sessions_group_idx on sessions (group_id, started_at desc) where group_id is not null;

-- Group live view polls "points received since" (server clock: immune to phone clock skew).
create index if not exists gps_points_received_idx on gps_points (session_id, received_at);

alter table groups enable row level security;
