"""R32-U2 — score a completed blind review (Recovery §4.4/§17.4).

Usage: python eval/score_blind.py <answers.json> <key.json>
Reports per-arm mean rating, pairwise wins, and the adoption read-out. The raw
distribution is printed too — never optimize a single magic percentage.
"""
import io, json, sys

PREF_SCORE = {"L2": 2, "L1": 1, "0": 0, "R1": -1, "R2": -2}


def main():
    answers = json.load(io.open(sys.argv[1], encoding="utf-8"))
    key = json.load(io.open(sys.argv[2], encoding="utf-8"))
    ratings = {"A": [], "B": []}
    wins = {"A": 0, "B": 0, "tie": 0}
    dist = {}
    for pid, ans in answers.items():
        if pid not in key:
            continue
        left_arm = key[pid]["left"]
        right_arm = "B" if left_arm == "A" else "A"
        lr, rr = ans.get("left_rating_1to5"), ans.get("right_rating_1to5")
        if isinstance(lr, (int, float)):
            ratings[left_arm].append(lr)
        if isinstance(rr, (int, float)):
            ratings[right_arm].append(rr)
        pref = str(ans.get("preference", "")).strip().upper()
        if pref in PREF_SCORE:
            s = PREF_SCORE[pref]
            dist[pref] = dist.get(pref, 0) + 1
            if s > 0:
                wins[left_arm] += 1
            elif s < 0:
                wins[right_arm] += 1
            else:
                wins["tie"] += 1
    n = wins["A"] + wins["B"] + wins["tie"]
    print("=== blind review score ===")
    for arm in ("A", "B"):
        rs = ratings[arm]
        mean = sum(rs) / len(rs) if rs else float("nan")
        print(f"arm {arm}: mean rating {mean:.2f} over {len(rs)} cards · pairwise wins {wins[arm]}/{n}")
    print(f"ties: {wins['tie']}/{n} · raw preference distribution: {dist}")
    if n:
        print(
            "adoption read-out: the CHALLENGER must be clearly preferred on a strong majority "
            "and introduce no new hard-defect class (Recovery §17.4) — judge the distribution, "
            "not one number."
        )


if __name__ == "__main__":
    main()
