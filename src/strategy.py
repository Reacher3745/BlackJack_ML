"""
Basic strategy for 6 decks, S17, double after split allowed, no surrender.

This is the fixed player policy. Every outcome in our dataset is
"what happens if the player plays this table", so the win probability we
predict is conditional on this policy (it is not the best possible play
once you know the count).

Dealer up-card is 2..11 (11 = ace). Actions: H hit, S stand, D double, P split.
"""

def _row(spec):
    # spec is a 10 char string for up-cards 2,3,4,5,6,7,8,9,10,A
    return {up: a for up, a in zip(range(2, 12), spec)}

#                    2345678910A
HARD = {}
for t in range(4, 9):
    HARD[t] = _row("HHHHHHHHHH")
HARD[9]  = _row("HDDDDHHHHH")
HARD[10] = _row("DDDDDDDDHH")
HARD[11] = _row("DDDDDDDDDH")   # S17 multi-deck: hit 11 vs ace
HARD[12] = _row("HHSSSHHHHH")
for t in range(13, 17):
    HARD[t] = _row("SSSSSHHHHH")
for t in range(17, 22):
    HARD[t] = _row("SSSSSSSSSS")

SOFT = {}
SOFT[12] = _row("HHHHHHHHHH")   # A,A when it can't be split (after a split)
SOFT[13] = _row("HHHDDHHHHH")   # A,2
SOFT[14] = _row("HHHDDHHHHH")   # A,3
SOFT[15] = _row("HHDDDHHHHH")   # A,4
SOFT[16] = _row("HHDDDHHHHH")   # A,5
SOFT[17] = _row("HDDDDHHHHH")   # A,6
SOFT[18] = _row("SDDDDSSHHH")   # A,7  (D here means "double, else stand")
SOFT[19] = _row("SSSSSSSSSS")
SOFT[20] = _row("SSSSSSSSSS")
SOFT[21] = _row("SSSSSSSSSS")

# pair card -> split (Y) or not (N). 5,5 and 10,10 are never split.
PAIRS = {}
PAIRS[2]  = _row("YYYYYYNNNN")
PAIRS[3]  = _row("YYYYYYNNNN")
PAIRS[4]  = _row("NNNYYNNNNN")
PAIRS[5]  = _row("NNNNNNNNNN")
PAIRS[6]  = _row("YYYYYNNNNN")
PAIRS[7]  = _row("YYYYYYNNNN")
PAIRS[8]  = _row("YYYYYYYYYY")
PAIRS[9]  = _row("YYYYYNYYNN")
PAIRS[10] = _row("NNNNNNNNNN")
PAIRS[11] = _row("YYYYYYYYYY")


def hand_value(cards):
    """Return (total, is_soft). An ace counts 11 unless that busts the hand."""
    total = sum(cards)
    aces = cards.count(11)
    while total > 21 and aces:
        total -= 10
        aces -= 1
    return total, aces > 0


def decide(cards, up, can_double, can_split):
    if can_split and len(cards) == 2 and cards[0] == cards[1]:
        if PAIRS[cards[0]][up] == "Y":
            return "P"
    total, soft = hand_value(cards)
    if total > 21:
        return "S"
    if soft:
        a = SOFT[total][up]
        if a == "D" and not can_double:
            # soft 18 doubles fall back to stand, the other soft doubles fall back to hit
            return "S" if total == 18 else "H"
        return a
    a = HARD[max(total, 4)][up]
    if a == "D" and not can_double:
        return "H"
    return a
