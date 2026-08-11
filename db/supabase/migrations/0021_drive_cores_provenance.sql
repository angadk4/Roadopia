-- R36-U12 (BD-168): provenance columns so the index supports INCREMENTAL
-- loading (merge / replace-cells) without losing track of what produced each
-- row. Additive, nullable — every existing row and reader is unaffected.
-- (Recovery §12.2: sweep_run_id, config_stamp, tileset identity per row.)

alter table drive_cores
  add column if not exists sweep_run_id text,
  add column if not exists config_stamp text,
  add column if not exists tileset_id  text;

comment on column drive_cores.sweep_run_id is
  'artifact identity that produced this row (suite@generatedAt from the manifest sidecar)';
comment on column drive_cores.config_stamp is
  'the sweep''s resumability STAMP (generator/cells/sizes/bars) at build time';
comment on column drive_cores.tileset_id is
  'Valhalla tileset_last_modified the row was routed against — a rebuilt tileset invalidates edge assumptions';
