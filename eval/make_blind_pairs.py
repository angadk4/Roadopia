"""R32-U2 — BLIND pairwise review sheet (Recovery §4.4).

Renders unlabeled side-by-side route cards from two audit artifacts so the
owner judges routes without knowing which system produced them. This is the
external signal that stops Roadopia over-fitting its own detectors — and from
R33 on it is an ADOPTION GATE for behavior changes.

Usage:
  python eval/make_blind_pairs.py A.json B.json --seed 7 --out eval/reports/blind
Produces:
  <out>_review.html      one page of side-by-side pairs, sides randomized
  <out>_key.json         the hidden A/B mapping (do NOT open before answering)
  <out>_answers.json     template the reviewer fills in (1-5 + preference)

Scoring: python eval/score_blind.py <out>_answers.json <out>_key.json
"""
import argparse, hashlib, html, io, json, random


def load_routes(path):
    d = json.load(io.open(path, encoding="utf-8"))
    rows = d.get("routes", d.get("rows", []))
    out = {}
    for r in rows:
        if r.get("kind") not in ("loop", "atob"):
            continue
        if not r.get("coords"):
            continue
        key = f"{r.get('label','?')}|{r.get('brief','')}"
        out[key] = r
    return out


def svg_of(coords, w=380, h=300):
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    dx, dy = (x1 - x0) or 1e-9, (y1 - y0) or 1e-9
    pad = 12
    pts = " ".join(
        f"{pad + (c[0]-x0)/dx*(w-2*pad):.1f},{pad + (1-(c[1]-y0)/dy)*(h-2*pad):.1f}"
        for c in coords
    )
    start = pts.split(" ")[0]
    return (
        f'<svg width="{w}" height="{h}" style="background:#f6f4ef;border:1px solid #d8d4c8">'
        f'<polyline points="{pts}" fill="none" stroke="#c77b28" stroke-width="2.2" '
        f'stroke-linejoin="round" stroke-linecap="round"/>'
        f'<circle cx="{start.split(",")[0]}" cy="{start.split(",")[1]}" r="5" fill="#2f5d3a"/>'
        "</svg>"
    )


