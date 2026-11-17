"""
The five models we compare. All of them output P(win) for a row.

  Constant        - always predicts the training win rate. The floor.
  Table           - win rate of (hand, dealer up-card) in training data. Ignores the count.
                    With this many rows this is already very hard to beat on the
                    discrete part of the state.
  Table+count     - same table, split further into count bins, each bin pulled
                    toward its parent cell (shrinkage strength m is tuned).
  Logistic        - logit p = a[state] + (b[up-card] + c[hand]) * count.
                    So every state gets its own base rate, and the count gets a
                    straight-line effect on the log-odds that depends on the up-card and hand.
  Boosted trees   - sklearn HistGradientBoosting on the 5 raw features. Free to find
                    any shape, including bends in the count effect.
"""
import numpy as np
from scipy import sparse
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier

from features import count_bin, N_COUNT_BINS

N_STATES = 340
EPS = 1e-6


class Constant:
    name = "Constant"
    def fit(self, d, idx):
        self.p = d["win"][idx].mean(); return self
    def predict(self, d, idx):
        return np.full(len(idx), self.p)


class Table:
    """Smoothed win rate per state. m pseudo-hands of the overall rate keep empty cells sane."""
    name = "Table"
    def __init__(self, m=10):
        self.m = m
    def fit(self, d, idx):
        s, y = d["state_id"][idx], d["win"][idx]
        n = np.bincount(s, minlength=N_STATES)
        w = np.bincount(s, weights=y, minlength=N_STATES)
        p0 = y.mean()
        self.rate = (w + self.m * p0) / (n + self.m)
        self.n = n
        return self
    def predict(self, d, idx):
        return self.rate[d["state_id"][idx]]


class TableCount:
    """Win rate per (state, count bin), shrunk toward the state's own rate with strength m."""
    name = "Table+count"
    def __init__(self, m=200):
        self.m = m
    def fit(self, d, idx):
        self.base = Table().fit(d, idx)
        key = self._key(d, idx)
        y = d["win"][idx]
        K = N_STATES * N_COUNT_BINS
        n = np.bincount(key, minlength=K)
        w = np.bincount(key, weights=y, minlength=K)
        prior = np.repeat(self.base.rate, N_COUNT_BINS)
        self.rate = (w + self.m * prior) / (n + self.m)
        self.n = n
        return self
    def _key(self, d, idx):
        return d["state_id"][idx].astype(np.int64) * N_COUNT_BINS + count_bin(d["est_count"][idx])
    def predict(self, d, idx):
        return self.rate[self._key(d, idx)]


class Logistic:
    name = "Logistic"
    def __init__(self, C=1.0):
        self.C = C
    def design(self, d, idx):
        n = len(idx)
        rows = np.arange(n)
        x = d["est_count"][idx].astype(np.float64)
        state = sparse.csr_matrix((np.ones(n), (rows, d["state_id"][idx])), shape=(n, N_STATES))
        up = sparse.csr_matrix((x, (rows, d["up_id"][idx])), shape=(n, 10))
        hand = sparse.csr_matrix((x, (rows, d["hand_id"][idx])), shape=(n, 34))
        return sparse.hstack([state, up, hand]).tocsr()
    def fit(self, d, idx):
        # no intercept: the 340 state indicators already play that role
        self.clf = LogisticRegression(C=self.C, fit_intercept=False, max_iter=2000)
        self.clf.fit(self.design(d, idx), d["win"][idx])
        return self
    def predict(self, d, idx):
        return self.clf.predict_proba(self.design(d, idx))[:, 1]


FEATS = ["player_total", "is_soft", "is_pair", "dealer_up", "est_count"]

class Boosted:
    name = "Boosted trees"
    def __init__(self, max_leaf_nodes=31, learning_rate=0.05, max_iter=300, min_samples_leaf=200):
        self.kw = dict(max_leaf_nodes=max_leaf_nodes, learning_rate=learning_rate,
                       max_iter=max_iter, min_samples_leaf=min_samples_leaf,
                       l2_regularization=1.0, early_stopping=False, random_state=0)
    def X(self, d, idx, feats=None):
        return np.column_stack([d[f][idx] for f in (feats or FEATS)]).astype(np.float32)
    def fit(self, d, idx, feats=None):
        self.feats = feats or FEATS
        self.clf = HistGradientBoostingClassifier(**self.kw)
        self.clf.fit(self.X(d, idx, self.feats), d["win"][idx])
        return self
    def predict(self, d, idx):
        return self.clf.predict_proba(self.X(d, idx, self.feats))[:, 1]


def clip(p):
    return np.clip(p, EPS, 1 - EPS)
