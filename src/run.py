"""
Whole experiment, start to finish:

  1. load the simulated hands and split them by SHOE into train (80%) and test (20%)
  2. tune each model with 5-fold cross-validation grouped by shoe (test never touched)
  3. side analyses on a train-only split: count ablation + learning curve
  4. refit the chosen settings on all training shoes, score the test shoes once
  5. compare against the big reference simulation and the noise floor
  6. dump everything to results/results.json and docs/data.js for the website

    cd src && python run.py
"""
import json
import time
import numpy as np
from sklearn.model_selection import GroupKFold

from features import add_columns, HAND_TYPES, count_bin, N_COUNT_BINS, COUNT_EDGES
from models import Constant, Table, TableCount, Logistic, Boosted, clip
from metrics import row_logloss, row_brier, summary, reliability, shoe_bootstrap

SEED = 335
T0 = time.time()
def log(*a):
    print(f"[{time.time() - T0:6.0f}s]", *a, flush=True)

# ------------------------------------------------------------------ data + split
d = dict(np.load("../data/hands.npz"))
add_columns(d)
y = d["win"]
shoe = d["shoe_id"]

shoes = np.unique(shoe)
rng = np.random.default_rng(SEED)
test_shoes = np.sort(rng.choice(shoes, size=int(0.2 * len(shoes)), replace=False))
is_test = np.isin(shoe, test_shoes)
tr_idx, te_idx = np.where(~is_test)[0], np.where(is_test)[0]
np.savetxt("../results/test_shoes.txt", test_shoes, fmt="%d")
log(f"{len(y)} rows, {len(shoes)} shoes | train {len(tr_idx)} rows, test {len(te_idx)} rows")

folds = list(GroupKFold(n_splits=5).split(tr_idx, groups=shoe[tr_idx]))

def cv(make):
    scores = []
    for a, b in folds:
        m = make().fit(d, tr_idx[a])
        scores.append(row_logloss(y[tr_idx[b]], m.predict(d, tr_idx[b])).mean())
    return float(np.mean(scores)), float(np.std(scores))

# ------------------------------------------------------------------ tuning
grids = {
    "Table":         [({"m": m}, lambda m=m: Table(m)) for m in [1, 10, 100]],
    "Table+count":   [({"m": m}, lambda m=m: TableCount(m)) for m in [20, 100, 500, 2000, 10000]],
    "Logistic":      [({"C": c}, lambda c=c: Logistic(c)) for c in [0.01, 0.1, 1.0, 10.0]],
    "Boosted trees": [(kw, lambda kw=kw: Boosted(**kw)) for kw in [
        dict(max_leaf_nodes=15, learning_rate=0.1, max_iter=100),
        dict(max_leaf_nodes=15, learning_rate=0.05, max_iter=300),
        dict(max_leaf_nodes=31, learning_rate=0.05, max_iter=300),
        dict(max_leaf_nodes=63, learning_rate=0.05, max_iter=300)]],
}
cv_table, best = {}, {}
for name, grid in grids.items():
    rows = []
    for params, make in grid:
        mu, sd = cv(make)
        rows.append({"params": params, "cv_logloss": mu, "cv_sd": sd})
        log(f"cv {name:14s} {params} -> {mu:.5f} (sd {sd:.5f})")
    cv_table[name] = rows
    k = int(np.argmin([r["cv_logloss"] for r in rows]))
    best[name] = grid[k]
    log(f"   picked {grid[k][0]}")
make_best = {"Constant": Constant, **{k: v[1] for k, v in best.items()}}
best_params = {k: v[0] for k, v in best.items()}

# ------------------------------------------------------------------ train-only analysis split
a_tr, a_va = tr_idx[folds[0][0]], tr_idx[folds[0][1]]

def with_count(col):
    d2 = dict(d)
    d2["est_count"] = np.zeros_like(d["est_count"]) if col is None else d[col]
    return d2

ablation = []
for model_name in ["Logistic", "Boosted trees"]:
    losses = {}
    for label, col in [("no count", None), ("player's estimated count", "est_count"),
                       ("exact count", "true_count")]:
        dd = with_count(col)
        m = make_best[model_name]().fit(dd, a_tr)
        losses[label] = row_logloss(y[a_va], m.predict(dd, a_va))
    for label in ["player's estimated count", "exact count"]:
        mu, lo, hi = shoe_bootstrap(losses["no count"] - losses[label], shoe[a_va], 1000)
        ablation.append({"model": model_name, "count": label,
                         "logloss": float(losses[label].mean()),
                         "gain_vs_no_count": mu, "lo": lo, "hi": hi})
    ablation.append({"model": model_name, "count": "no count",
                     "logloss": float(losses["no count"].mean()),
                     "gain_vs_no_count": 0.0, "lo": 0.0, "hi": 0.0})
    log("ablation", model_name, "done")

