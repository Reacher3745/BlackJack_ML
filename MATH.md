# The mathematics behind the project

This file states every quantity used in the code and on the website. Each formula comes with one sentence on why it is there. All logarithms are natural.

## The count

Each card gets a Hi-Lo tag $t(c) = +1$ for 2 to 6, $0$ for 7 to 9, and $-1$ for tens and aces. The running count sums the tags of every card seen since the shuffle. A shoe of $D$ decks holds $20D$ low cards and $20D$ high cards, so the running count measures the surplus of high cards still to come:

$$
RC = \sum_{\text{seen}} t(c) = H_{\text{left}} - L_{\text{left}}, \qquad TC = \frac{RC}{D_{\text{left}}}.
$$

The player's estimate adds a miscount and a rough reading of the discard tray:

$$
\widehat{TC} = \frac{RC + \varepsilon}{\widehat D}, \qquad \varepsilon \sim \mathcal N(0, 2^2), \qquad \widehat D = \max\!\left(0.5,\ \tfrac12\operatorname{round}(2D_{\text{left}})\right).
$$

## What is being estimated

With inputs $X$ and target $Y = \mathbb 1[\text{net} > 0]$, the object of interest is the conditional win probability under the fixed rules, basic strategy and the noise model:

$$
p^*(x) = P(Y = 1 \mid X = x).
$$

## Log-loss, and the part no model can remove

$$
\ell(y, \hat p) = -\left[y \log \hat p + (1 - y) \log(1 - \hat p)\right]
$$

Averaged over the data, it splits exactly into the randomness of the cards plus the model's own error:

$$
\mathbb E\big[\ell(Y, \hat p(X))\big] = \underbrace{\mathbb E\big[H(p^*(X))\big]}_{\text{noise floor}} + \underbrace{\mathbb E\big[\operatorname{KL}\big(p^*(X)\,\|\,\hat p(X)\big)\big]}_{\text{model error}\ \ge\ 0}
$$

Here $H(p) = -p\log p - (1-p)\log(1-p)$. The KL term is zero only when $\hat p = p^*$, so the noise floor is the best loss any model can reach.

## Brier score and distance to the truth

$$
B = \mathbb E\big[(\hat p - Y)^2\big] = \mathbb E\big[p^*(1 - p^*)\big] + \mathbb E\big[(\hat p - p^*)^2\big]
$$

To see this, add and subtract $p^*$ inside the square. The cross term vanishes because $\mathbb E[Y - p^* \mid X] = 0$.

The second term is what we report as RMSE to the reference. The reference rate $p_{\text{ref}}$ of a cell comes from $n$ rounds and has its own sampling variance, so that variance is subtracted:

$$
\widehat{\text{MSE}} = \frac1N\sum_i \left[(\hat p_i - p_{\text{ref},i})^2 - \frac{p_{\text{ref},i}(1 - p_{\text{ref},i})}{n_i}\right], \qquad \text{RMSE} = \sqrt{\widehat{\text{MSE}}}.
$$

## Calibration error

Sort the predictions, cut them into $B = 20$ equal-count bins, and compare the average prediction $\bar p_b$ with the observed win rate $\bar y_b$:

$$
\text{ECE} = \sum_{b=1}^{B} \frac{n_b}{N}\,\left|\bar y_b - \bar p_b\right|.
$$

Even a perfect model scores above zero, because each $\bar y_b$ is noisy. With 10,000 rounds per bin and $p \approx 0.43$, the expected absolute gap is $\sqrt{2/\pi}\cdot\sqrt{p(1-p)/n_b} \approx 0.004$. That is exactly the level every model reaches.

## The models

**Shrunken table.** A cell with $w$ wins in $n$ rounds is pulled toward a parent rate $p_0$:

$$
\hat p = \frac{w + m\,p_0}{n + m} = \frac{n}{n + m}\cdot\frac{w}{n} + \frac{m}{n + m}\cdot p_0.
$$

This is the posterior mean under a $\operatorname{Beta}(m p_0,\ m(1 - p_0))$ prior: $m$ acts as a number of imaginary rounds at the parent rate.

**Logistic regression.** Each state $s$ gets its own intercept, and the count slope depends on the up-card $u$ and the hand $h$:

$$
\log\frac{\hat p}{1 - \hat p} = a_s + (b_u + c_h)\,\widehat{TC}, \qquad \min_\theta\ \sum_i \ell(y_i, \hat p_i) + \frac{1}{2C}\lVert\theta\rVert^2.
$$

**Boosted trees.** The log-odds are a sum of small trees, $F(x) = \sum_{m} \eta f_m(x)$ with $\hat p = \sigma(F)$. Each new tree is fitted using the gradient $\hat p - y$ and curvature $\hat p(1 - \hat p)$ of the log-loss at the current fit.

## Error bars

For each shoe $g$, let $S_g$ be the sum of a per-round quantity (a loss, or a loss difference) and $n_g$ its number of rounds. A bootstrap replicate resamples the $G$ test shoes with replacement and computes $\sum_g S_g / \sum_g n_g$. The 2.5th and 97.5th percentiles of 2,000 replicates give the 95% interval. Resampling whole shoes keeps the rounds that share a deck together. For model comparisons the same resampled shoes are used for both models (a paired bootstrap).

## The game's live numbers

The live simulation draws $n$ random finishes from the cards actually left, so its estimate $\hat p = k/n$ has standard error

$$
\operatorname{SE} = \sqrt{\frac{\hat p(1 - \hat p)}{n}} \le \frac{0.5}{\sqrt n}.
$$

That is at most 0.8 points for the 4,000 finishes behind the bar, and 1.0 point for the 2,500 behind each move button.

The "average result" under a move is the mean of `net` over those finishes. Basic strategy maximises this expected result, not the win probability. The two can disagree: hitting a stiff hand can raise the average result while lowering the chance of winning, and doubling stakes twice the money on a single card.

The guessing game scores you and the model with the same Brier score, $\frac1n\sum (q_i - y_i)^2$, where $q_i$ is the probability given before the hand was played.
