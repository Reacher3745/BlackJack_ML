"""
Fixed table rules for every simulated hand.

We picked a common "6-deck, dealer stands on soft 17" game so the basic
strategy table is well known and easy to check against published charts.
Cards are stored by blackjack value: 2..9, 10 (any ten or face card), 11 (ace).
"""

N_DECKS = 6
SHOE_SIZE = 52 * N_DECKS
RESHUFFLE_AT = int(0.25 * SHOE_SIZE)   # cut card at 75% penetration -> 78 cards left
DEALER_HITS_SOFT_17 = False           # S17
BLACKJACK_PAYS = 1.5                  # 3:2
DOUBLE_AFTER_SPLIT = True             # DAS
MAX_SPLITS = 1                        # one split only, no resplitting
DEALER_PEEKS = True                   # US style: dealer checks for blackjack under A/10

# Hi-Lo tag for each card value
HILO = {2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 0, 8: 0, 9: 0, 10: -1, 11: -1}

# How the player's count is made "imperfect" (see simulate.py for the details)
RC_NOISE_SD = 2.0        # sd of miscounting, in running-count units
DECK_EST_STEP = 0.5      # player eyeballs decks left to the nearest half deck


def one_deck():
    deck = []
    for v in range(2, 10):
        deck += [v] * 4
    deck += [10] * 16
    deck += [11] * 4
    return deck
