-- Free Road: sessions on any road carry their own start/finish line (set from the live screen).
insert into tracks (id, name, country)
values ('free-road', 'Free Road', 'TH')
on conflict (id) do nothing;

alter table sessions add column if not exists start_finish jsonb;

