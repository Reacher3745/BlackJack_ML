"""Metrics for probability predictions, plus a bootstrap over shoes for error bars."""
import numpy as np
from sklearn.metrics import roc_auc_score

from models import clip


def row_logloss(y, p):
    p = clip(p)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def row_brier(y, p):
    return (p - y) ** 2


def ece(y, p, n_bins=20):
    """Expected calibration error with equal-count bins (each bin ~same number of rows)."""
    order = np.argsort(p, kind="stable")
    bins = np.array_split(order, n_bins)
    gaps = [abs(p[b].mean() - y[b].mean()) * len(b) for b in bins]
    return sum(gaps) / len(p)


def reliability(y, p, n_bins=15):
    order = np.argsort(p, kind="stable")
    out = []
    for b in np.array_split(order, n_bins):
        m, o = p[b].mean(), y[b].mean()
        se = np.sqrt(max(o * (1 - o), 1e-9) / len(b))
        out.append({"pred": float(m), "obs": float(o), "lo": float(o - 1.96 * se),
                    "hi": float(o + 1.96 * se), "n": int(len(b))})
    return out


def summary(y, p):
    return {"logloss": float(row_logloss(y, p).mean()),
            "brier": float(row_brier(y, p).mean()),
            "auc": float(roc_auc_score(y, p)),
            "ece": float(ece(y, p)),
            # reported only to show why it is the wrong metric here (see website, Results)
            "accuracy": float(((p >= 0.5) == y).mean())}


def shoe_bootstrap(per_row, groups, n_boot=2000, seed=0):
    """
    Mean of a per-row quantity, resampled by whole shoes.
    Rows in the same shoe share a deck, so we resample shoes, not rows.
    Returns (mean, lo95, hi95).
    """
    rng = np.random.default_rng(seed)
    g, inv = np.unique(groups, return_inverse=True)
    sums = np.bincount(inv, weights=per_row)
    cnts = np.bincount(inv)
    G = len(g)
    stats = np.empty(n_boot)
    for b in range(n_boot):
        pick = rng.integers(0, G, G)
        stats[b] = sums[pick].sum() / cnts[pick].sum()
    return float(per_row.mean()), float(np.percentile(stats, 2.5)), float(np.percentile(stats, 97.5))
