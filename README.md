# Empirical Analysis of Blackjack via Machine Learning

ES 335 course project by Garv Singhal (24110119) and Priyanshu Raj (24110279), IIT Gandhinagar.

**Live site:** `https://<github-username>.github.io/<repo-name>/` (update after deploying)

## Question

Under fixed casino rules and a fixed basic-strategy player, how accurately can a calibrated model estimate the chance that the player wins a round? The model may use only what is visible right after the deal:

- the player's two-card hand: total, soft or hard, pair or not
- the dealer's up-card
- the player's imperfect estimate of the remaining high-minus-low card balance (a noisy Hi-Lo true count, taken before the deal)

We also ask how much of that accuracy comes from the deck estimate rather than from the cards on the table.

**Short answer.**

- A lookup table of hand against up-card captures 99.4% of the achievable improvement in log-loss.
- The count adds a small but real gain, and the logistic model uses it best: about 20% closer to the true probabilities than the table.
- Counting imperfectly costs almost nothing.
- The count moves the money result about 4× more than the win rate.

## Layout

```
src/
  rules.py       table rules + Hi-Lo tags + count-noise settings
  strategy.py    basic strategy (the fixed player policy)
  simulate.py    the simulator, one row per round  -> data/hands.npz
  reference.py   separate 20M-round run, only used as a yardstick -> data/reference_cells.npz
  features.py    hand types, states, count bins, target (nothing learned here)
  models.py      Constant, Table, Table+count, Logistic, Boosted trees
  metrics.py     log-loss, Brier, ECE, AUC, reliability, shoe bootstrap
  run.py         the full experiment -> results/results.json and docs/data.js
data/
  hands.npz              main dataset, 1,000,000 rounds (seed 335)
  reference_cells.npz    win counts per (state, count bin) from the 20M reference run
  sample_hands.csv       first 50,000 rows as CSV, for a quick look
results/
  results.json   every number shown on the site
  test_shoes.txt the shoe ids in the test set
  run.log        log of the last full run
docs/            the website (GitHub Pages serves this folder)
  index.html     page text and layout
  app.js         charts, strategy card, hand explorer
  game.js        the playable table: same rules as src/ (1 to 8 decks), live model forecast,
                 live Monte Carlo, forecast check, and a guess-the-odds duel against the model
  data.js        every number the page shows, written by src/run.py
```

## Data access

There is no external data. Everything is simulated by `src/simulate.py` from a fixed seed, so there are no licence or privacy issues. The committed `data/` files are exactly what the commands below produce.

## Rebuild everything

You need Python 3.10+ (tested with numpy 2.5, scipy 1.18, pandas 3.0, scikit-learn 1.9). The full run takes about 10 minutes on one CPU core.

```bash
pip install -r requirements.txt
cd src
python simulate.py --rounds 1000000 --seed 335 --out ../data/hands.npz   # ~10 s
python reference.py                                                      # ~2.5 min
python run.py                                                            # ~6 min
```

`run.py` overwrites `results/` and `docs/data.js`. To view the site locally, open `docs/index.html` in a browser. It needs no server, because the data is loaded with a `<script>` tag.

## Split and evaluation, in one paragraph

- **Split:** a random 20% of shoes (4,613 shoes, 200,054 rounds) are the test set. The ids are in `results/test_shoes.txt`. Rounds from one shoe never appear on both sides.
- **Tuning:** settings are picked by 5-fold `GroupKFold` grouped by shoe, on training shoes only, by log-loss. The chosen settings are refit on all training shoes and scored on the test set once.
- **Error bars:** 2,000 shoe-level bootstrap resamples.
- **Truth check:** models are also compared against the 20M-round reference.

## Deploying the site

Push the repo to GitHub, then go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/docs`. Put the resulting URL at the top of this README.

## Contributions and AI use

Garv Singhal and Priyanshu Raj contributed equally. We used Claude (Anthropic) extensively for code, analysis and writing; see [AI_USE.md](AI_USE.md) for exactly what.
