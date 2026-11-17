"""
Blackjack simulator that writes one row per round.

A row is one round from the player's side, recorded right after the first
four cards are dealt (player's two cards + dealer up-card visible) and before
the player does anything. The features in the row are only things the player
could know at that moment. The target is filled in after the round is played
out with basic strategy.

Usage:
    python src/simulate.py --rounds 1000000 --seed 335 --out data/hands.npz
"""
import argparse
import random
import time

import numpy as np

import rules as R
from strategy import decide, hand_value


class Shoe:
    def __init__(self, rng):
        self.rng = rng
        self.cards = []
        self.pos = 0
        self.rc = 0          # exact Hi-Lo running count of every card seen so far
        self.shoe_id = -1
        self.round_in_shoe = 0

    def shuffle(self):
        self.cards = R.one_deck() * R.N_DECKS
        self.rng.shuffle(self.cards)
        self.pos = 0
        self.rc = 0
        self.shoe_id += 1
        self.round_in_shoe = 0

    def remaining(self):
        return len(self.cards) - self.pos

    def draw(self):
        c = self.cards[self.pos]
        self.pos += 1
        self.rc += R.HILO[c]
        return c


def dealer_play(shoe, hand):
    while True:
        total, soft = hand_value(hand)
        if total < 17 or (total == 17 and soft and R.DEALER_HITS_SOFT_17):
            hand.append(shoe.draw())
        else:
            return total


def play_hand(shoe, cards, up, can_double, split_aces=False):
    """Play one player hand with basic strategy. Returns (final_cards, bet)."""
    bet = 1.0
    if split_aces:                      # split aces get exactly one card
        return cards, bet
    while True:
        a = decide(cards, up, can_double and len(cards) == 2, can_split=False)
        if a == "S":
            return cards, bet
        if a == "D":
            bet = 2.0
            cards.append(shoe.draw())
            return cards, bet
        cards.append(shoe.draw())       # hit
        if hand_value(cards)[0] >= 21:
            return cards, bet


def play_round(shoe):
    """Deal and play one round. Returns (p1, p2, up, net, n_cards_used)."""
    p1 = shoe.draw()
    up = shoe.draw()
    p2 = shoe.draw()
    hole = shoe.draw()

    player_bj = hand_value([p1, p2])[0] == 21
    dealer_bj = hand_value([up, hole])[0] == 21

    if dealer_bj:                       # dealer peeks / reveals; round over
        return p1, p2, up, (0.0 if player_bj else -1.0)
    if player_bj:
        return p1, p2, up, R.BLACKJACK_PAYS

    hands = []
    if decide([p1, p2], up, can_double=True, can_split=True) == "P":
        aces = p1 == 11
        for c in (p1, p2):
            h = [c, shoe.draw()]
            hands.append(play_hand(shoe, h, up, R.DOUBLE_AFTER_SPLIT, split_aces=aces))
    else:
        hands.append(play_hand(shoe, [p1, p2], up, can_double=True))

    live = [h for h in hands if hand_value(h[0])[0] <= 21]
    dealer_total = dealer_play(shoe, [up, hole]) if live else None

    net = 0.0
    for cards, bet in hands:
        pt = hand_value(cards)[0]
        if pt > 21:
            net -= bet
        elif dealer_total > 21 or pt > dealer_total:
            net += bet
        elif pt < dealer_total:
            net -= bet
    return p1, p2, up, net


def simulate(n_rounds, seed):
    rng = random.Random(seed)
    shoe = Shoe(rng)
    shoe.shuffle()

    cols = {k: np.empty(n_rounds, dtype=dt) for k, dt in [
        ("shoe_id", np.int32), ("round_in_shoe", np.int16),
        ("card1", np.int8), ("card2", np.int8), ("dealer_up", np.int8),
        ("player_total", np.int8), ("is_soft", np.int8), ("is_pair", np.int8),
        ("decks_left", np.float32), ("true_count", np.float32), ("est_count", np.float32),
        ("net", np.float32)]}

    for i in range(n_rounds):
        if shoe.remaining() < R.RESHUFFLE_AT:
            shoe.shuffle()

        # ---- prediction-time count, taken BEFORE this round's cards come out ----
        decks_left = shoe.remaining() / 52.0
        true_tc = shoe.rc / decks_left
        # the player's version: miscounts a little and only eyeballs the discard tray
        rc_seen = shoe.rc + rng.gauss(0.0, R.RC_NOISE_SD)
        decks_guess = max(R.DECK_EST_STEP, round(decks_left / R.DECK_EST_STEP) * R.DECK_EST_STEP)
        est_tc = rc_seen / decks_guess

        sid, rnd = shoe.shoe_id, shoe.round_in_shoe
        p1, p2, up, net = play_round(shoe)
        total, soft = hand_value([p1, p2])

        cols["shoe_id"][i] = sid
        cols["round_in_shoe"][i] = rnd
        cols["card1"][i], cols["card2"][i] = min(p1, p2), max(p1, p2)
        cols["dealer_up"][i] = up
        cols["player_total"][i] = total
        cols["is_soft"][i] = soft
        cols["is_pair"][i] = p1 == p2
        cols["decks_left"][i] = decks_left
        cols["true_count"][i] = true_tc
        cols["est_count"][i] = est_tc
        cols["net"][i] = net
        shoe.round_in_shoe += 1
    return cols


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", type=int, default=1_000_000)
    ap.add_argument("--seed", type=int, default=335)
    ap.add_argument("--out", default="data/hands.npz")
    args = ap.parse_args()
    t = time.time()
    cols = simulate(args.rounds, args.seed)
    np.savez_compressed(args.out, **cols)
    print(f"{args.rounds} rounds, {cols['shoe_id'][-1] + 1} shoes, "
          f"{time.time() - t:.1f}s -> {args.out}")
