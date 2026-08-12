"""R38 (BD-182) - fit the owner's preferences from his three blind reviews.

Recovery 13.6: pairwise-labeled data -> a SIMPLE interpretable model whose
coefficients INFORM ranking weights. The production router stays
deterministic; this model never routes. n=29 non-ties, so the primary
output is the per-feature SIGN TEST (how often did the winner have the
better value), with a small L2-regularized logistic fit as the secondary
read. Both land in eval/reports/preference_fit.json.

Run: python eval/preference_fit.py
"""
import json, math, io

def load(p):
    return json.load(io.open(p, encoding="utf-8"))

def rows_by_fixture(path):
    d = load(path)
    out = {}
    for r in d.get("routes", []):
        key = f"{r.get('label','?')}|{r.get('brief','')}"
        out[key] = r
    return out

# sheet -> (key file, answers file, side-A source, side-B source)
SHEETS = [
    ("r33-loops", "eval/reports/blind_loops_key.json", "eval/reports/blind_loops_answers.json",
     "eval/reports/rq33/holdout-loops-P0_incumbent.json", "eval/reports/rq33/holdout-loops-P4_d45.json"),
    ("r33-atob", "eval/reports/blind_atob_key.json", "eval/reports/blind_atob_answers.json",
     "eval/reports/rq33/holdout-atob-P0_incumbent.json", "eval/reports/rq33/holdout-atob-P6_d30_manstrong.json"),
    ("r37", "eval/reports/blind_r37_key.json", "eval/reports/blind_r37_answers.json",
     "eval/reports/rq37/combined-r35.json", "eval/reports/rq37/combined-r36.json"),
]

FEATURES = ["backroad", "durErr", "turns", "continuityKm", "hood", "detour"]

def feats(r):
    tgt = r.get("targetMin")
    dur = r.get("durationMin")
    return {
        "backroad": (r.get("backroadPct") or 0) / 100.0,
        "durErr": abs(dur - tgt) / tgt if (tgt and dur) else None,
        "turns": r.get("turnsPer10min"),
        "continuityKm": (r.get("continuityMeanRunM") or 0) / 1000.0 or None,
        "hood": (r.get("hoodPct") or 0) / 100.0,
        "detour": r.get("detourRatio"),
    }

pairs = []  # (sheet, fixture, winner_feats, loser_feats, strength)
for name, kf, af, srcA, srcB in SHEETS:
    key, ans = load(kf), load(af)
    A, B = rows_by_fixture(srcA), rows_by_fixture(srcB)
    for p, meta in key.items():
        pref = ans.get(p, {}).get("preference")
        if pref in (None, "0"):
            continue
        side, strength = pref[0], int(pref[1:] or 1)
        left = meta["left"]
        winner_arm = left if side == "L" else ("A" if left == "B" else "B")
        fx = meta["fixture"]
        ra, rb = A.get(fx), B.get(fx)
        if not ra or not rb or ra.get("durationMin") is None or rb.get("durationMin") is None:
            continue
        w, l = (ra, rb) if winner_arm == "A" else (rb, ra)
        pairs.append((name, fx, feats(w), feats(l), strength))

# r36's two non-ties, values from the decision-log record (sources regenerated since)
pairs.append(("r36", "Newmarket|60m",
              {"backroad": .62, "durErr": abs(57-60)/60, "turns": None, "continuityKm": None, "hood": None, "detour": None},
              {"backroad": .21, "durErr": abs(88-60)/60, "turns": None, "continuityKm": None, "hood": None, "detour": None}, 1))
pairs.append(("r36", "Uxbridge|90m",
              {"backroad": .75, "durErr": abs(93-90)/90, "turns": None, "continuityKm": None, "hood": None, "detour": None},
              {"backroad": .54, "durErr": abs(97-90)/90, "turns": None, "continuityKm": None, "hood": None, "detour": None}, 2))

print(f"pairs assembled: {len(pairs)}")

# ---- sign test (the primary read at this n) ----
sign = {}
BETTER_LOW = {"durErr", "turns", "hood", "detour"}
for f in FEATURES:
    wins = ties = n = 0
    for _, _, w, l, _ in pairs:
        a, b = w.get(f), l.get(f)
        if a is None or b is None:
            continue
        n += 1
        if abs(a - b) < 1e-9:
            ties += 1
        elif (a < b) == (f in BETTER_LOW):
            wins += 1
    sign[f] = {"winnerHadBetter": wins, "ties": ties, "n": n,
               "rate": round(wins / max(1, n - ties), 2) if n - ties > 0 else None}

# ---- tiny L2 logistic on deltas (secondary) ----
X, S = [], []
for _, _, w, l, strength in pairs:
    row = []
    for f in FEATURES:
        a, b = w.get(f), l.get(f)
        d = 0.0 if (a is None or b is None) else (a - b)
        if f in BETTER_LOW:
            d = -d  # orient every feature so positive delta = "winner better"
        row.append(d)
    X.append(row)
    S.append(strength)

wgt = [0.0] * len(FEATURES)
LR, LAM = 0.5, 0.1
for _ in range(4000):
    grad = [LAM * wi for wi in wgt]
    for row, st in zip(X, S):
        z = sum(wi * xi for wi, xi in zip(wgt, row))
        g = -(1 / (1 + math.exp(z))) * st  # d/dw of -log sigmoid(z), strength-weighted
        for i, xi in enumerate(row):
            grad[i] += g * xi
    wgt = [wi - LR * gi / len(X) for wi, gi in zip(wgt, grad)]

fit = {f: round(w, 2) for f, w in zip(FEATURES, wgt)}
out = {"nPairs": len(pairs), "signTest": sign, "logisticOriented": fit,
       "note": "positive coefficient = feature (oriented so more is better) predicts his pick"}
io.open("eval/reports/preference_fit.json", "w", encoding="utf-8").write(json.dumps(out, indent=1))
print(json.dumps(out, indent=1))
