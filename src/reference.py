"""
A separate, much bigger simulation used only as a yardstick.

The models never train on it. We use it for two things:
  1. a close estimate of the real P(win) in each (hand, up-card, count bin) cell,
     so we can ask "how far is each model from the truth?" and not just
     "how well does it predict noisy 0/1 outcomes?"
  2. the noise floor: the loss that even a perfect model would get, because the
     hole card and the next cards are random.

It is made in chunks with different seeds so memory stays small.

    python src/reference.py --chunks 4 --rounds-per-chunk 5000000
"""
import argparse
import time
import numpy as np

from simulate import simulate
from features import add_columns, count_bin, N_COUNT_BINS

N_STATES = 340


def build(chunks, per_chunk, base_seed):
    K = N_STATES * N_COUNT_BINS
    n = np.zeros(K); w = np.zeros(K)
    for c in range(chunks):
        t = time.time()
        d = add_columns(simulate(per_chunk, base_seed + c))
        key = d["state_id"].astype(np.int64) * N_COUNT_BINS + count_bin(d["est_count"])
        n += np.bincount(key, minlength=K)
        w += np.bincount(key, weights=d["win"], minlength=K)
        print(f"chunk {c + 1}/{chunks} done in {time.time() - t:.0f}s", flush=True)
    return n, w


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--chunks", type=int, default=4)
    ap.add_argument("--rounds-per-chunk", type=int, default=5_000_000)
    ap.add_argument("--seed", type=int, default=90001)     # far away from the main data seed
    ap.add_argument("--out", default="../data/reference_cells.npz")
    a = ap.parse_args()
    n, w = build(a.chunks, a.rounds_per_chunk, a.seed)
    np.savez_compressed(a.out, n=n, w=w)
    print("total rounds", int(n.sum()))
