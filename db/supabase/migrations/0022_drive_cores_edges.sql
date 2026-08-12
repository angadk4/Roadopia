-- R37-U13 (BD-178): DIRECTED EDGE IDENTITY per core — the offline-first step
-- of edge-native truth (Recovery §6.1). Additive, nullable; every existing
-- row and reader unaffected. GraphIds are tileset-scoped, so rows already
-- carry tileset_id (0021) — edge data traced on another tileset is invalid
-- and must be re-captured (the reader's contract, enforced in eval tooling).

alter table drive_cores
  add column if not exists edges    jsonb,
  add column if not exists edge_sig text;

comment on column drive_cores.edges is
  'directed edge sequence [{graphId, wayId, forward, lengthM}] traced on tileset_id — GraphIds invalid after a tileset rebuild';
comment on column drive_cores.edge_sig is
  'compact directed-road signature (coalesced wayId+dir runs) — OSM-stable across tileset rebuilds; the edge-native dedup key';

-- index the signature for grouping/dedup scans
create index if not exists drive_cores_edge_sig_idx on drive_cores (generator_version, kind, edge_sig)
  where edge_sig is not null;