curve = []
a_shoes = np.unique(shoe[a_tr])
for frac in [0.01, 0.03, 0.1, 0.3, 1.0]:
    pick = np.random.default_rng(1).choice(a_shoes, size=max(5, int(frac * len(a_shoes))), replace=False)
    sub = a_tr[np.isin(shoe[a_tr], pick)]
    point = {"frac": frac, "rows": int(len(sub))}
    for name in ["Constant", "Table", "Table+count", "Logistic", "Boosted trees"]:
        m = make_best[name]().fit(d, sub)
        point[name] = float(row_logloss(y[a_va], m.predict(d, a_va)).mean())
    curve.append(point)
    log("learning curve", frac, len(sub))

# ------------------------------------------------------------------ final fit, test scored once
final, preds = {}, {}
for name in ["Constant", "Table", "Table+count", "Logistic", "Boosted trees"]:
    final[name] = make_best[name]().fit(d, tr_idx)
    preds[name] = final[name].predict(d, te_idx)
log("final models fit")

yt, gt = y[te_idx], shoe[te_idx]
ref = np.load("../data/reference_cells.npz")
ref_n, ref_w = ref["n"], ref["w"]
ref_p = ref_w / np.maximum(ref_n, 1)
ref_var = ref_p * (1 - ref_p) / np.maximum(ref_n, 1)
cell = d["state_id"][te_idx].astype(np.int64) * N_COUNT_BINS + count_bin(d["est_count"][te_idx])
pr, vr = ref_p[cell], ref_var[cell]

# noise floor: what a model that knew the true P(win) in every cell would score
floor_brier = float(np.mean(pr * (1 - pr) + vr))
pc = clip(pr)
floor_logloss = float(np.mean(-(pc * np.log(pc) + (1 - pc) * np.log(1 - pc))))
# best possible accuracy at a 0.5 cut-off, if the true P(win) were known (only used to explain why accuracy is a poor metric here)
ceiling_accuracy = float(np.mean(np.maximum(pr, 1 - pr)))

test_rows = []
base_ll = row_logloss(yt, preds["Table"])
base_br = row_brier(yt, preds["Table"])
for name, p in preds.items():
    s = summary(yt, p)
    ll, br = row_logloss(yt, p), row_brier(yt, p)
    s["logloss_ci"] = shoe_bootstrap(ll, gt)[1:]
    s["brier_ci"] = shoe_bootstrap(br, gt)[1:]
    dl = shoe_bootstrap(base_ll - ll, gt)
    db = shoe_bootstrap(base_br - br, gt)
    s["ll_gain_vs_table"], s["ll_gain_ci"] = dl[0], dl[1:]
    s["brier_gain_vs_table"], s["brier_gain_ci"] = db[0], db[1:]
    # distance to the reference P(win), with the reference's own sampling noise removed
    mse = shoe_bootstrap((p - pr) ** 2 - vr, gt)
    s["rmse_to_ref"] = float(np.sqrt(max(mse[0], 0)))
    s["rmse_to_ref_ci"] = [float(np.sqrt(max(mse[1], 0))), float(np.sqrt(max(mse[2], 0)))]
    s["model"] = name
    s["params"] = best_params.get(name, {})
    test_rows.append(s)
    log(f"test {name:14s} ll {s['logloss']:.5f} brier {s['brier']:.5f} auc {s['auc']:.4f} "
        f"ece {s['ece']:.4f} rmse_ref {s['rmse_to_ref']:.4f}")

calib = {n: reliability(yt, p) for n, p in preds.items() if n != "Constant"}

# ------------------------------------------------------------------ errors
# (a) outcomes that surprised every model: low P(win) hands that won, high ones that didn't
hand_name = np.array(HAND_TYPES)[d["hand_id"][te_idx]]
up = d["dealer_up"][te_idx]
net = d["net"][te_idx]
p_best = preds["Logistic"]
def describe(i):
    return {"hand": str(hand_name[i]), "up": int(up[i]), "count": round(float(d["est_count"][te_idx][i]), 1),
            "p": round(float(p_best[i]), 3), "net": float(net[i])}
order = np.argsort(p_best)
def first_per_state(idx_iter, k=5):
    # keep only the most surprising round of each (hand, up-card), so the list isn't one state five times
    seen, out = set(), []
    for i in idx_iter:
        key = (hand_name[i], up[i])
        if key not in seen:
            seen.add(key); out.append(describe(i))
        if len(out) == k:
            break
    return out
surprises_won = first_per_state(i for i in order if yt[i] == 1)
surprises_lost = first_per_state(i for i in order[::-1] if yt[i] == 0)

