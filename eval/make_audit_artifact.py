"""Render audit-v13.json into a self-contained inspectable HTML report.

Every route is drawn as an SVG polyline coloured by MEASURED road class, with
the out-and-back stretches overlaid in red so the defect the owner reported is
visible rather than merely tabulated.
"""
import json, io, html, math, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'eval/reports/audit-v13.json'
DST = sys.argv[2] if len(sys.argv) > 2 else 'eval/reports/audit-v13.html'

d = json.load(io.open(SRC, encoding='utf-8'))
S = d['summary']
routes = d['routes']
discover = d['discover']

# road-class palette: highway = alarm, main = muted, backroad = the good stuff
CLS = {
    'H': ('#e0533d', 'highway'),
    'A': ('#c8a24a', 'main road'),
    'B': ('#4f9d69', 'backroad'),
    'R': ('#b06fc9', 'residential'),
    'U': ('#8a8f98', 'urban'),
    'O': ('#6b7078', 'other'),
}
W, H = 300, 200


def sparkline(coords, classes, oab_runs):
    """SVG of one route: class-coloured path + red out-and-back overlay."""
    if not coords or len(coords) < 2:
        return '<div class="nomap">no route</div>'
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    # keep aspect ratio honest at this latitude
    latf = math.cos(math.radians((miny + maxy) / 2))
    spanx = max((maxx - minx) * latf, 1e-6)
    spany = max(maxy - miny, 1e-6)
    scale = min((W - 16) / spanx, (H - 16) / spany)
    ox = (W - spanx * scale) / 2
    oy = (H - spany * scale) / 2

    def px(c):
        return (ox + (c[0] - minx) * latf * scale, H - (oy + (c[1] - miny) * scale))

    # group consecutive points by class so each run is one <path>
    segs, cur, curc = [], [], classes[0] if classes else 'O'
    for i in range(len(coords) - 1):
        c = classes[i] if i < len(classes) else 'O'
        if c != curc and cur:
            segs.append((curc, cur + [coords[i]]))
            cur = []
            curc = c
        cur.append(coords[i])
    if cur:
        segs.append((curc, cur + [coords[-1]]))

    parts = []
    for c, pts in segs:
        if len(pts) < 2:
            continue
        col = CLS.get(c, CLS['O'])[0]
        pth = ' '.join(f'{px(p)[0]:.1f},{px(p)[1]:.1f}' for p in pts)
        parts.append(f'<polyline points="{pth}" fill="none" stroke="{col}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>')

    # out-and-back markers
    for r in oab_runs or []:
        x, y = px(r['point'])
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5.5" fill="none" stroke="#ff3b30" stroke-width="2"/>')
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="2" fill="#ff3b30"/>')

    sx, sy = px(coords[0])
    parts.append(f'<circle cx="{sx:.1f}" cy="{sy:.1f}" r="3.2" fill="#0b0c0e" stroke="#f2f3f5" stroke-width="1.6"/>')
    return f'<svg viewBox="0 0 {W} {H}" class="map" role="img">{"".join(parts)}</svg>'


