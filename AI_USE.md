# AI use disclosure

The course allows AI tools as long as we say what we used them for. This file is meant to be accurate, so please read it that way.

**Tool:** Claude (Anthropic), used through claude.ai in November 2026. We are open about this: the AI did a large share of the implementation and writing, as listed below.

## What the AI did

- **Reviewed our proposal** and pointed out problems we then fixed:
  - the target depends on the player's policy, so we fixed basic strategy
  - pushes needed an explicit rule
  - hand total alone loses soft/pair information
  - rows from one shoe aren't independent, so we split by shoe instead of stratified k-fold
  - F1 doesn't fit a probability task
  - a simulated "true" probability can be used as a reference
- **Wrote most of the code:** the simulator, the basic-strategy table, the feature code, the five models, the metrics and bootstrap, the reference run, the main experiment script, the website (HTML/CSS/JS), and the playable blackjack table with its live forecasts.
- **Wrote `MATH.md`** and the website's mathematics section.
- **Ran the experiments** and drafted the analysis.
- **Drafted the text** of the website and the final report.

## What we did ourselves

Garv Singhal and Priyanshu Raj contributed equally to every part of the project. Together we:

- **Chose the topic and wrote the proposal.** We picked the question, the inputs (hand, dealer up-card, an imperfect deck-composition estimate), the binary win target, fixed casino rules and the website interaction, and submitted it in October.
- **Directed the work.** We set the brief: stay within the submitted proposal and keep everything consistent with the course rubric. We also decided which refinements of the problem statement to accept.
- **Reviewed the results and text, then published.** We read through the code, results and write-up, then deployed the site on GitHub Pages and made the submission.

## How the results can be checked

Nothing in the results is typed in by hand. Every number on the website comes from `docs/data.js`, which `src/run.py` writes. The checks built into the pipeline are:

- the simulated house edge against the published value for these rules
- the count effect against the usual rule of thumb (about 0.5% per count point)
- every model compared against a separate 20M-round reference simulation

Rerunning the three commands in the README reproduces every number.

## External material

- scikit-learn: `LogisticRegression`, `HistGradientBoostingClassifier`, `GroupKFold`, `roc_auc_score`
- Basic strategy for 6 decks, dealer stands on soft 17, double after split, no surrender: the standard published chart for these rules. Basic strategy goes back to E. O. Thorp, *Beat the Dealer* (1962).
- The Hi-Lo card counting system (tags +1 / 0 / −1), a standard public counting system.
- Fonts: Literata, Bodoni Moda and Barlow Semi Condensed from Google Fonts.
- KaTeX 0.16.11 (loaded from jsDelivr) renders the formulas on the website.
