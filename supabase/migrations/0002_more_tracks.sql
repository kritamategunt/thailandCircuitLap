-- Tracks added after the MVP. Geometry lives in tracks/*.ts; this row only satisfies sessions.track_id FK.
insert into tracks (id, name, country)
values
  ('kaeng-krachan', 'Kaeng Krachan Circuit', 'TH'),
  ('msp-suvarnabhumi', 'Motor Sport Park Suvarnabhumi', 'TH')
on conflict (id) do nothing;