def stat_table(r):
    rows = [
        ("duration", f"{r.get('durationMin','?')} min (asked {r.get('targetMin','—')})"),
        ("distance", f"{r.get('distanceKm','?')} km"),
        ("backroad", f"{r.get('backroadPct','?')} %"),
        ("main road", f"{r.get('mainPct','?')} %"),
        ("residential", f"{r.get('hoodPct','?')} %"),
        ("turns /10min", r.get("turnsPer10min", "?")),
        ("longest doubled", f"{r.get('oabLongestM','?')} m"),
    ]
    cells = "".join(
        f"<tr><td style='color:#777;padding:1px 8px 1px 0'>{k}</td><td>{v}</td></tr>"
        for k, v in rows
    )
    return f"<table style='font:12px monospace;border-collapse:collapse'>{cells}</table>"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("a")
    ap.add_argument("b")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default="eval/reports/blind")
    ap.add_argument("--max", type=int, default=24)
    args = ap.parse_args()

    A, B = load_routes(args.a), load_routes(args.b)
    shared = sorted(set(A) & set(B))
    rng = random.Random(args.seed)
    rng.shuffle(shared)
    shared = shared[: args.max]
    if not shared:
        raise SystemExit("no shared (label|brief) rows between the two artifacts")

    key, cards, answers = {}, [], {}
    for i, k in enumerate(shared):
        pid = f"p{i+1:02d}"
        a_left = rng.random() < 0.5
        left, right = (A[k], B[k]) if a_left else (B[k], A[k])
        key[pid] = {"left": "A" if a_left else "B", "fixture": k}
        answers[pid] = {"left_rating_1to5": None, "right_rating_1to5": None,
                        "preference": "one of: L2 L1 0 R1 R2 (L2 = left much better)"}
        rate_btns = lambda side: "".join(
            f"<button class='rb' data-pid='{pid}' data-side='{side}' data-val='{v}'>{v}</button>"
            for v in range(1, 6)
        )
        pref_btns = "".join(
            f"<button class='pb' data-pid='{pid}' data-val='{v}'>{lbl}</button>"
            for v, lbl in [("L2", "◀◀ left much"), ("L1", "◀ left"), ("0", "same"),
                           ("R1", "right ▶"), ("R2", "right much ▶▶")]
        )
        cards.append(
            f"<div class='pair' id='{pid}' style='margin:26px 0;border-top:2px solid #333;padding-top:10px'>"
            f"<b>{pid}</b> — {html.escape(k)} <span class='done-mark' style='color:#2f7d32'></span>"
            f"<div style='display:flex;gap:24px;margin-top:8px'>"
            f"<div><div style='font-weight:bold'>LEFT</div>{svg_of(left['coords'])}{stat_table(left)}"
            f"<div style='margin-top:6px'>rate: {rate_btns('left')}</div></div>"
            f"<div><div style='font-weight:bold'>RIGHT</div>{svg_of(right['coords'])}{stat_table(right)}"
            f"<div style='margin-top:6px'>rate: {rate_btns('right')}</div></div>"
            f"</div>"
            f"<div style='margin-top:8px'>which would you rather drive? {pref_btns}</div>"
            f"</div>"
        )

    answers_name = args.out.replace("\\", "/").split("/")[-1] + "_answers.json"
    form_js = """
<script>
const KEY='roadopia_blind_'+location.pathname.split('/').pop();
let state={};
try{state=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
function paint(){
  document.querySelectorAll('.rb,.pb').forEach(b=>{
    const s=state[b.dataset.pid]||{};
    const on=b.classList.contains('rb')
      ?String(s[b.dataset.side+'_rating_1to5'])===b.dataset.val
      :s.preference===b.dataset.val;
    b.style.background=on?'#2f5d3a':'#eee';b.style.color=on?'#fff':'#222';
  });
  let done=0,total=document.querySelectorAll('.pair').length;
  document.querySelectorAll('.pair').forEach(p=>{
    const s=state[p.id]||{};
    const ok=s.left_rating_1to5&&s.right_rating_1to5&&s.preference;
    p.querySelector('.done-mark').textContent=ok?' ✓':'';
    if(ok)done++;
  });
  document.getElementById('prog').textContent=done+'/'+total+' complete';
  document.getElementById('dl').disabled=done!==total;
}
document.addEventListener('click',e=>{
  const b=e.target;
  if(b.classList&&b.classList.contains('rb')){
    state[b.dataset.pid]=state[b.dataset.pid]||{};
    state[b.dataset.pid][b.dataset.side+'_rating_1to5']=Number(b.dataset.val);
  }else if(b.classList&&b.classList.contains('pb')){
    state[b.dataset.pid]=state[b.dataset.pid]||{};
    state[b.dataset.pid].preference=b.dataset.val;
  }else return;
  localStorage.setItem(KEY,JSON.stringify(state));paint();
});
function download(){
  const blob=new Blob([JSON.stringify(state,null,1)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=ANSWERS_NAME;a.click();
}
window.addEventListener('load',paint);
</script>"""
    page = (
        "<!doctype html><meta charset='utf-8'><title>Roadopia blind review</title>"
        "<body style='font-family:system-ui;max-width:900px;margin:24px auto'>"
        "<style>.rb,.pb{margin:0 3px;padding:4px 10px;border:1px solid #999;border-radius:6px;"
        "cursor:pointer;font:13px system-ui}</style>"
        "<h2>Blind route review</h2>"
        "<p>For each pair: rate LEFT and RIGHT 1–5 (1 unacceptable · 3 acceptable · "
        "5 excellent), then pick which you’d rather drive. Progress saves automatically; "
        "the download button unlocks when every pair is answered. Do <b>not</b> open the key file.</p>"
        f"<p style='position:sticky;top:0;background:#fff;padding:6px 0'><b id='prog'></b> "
        f"<button id='dl' onclick='download()' disabled>Download {answers_name}</button></p>"
        + "".join(cards)
        + f"<script>const ANSWERS_NAME={json.dumps(answers_name)};</script>"
        + form_js
        + "</body>"
    )
    io.open(f"{args.out}_review.html", "w", encoding="utf-8").write(page)
    io.open(f"{args.out}_key.json", "w", encoding="utf-8").write(json.dumps(key, indent=1))
    io.open(f"{args.out}_answers.json", "w", encoding="utf-8").write(json.dumps(answers, indent=1))
    fp = hashlib.sha256(json.dumps(key, sort_keys=True).encode()).hexdigest()[:12]
    print(f"wrote {args.out}_review.html ({len(shared)} pairs, key fp {fp})")


if __name__ == "__main__":
    main()
