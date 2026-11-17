"""
Turning raw simulator columns into model inputs.

Nothing in here is learned from data, so it is safe to apply to the whole
dataset before splitting. Anything that IS learned (bin rates, scaling,
model weights) lives in models.py and is only ever fit on training shoes.
"""
import numpy as np

UPCARDS = list(range(2, 12))                       # 11 = ace
PAIR_NAME = {2: "2s", 3: "3s", 4: "4s", 5: "5s", 6: "6s", 7: "7s",
             8: "8s", 9: "9s", 10: "10s", 11: "aces"}

# every two-card starting hand the player can have, grouped the way you'd say it at a table
HAND_TYPES = ([f"hard {t}" for t in range(5, 20)] +
              [f"soft {t}" for t in range(13, 21)] + ["blackjack"] +
              [f"pair of {PAIR_NAME[c]}" for c in range(2, 12)])
HAND_INDEX = {h: i for i, h in enumerate(HAND_TYPES)}


def hand_type(total, soft, pair, card1):
    if pair:
        return f"pair of {PAIR_NAME[card1]}"
    if soft and total == 21:
        return "blackjack"
    return f"{'soft' if soft else 'hard'} {total}"


def add_columns(d):
    """d: dict of numpy arrays from simulate.py. Adds hand id, state id, target."""
    ht = np.array([HAND_INDEX[hand_type(t, s, p, c)] for t, s, p, c in
                   zip(d["player_total"], d["is_soft"], d["is_pair"], d["card1"])], dtype=np.int16)
    d["hand_id"] = ht
    d["up_id"] = (d["dealer_up"] - 2).astype(np.int16)
    d["state_id"] = (ht * 10 + d["up_id"]).astype(np.int16)    # 34 hands x 10 up-cards = 340 states
    d["win"] = (d["net"] > 0).astype(np.int8)                   # a push is NOT a win
    return d


COUNT_EDGES = np.arange(-3.5, 4.0, 1.0)     # bins: <-3.5, [-3.5,-2.5), ..., >=3.5  -> 9 bins
N_COUNT_BINS = len(COUNT_EDGES) + 1


def count_bin(x):
    return np.digitize(x, COUNT_EDGES)