# (b) where the models are actually wrong: states whose average prediction is far from reference
state_te = d["state_id"][te_idx]
ref_state_n = ref_n.reshape(340, N_COUNT_BINS).sum(1)
ref_state_p = ref_w.reshape(340, N_COUNT_BINS).sum(1) / np.maximum(ref_state_n, 1)
train_state_n = np.bincount(d["state_id"][tr_idx], minlength=340)
cell_errors = []
for s in np.unique(state_te):
    m = state_te == s
    row = {"hand": HAND_TYPES[s // 10], "up": int(s % 10 + 2), "train_n": int(train_state_n[s]),
           "ref": float(ref_state_p[s])}
    for name in ["Table", "Logistic", "Boosted trees"]:
        row[name] = float(preds[name][m].mean() - ref_state_p[s])
    cell_errors.append(row)
cell_errors.sort(key=lambda r: -max(abs(r["Table"]), abs(r["Logistic"]), abs(r["Boosted trees"])))

# ------------------------------------------------------------------ data description
tr_net = d["net"][tr_idx]
ev_by_count = []
cb = count_bin(d["est_count"][tr_idx])
labels = ["below -3.5"] + [f"{e:+.1f} to {e + 1:+.1f}" for e in COUNT_EDGES[:-1]] + ["+3.5 and up"]
for b in range(N_COUNT_BINS):
    m = cb == b
    nn = tr_net[m]
    ev_by_count.append({"bin": labels[b], "mid": float(-4 + b), "n": int(m.sum()),
                        "ev": float(nn.mean()), "ev_se": float(nn.std() / np.sqrt(m.sum())),
                        "win": float((nn > 0).mean()), "win_se": float(np.sqrt((nn > 0).mean() * (1 - (nn > 0).mean()) / m.sum()))})

hist_counts, hist_edges = np.histogram(np.clip(d["est_count"], -8, 8), bins=32, range=(-8, 8))
data_summary = {
    "rows": int(len(y)), "shoes": int(len(shoes)),
    "train_rows": int(len(tr_idx)), "test_rows": int(len(te_idx)),
    "train_shoes": int(len(shoes) - len(test_shoes)), "test_shoes": int(len(test_shoes)),
    "win": float((d["net"] > 0).mean()), "push": float((d["net"] == 0).mean()),
    "loss": float((d["net"] < 0).mean()),
    "ev": float(d["net"].mean()), "ev_se": float(d["net"].std() / np.sqrt(len(y))),
    "rounds_per_shoe": float(len(y) / len(shoes)),
    "est_true_corr": float(np.corrcoef(d["est_count"], d["true_count"])[0, 1]),
    "est_true_rmse": float(np.sqrt(np.mean((d["est_count"] - d["true_count"]) ** 2))),
    "count_hist": {"edges": hist_edges.tolist(), "counts": hist_counts.tolist()},
    "state_rows_min": int(train_state_n.min()), "state_rows_median": float(np.median(train_state_n)),
    "rarest_states": [{"hand": HAND_TYPES[s // 10], "up": int(s % 10 + 2), "n": int(train_state_n[s])}
                      for s in np.argsort(train_state_n)[:5]],
    "ref_rows": int(ref_n.sum()),
    "floor_brier": floor_brier, "floor_logloss": floor_logloss, "ceiling_accuracy": ceiling_accuracy,
}

# ------------------------------------------------------------------ grid for the website explorer
first = {h: np.argmax(d["hand_id"] == h) for h in range(34)}
xs = np.round(np.arange(-4, 4.001, 0.25), 2)
explorer = []
for h in range(34):
    i0 = first[h]
    for u in range(10):
        g = {
            "player_total": np.full(len(xs), d["player_total"][i0]),
            "is_soft": np.full(len(xs), d["is_soft"][i0]),
            "is_pair": np.full(len(xs), d["is_pair"][i0]),
            "card1": np.full(len(xs), d["card1"][i0]),
            "dealer_up": np.full(len(xs), u + 2),
            "hand_id": np.full(len(xs), h), "up_id": np.full(len(xs), u),
            "state_id": np.full(len(xs), h * 10 + u), "est_count": xs.astype(np.float32),
        }
        gi = np.arange(len(xs))
        s = h * 10 + u
        refs = []
        for b in range(N_COUNT_BINS):
            k = s * N_COUNT_BINS + b
            nn = ref_n[k]
            p = ref_w[k] / nn if nn else None
            se = np.sqrt(p * (1 - p) / nn) if nn else None
            refs.append(None if p is None else [round(float(p), 4), round(float(1.96 * se), 4), int(nn)])
        explorer.append({
            "h": h, "u": u, "train_n": int(train_state_n[s]),
            "pred": {n: [round(float(v), 4) for v in final[n].predict(g, gi)]
                     for n in ["Table", "Table+count", "Logistic", "Boosted trees"]},
            "ref": refs,
        })

out = {
    "data": data_summary, "cv": cv_table, "best_params": best_params,
    "best_model": min(test_rows, key=lambda r: r["logloss"])["model"],
    "ablation": ablation, "learning_curve": curve, "test": test_rows,
    "calibration": calib, "surprises_won": surprises_won, "surprises_lost": surprises_lost,
    "cell_errors": cell_errors[:12], "ev_by_count": ev_by_count,
    "hand_types": HAND_TYPES, "count_grid": xs.tolist(),
    "count_bin_edges": COUNT_EDGES.tolist(), "explorer": explorer,
}
json.dump({k: v for k, v in out.items() if k != "explorer"}, open("../results/results.json", "w"), indent=1)
with open("../docs/data.js", "w") as f:
    f.write("// generated by src/run.py, do not edit by hand\nwindow.BJ = ")
    json.dump(out, f, separators=(",", ":"))
    f.write(";\n")
log("wrote results/results.json and docs/data.js")