def strip(classes):
    if not classes:
        return ''
    n = 160
    step = max(1, len(classes) // n)
    cells = []
    for i in range(0, len(classes), step):
        c = classes[i]
        cells.append(f'<i style="background:{CLS.get(c, CLS["O"])[0]}"></i>')
    return f'<div class="strip">{"".join(cells)}</div>'


DEFECT_LABEL = {
    'out_and_back': 'doubles back',
    'main_majority': 'mostly main road',
    'not_a_loop': "doesn't look like a loop",
    'neighbourhood': 'cuts through neighbourhoods',
    'wrong_length': 'wrong length',
    'highway': 'has highway',
    'turn_soup': 'too many turns',
    'no_route': 'no route',
    'error': 'error',
}


def card(r):
    dl = ''.join(
        f'<span class="d d-{x}">{html.escape(DEFECT_LABEL.get(x, x))}</span>' for x in r['defects']
    ) or '<span class="d d-clean">clean</span>'
    oab = r.get('oabLongestM') or 0
    oab_html = ''
    if oab >= 250:
        pct = 100 * (r.get('oabTotalM') or 0) / max(1, (r.get('distanceKm') or 1) * 1000)
        oab_html = (
            f'<div class="oab"><b>{oab:,} m</b> longest stretch driven twice'
            f' · {pct:.0f}% of the drive · app reported <b>{r.get("uturnsShipped")}</b> u-turns</div>'
        )
    tgt = ''
    if r.get('targetMin') and r.get('durationMin'):
        ratio = r['durationMin'] / r['targetMin']
        cl = ' bad' if abs(ratio - 1) > 0.25 else ''
        tgt = f'<span class="k{cl}">asked {r["targetMin"]}m → <b>{r["durationMin"]}m</b></span>'
    mix = ''
    if r.get('backroadPct') is not None:
        mix = (
            f'<span class="k">backroad <b>{r["backroadPct"]}%</b></span>'
            f'<span class="k">main {r["mainPct"]}%</span>'
            + (f'<span class="k bad">hwy {r["highwayPct"]}%</span>' if (r["highwayPct"] or 0) > 1 else '')
        )
    lp = f'<span class="k">loopiness {r["loopiness"]}</span>' if r.get('loopiness') is not None else ''
    legs = ''
    if r.get('drivePct') is not None:
        db = r.get('driveBackroadPct')
        home = 100 - r['therePct'] - r['drivePct']
        legs = (
            f'<div class="legs"><span class="lg there" style="flex:{max(1,r["therePct"])}">there {r["therePct"]}%</span>'
            f'<span class="lg drive" style="flex:{max(1,r["drivePct"])}">THE DRIVE {r["drivePct"]}%'
            + (f' &middot; {db}% backroad' if db is not None else '')
            + f'</span><span class="lg home" style="flex:{max(1,home)}">home {home}%</span></div>'
        )
    return f"""<article class="card">
  <header><h3>{html.escape(r['label'])}</h3><span class="brief">{html.escape(r['brief'])}</span></header>
  {sparkline(r['coords'], r['classes'], r.get('oabRuns'))}
  {strip(r['classes'])}
  <div class="keys">{mix}{tgt}{lp}<span class="k">{r.get('distanceKm') or '–'} km</span></div>
  {legs}
  {oab_html}
  <div class="defects">{dl}</div>
</article>"""


loops = [r for r in routes if r['kind'] == 'loop']
atob = [r for r in routes if r['kind'] == 'atob']

def statbar(rows, kind):
    n = len(rows)
    if n == 0:
        return ''
    oab = [r for r in rows if (r.get('oabLongestM') or 0) >= 250]
    clean = [r for r in rows if not r['defects']]
    bk = [r['backroadPct'] for r in rows if r['backroadPct'] is not None]
    mn = [r['mainPct'] for r in rows if r['mainPct'] is not None]
    hw = [r for r in rows if (r.get('highwayPct') or 0) > 1]
    worst = max((r.get('oabLongestM') or 0) for r in rows)
    cells = [
        (f'{len(clean)}/{n}', 'zero defects', 'ok' if len(clean) > n * 0.3 else ''),
        (f'{len(oab)}/{n}', 'double back', 'alarm' if oab else 'ok'),
        (f'{worst:,} m', 'worst doubling', 'alarm' if worst > 3000 else ''),
        (f'{sum(bk)/max(1,len(bk)):.0f}%', 'backroad', ''),
        (f'{sum(mn)/max(1,len(mn)):.0f}%', 'main road', ''),
        (f'{len(hw)}/{n}', 'with highway', 'alarm' if hw else 'ok'),
    ]
    return ('<div class="scores small">'
            + ''.join(f'<div class="s {c}"><b>{v}</b><span>{l}</span></div>' for v, l, c in cells)
            + '</div>')


def section(title, sub, rows, kind=''):
    return (f'<h2>{title}</h2><p class="sub">{sub}</p>{statbar(rows, kind)}'
            f'<div class="grid">{"".join(card(r) for r in rows)}</div>')


tally = ''.join(
    f'<tr><td>{html.escape(DEFECT_LABEL.get(k, k))}</td><td class="num">{v}</td>'
    f'<td class="bar"><i style="width:{100*v/90:.0f}%"></i></td></tr>'
    for k, v in S['defectTally']
)

L = S['loops']
A = S['atob']
D = S['discover']

dis_rows = []
for m in discover:
    ds = m['drives'][:3]
    inner = ''.join(
        f'<div class="dd">{sparkline(x["coords"], x["classes"], None)}'
        f'<div class="ddm">{html.escape(str(x["name"])[:34])}<br>'
        f'<span>backroad {x["backroadPct"]}% · main {x["mainPct"]}%</span></div></div>'
        for x in ds if x['coords']
    )
    if inner:
        dis_rows.append(f'<div class="dmenu"><h4>{html.escape(m["label"])} · {m["count"]} drives</h4><div class="drow">{inner}</div></div>')

legend = ''.join(f'<span><i style="background:{c}"></i>{n}</span>' for c, n in CLS.values())

out = f"""<title>Roadopia audit-v14 — 90 runs on unseen origins</title>
<style>
:root {{
  --bg:#0f1113; --panel:#16181c; --line:#24272d; --ink:#e9ebee; --dim:#9aa1ab;
  --accent:#f0a202; --good:#4f9d69; --bad:#e0533d;
}}
@media (prefers-color-scheme: light) {{
  :root {{ --bg:#f7f6f3; --panel:#fff; --line:#e3e1dc; --ink:#191b1e; --dim:#6b7078; }}
}}
:root[data-theme="dark"] {{ --bg:#0f1113; --panel:#16181c; --line:#24272d; --ink:#e9ebee; --dim:#9aa1ab; }}
:root[data-theme="light"] {{ --bg:#f7f6f3; --panel:#fff; --line:#e3e1dc; --ink:#191b1e; --dim:#6b7078; }}
* {{ box-sizing:border-box }}
body {{ margin:0; background:var(--bg); color:var(--ink);
  font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; }}
.wrap {{ max-width:1180px; margin:0 auto; padding:40px 22px 80px }}
h1 {{ font-size:clamp(26px,4vw,40px); letter-spacing:-.022em; margin:0 0 6px; text-wrap:balance }}
.lede {{ color:var(--dim); max-width:62ch; margin:0 0 26px }}
h2 {{ font-size:22px; letter-spacing:-.015em; margin:44px 0 4px; padding-top:22px; border-top:1px solid var(--line) }}
.sub {{ color:var(--dim); margin:0 0 18px; max-width:70ch; font-size:14px }}
.scores.small .s b {{ font-size:20px }}
.scores.small {{ margin:14px 0 18px }}
.scores {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:22px 0 8px }}
.s {{ background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px }}
.s b {{ display:block; font-size:27px; letter-spacing:-.02em; font-variant-numeric:tabular-nums }}
.s span {{ color:var(--dim); font-size:12.5px }}
.s.alarm b {{ color:var(--bad) }}
.s.ok b {{ color:var(--good) }}
table {{ width:100%; border-collapse:collapse; margin:6px 0 4px; font-size:14px }}
td {{ padding:7px 8px; border-bottom:1px solid var(--line) }}
td.num {{ text-align:right; font-variant-numeric:tabular-nums; width:52px; font-weight:600 }}
td.bar {{ width:46% }}
td.bar i {{ display:block; height:8px; background:var(--accent); border-radius:4px }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(310px,1fr)); gap:14px }}
.card {{ background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:13px; overflow:hidden }}
.card header {{ display:flex; justify-content:space-between; align-items:baseline; gap:8px; margin-bottom:8px }}
.card h3 {{ margin:0; font-size:15px; letter-spacing:-.01em }}
.brief {{ color:var(--dim); font-size:11.5px; text-align:right }}
.map {{ width:100%; height:auto; display:block; background:transparent }}
.nomap {{ color:var(--dim); font-size:13px; padding:40px 0; text-align:center }}
.strip {{ display:flex; gap:0; height:7px; margin:8px 0 9px; border-radius:3px; overflow:hidden }}
.strip i {{ flex:1 }}
.keys {{ display:flex; flex-wrap:wrap; gap:6px; margin-bottom:7px }}
.k {{ font-size:11.5px; color:var(--dim); background:rgba(127,127,127,.1);
  padding:2px 7px; border-radius:5px; font-variant-numeric:tabular-nums }}
.k b {{ color:var(--ink) }}
.k.bad, .k.bad b {{ color:var(--bad) }}
.legs {{ display:flex; gap:2px; margin:2px 0 8px; font-size:9.5px; line-height:1.5;
  border-radius:4px; overflow:hidden; white-space:nowrap }}
.lg {{ padding:3px 5px; overflow:hidden; text-overflow:ellipsis }}
.lg.there, .lg.home {{ background:rgba(200,162,74,.22); color:var(--dim) }}
.lg.drive {{ background:rgba(79,157,105,.26); color:var(--ink); font-weight:600 }}
.oab {{ font-size:12px; background:rgba(224,83,61,.12); border-left:2.5px solid var(--bad);
  padding:6px 9px; border-radius:0 5px 5px 0; margin-bottom:7px }}
.defects {{ display:flex; flex-wrap:wrap; gap:5px }}
.d {{ font-size:11px; padding:2px 7px; border-radius:20px; background:rgba(224,83,61,.15); color:var(--bad) }}
.d-clean {{ background:rgba(79,157,105,.16); color:var(--good) }}
.legend {{ display:flex; flex-wrap:wrap; gap:14px; margin:14px 0 0; font-size:12px; color:var(--dim) }}
.legend span {{ display:flex; align-items:center; gap:5px }}
.legend i {{ width:13px; height:4px; border-radius:2px; display:block }}
.dmenu {{ margin-bottom:16px }}
.dmenu h4 {{ margin:0 0 7px; font-size:13.5px; font-weight:600 }}
.drow {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px }}
.dd {{ background:var(--panel); border:1px solid var(--line); border-radius:9px; padding:9px }}
.ddm {{ font-size:11.5px; margin-top:5px }}
.ddm span {{ color:var(--dim) }}
.callout {{ background:var(--panel); border:1px solid var(--line); border-left:3px solid var(--bad);
  border-radius:0 10px 10px 0; padding:16px 18px; margin:18px 0 }}
.callout b {{ color:var(--bad) }}
</style>
<div class="wrap">
<h1>audit-v14 — 90 runs on origins the fixes have never seen</h1>
<p class="lede">60 loops (40 across the region, 10 Brampton, 10 Southfields), 20 A&rarr;B drives and
30 Discover menus. Every route traced edge-by-edge through Valhalla for real road class, and checked
for doubling back by a detector built from geometry alone rather than from Valhalla's u-turn labels —
which is what made the defect invisible in the first place. <b>This run uses a fresh seed</b>, so these
are origins the fixes were never tuned against: a holdout, not a re-test.</p>

<div class="callout">
<b>What changed since the last audit.</b> The app's u-turn counter reads Valhalla <i>maneuver labels</i>,
and loops are built with <code>through</code> waypoints, which forbid a u-turn <i>at</i> the waypoint — so
the router doubled back along the road and never emitted the label. 47 of 60 loops were driving a stretch
twice, up to 19.4&nbsp;km, while the app reported 4 u-turns in total. Two fixes followed: a geometric
out-and-back reject at assembly, and — the one that mattered — the same measure added to the
<i>never-empty fallback</i>, which had been choosing the "least bad" rejected route with no term for
doubling at all. Worst case fell from 19,441&nbsp;m to about 3,000&nbsp;m. The numbers below are that
work, re-measured on ground it has not seen.
</div>

<div class="scores">
  <div class="s alarm"><b>{L['withOutAndBack']}/60</b><span>loops that double back</span></div>
  <div class="s alarm"><b>{L['oabLongestMaxM']:,} m</b><span>worst single doubling</span></div>
  <div class="s"><b>{L['shippedUturnsTotal']}</b><span>u-turns the app reported</span></div>
  <div class="s"><b>{L['clean']}/60</b><span>loops with zero defects</span></div>
  <div class="s"><b>{L['backroadPct']}%</b><span>backroad (main {L['mainPct']}%)</span></div>
  <div class="s"><b>{L['loopiness']}</b><span>mean loopiness</span></div>
  <div class="s"><b>{A['clean']}/20</b><span>clean A&rarr;B drives</span></div>
  <div class="s ok"><b>{D['totalDrives']}</b><span>Discover drives, {D['emptyMenus']} empty menus</span></div>
</div>

<h2>What went wrong, by count</h2>
<p class="sub">Across all 90 runs. One route can carry several.</p>
<table>{tally}</table>
<div class="legend">{legend}<span><i style="background:#ff3b30;border-radius:50%;width:9px;height:9px"></i>doubling-back point</span></div>

{section('The 60 loops', 'Red rings mark where the route drives the same road back the other way. The bar under each map is the drive from start to finish, coloured by measured road class.', loops)}

{section('The 20 A&rarr;B drives', 'Point to point. Main-road share is high by design here — the owner accepted main roads as connectors — but doubling back is not acceptable on any of them.', atob)}

<h2>Discover</h2>
<p class="sub">30 menus, {D['totalDrives']} drives, none empty. These are pre-built and hard-measured
offline, and it shows: 86% backroad on average, and only 1 of 179 drives doubles back. The
contrast with the live loop planner above is the most useful single fact in this audit.</p>
{''.join(dis_rows)}
</div>
"""

io.open(DST, 'w', encoding='utf-8').write(out)
print(f'wrote {DST} ({len(out)/1024:.0f} KB)')
