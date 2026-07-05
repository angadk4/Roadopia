#!/usr/bin/env python3
"""SPK-04 — scripted latency + RAM probe for the VPS Valhalla instance.

Runs ON the VPS next to the `valhalla` container (stdlib only, python3).
Measures, per Backlog SPK-04 Guidance/Tests:
  - /route        p50/p90/p95/max over 100 seeded town-pair requests (the AC metric)
  - /isochrone    5 samples (15-min auto contour)
  - /trace_route  5 samples (map-match of a real route shape via encoded_polyline)
  - serving peak RSS of the container (cgroup v2 memory.peak; docker stats fallback)
and prints AC verdicts: route p95 < 1000 ms; serving peak RSS <= 60% of box RAM.

Town points are real corridor towns (not random bbox points, which would snap into
Lake Ontario); pairs are seeded → the probe is reproducible.
"""

import json
import random
import subprocess
import time
import urllib.request

BASE = "http://127.0.0.1:8002"

# (name, lat, lon) — all inside data/region.poly (WGH/Niagara corridor)
TOWNS = [
    ("Hamilton", 43.2557, -79.8711),
    ("Dundas", 43.2647, -79.9540),
    ("Ancaster", 43.2180, -79.9870),
    ("Burlington", 43.3255, -79.7990),
    ("Milton-S", 43.5083, -79.8774),
    ("Grimsby", 43.2000, -79.5620),
    ("Smithville", 43.0965, -79.5482),
    ("St. Catharines", 43.1594, -79.2469),
    ("Niagara Falls", 43.0896, -79.0849),
    ("NOTL", 43.2553, -79.0715),
    ("Welland", 42.9922, -79.2482),
    ("Port Colborne", 42.8866, -79.2515),
    ("Fort Erie", 42.9040, -78.9280),
    ("Caledonia", 43.0731, -79.9527),
    ("Brantford", 43.1394, -80.2644),
]


def post(path: str, payload: dict, timeout: float = 10.0):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = json.loads(r.read())
    return (time.perf_counter() - t0) * 1000.0, body


def pct(sorted_ms, p):
    if not sorted_ms:
        return float("nan")
    i = min(len(sorted_ms) - 1, round(p * (len(sorted_ms) - 1)))
    return sorted_ms[i]


def container_peak_mib() -> tuple[float, str]:
    for f, label in (("memory.peak", "cgroup memory.peak"), ("memory.current", "cgroup memory.current")):
        try:
            out = subprocess.run(
                ["docker", "exec", "valhalla", "cat", f"/sys/fs/cgroup/{f}"],
                capture_output=True, text=True, timeout=10, check=True,
            ).stdout.strip()
            return int(out) / (1024 * 1024), label
        except Exception:
            continue
    out = subprocess.run(
        ["docker", "stats", "--no-stream", "--format", "{{.MemUsage}}", "valhalla"],
        capture_output=True, text=True, timeout=15, check=True,
    ).stdout.split("/")[0].strip()
    val = float(out.rstrip("KMGiB"))
    mib = val * 1024 if "GiB" in out else (val / 1024 if "KiB" in out else val)
    return mib, "docker stats (instantaneous)"


def box_total_mib() -> float:
    with open("/proc/meminfo") as f:
        for line in f:
            if line.startswith("MemTotal"):
                return int(line.split()[1]) / 1024
    return 0.0


def main() -> None:
    # warm-up (untimed): first request pays lazy tile/index loading
    post("/route", {"locations": [{"lat": TOWNS[0][1], "lon": TOWNS[0][2]},
                                  {"lat": TOWNS[5][1], "lon": TOWNS[5][2]}], "costing": "auto"})

    random.seed(42)
    pairs = [random.sample(TOWNS, 2) for _ in range(100)]
    ms_list, fails, shape = [], 0, None
    for a, b in pairs:
        try:
            ms, body = post("/route", {"locations": [{"lat": a[1], "lon": a[2]},
                                                     {"lat": b[1], "lon": b[2]}], "costing": "auto"})
            ms_list.append(ms)
            if shape is None:
                shape = body["trip"]["legs"][0]["shape"]
        except Exception:
            fails += 1
    ms_list.sort()

    iso_ms = []
    for name, lat, lon in random.sample(TOWNS, 5):
        try:
            ms, _ = post("/isochrone", {"locations": [{"lat": lat, "lon": lon}], "costing": "auto",
                                        "contours": [{"time": 15}], "polygons": True}, timeout=20)
            iso_ms.append(ms)
        except Exception:
            iso_ms.append(float("nan"))

    trace_ms = []
    if shape:
        for _ in range(5):
            try:
                ms, _ = post("/trace_route", {"encoded_polyline": shape, "costing": "auto",
                                              "shape_match": "map_snap"}, timeout=20)
                trace_ms.append(ms)
            except Exception:
                trace_ms.append(float("nan"))

    peak_mib, how = container_peak_mib()
    total_mib = box_total_mib()
    limit_mib = total_mib * 0.6

    print("=== SPK-04 Valhalla probe (on-box) ===")
    print(f"/route     n={len(ms_list)} ok, {fails} failed | "
          f"p50 {pct(ms_list, .50):.0f} ms | p90 {pct(ms_list, .90):.0f} ms | "
          f"p95 {pct(ms_list, .95):.0f} ms | max {pct(ms_list, 1.0):.0f} ms")
    print(f"/isochrone samples (15-min): {[f'{m:.0f}' for m in iso_ms]} ms")
    print(f"/trace_route samples:        {[f'{m:.0f}' for m in trace_ms]} ms")
    print(f"serving RSS: {peak_mib:.0f} MiB ({how}) | box {total_mib:.0f} MiB | 60% limit {limit_mib:.0f} MiB")
    print("--- AC ---")
    p95 = pct(ms_list, .95)
    ok_lat = p95 < 1000 and len(ms_list) >= 90
    ok_ram = peak_mib <= limit_mib
    print(f"route p95 < 1 s:        {'PASS' if ok_lat else 'FAIL'} ({p95:.0f} ms, {fails} failures)")
    print(f"peak RSS <= 60% of box: {'PASS' if ok_ram else 'FAIL'} ({peak_mib:.0f} / {limit_mib:.0f} MiB)")


if __name__ == "__main__":
    main()
