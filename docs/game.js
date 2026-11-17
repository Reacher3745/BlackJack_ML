// The table at the top of the page.
// Same rules as the simulator in src/: 6 decks, cut at 78 cards, dealer stands on soft 17,
// blackjack pays 3:2, double after split, one split, split aces get one card, dealer peeks.
// When a hand is dealt we look up every model's forecast from window.BJ (written by src/run.py),
// and a small Monte Carlo replays the rest of the hand thousands of times from the cards
// actually left in this shoe, so the two can be compared live.
(function () {
  const BJ = window.BJ;
  const $ = (id) => document.getElementById(id);
  const SUITS = ["♠", "♥", "♦", "♣"];
  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const MODELS = ["Table", "Table+count", "Logistic", "Boosted trees"];
  const val = (r) => (r === "A" ? 11 : ["10", "J", "Q", "K"].includes(r) ? 10 : +r);
  const hilo = (v) => (v <= 6 ? 1 : v >= 10 ? -1 : 0);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- basic strategy, same table as src/strategy.py ----------
  const row = (s) => { const o = {}; for (let i = 0; i < 10; i++) o[i + 2] = s[i]; return o; };
  const HARD = {}, SOFT = {}, PAIRS = {};
  for (let t = 4; t <= 8; t++) HARD[t] = row("HHHHHHHHHH");
  HARD[9] = row("HDDDDHHHHH"); HARD[10] = row("DDDDDDDDHH"); HARD[11] = row("DDDDDDDDDH");
  HARD[12] = row("HHSSSHHHHH");
  for (let t = 13; t <= 16; t++) HARD[t] = row("SSSSSHHHHH");
  for (let t = 17; t <= 21; t++) HARD[t] = row("SSSSSSSSSS");
  SOFT[12] = row("HHHHHHHHHH"); SOFT[13] = row("HHHDDHHHHH"); SOFT[14] = row("HHHDDHHHHH");
  SOFT[15] = row("HHDDDHHHHH"); SOFT[16] = row("HHDDDHHHHH"); SOFT[17] = row("HDDDDHHHHH");
  SOFT[18] = row("SDDDDSSHHH"); SOFT[19] = row("SSSSSSSSSS"); SOFT[20] = row("SSSSSSSSSS"); SOFT[21] = row("SSSSSSSSSS");
  PAIRS[2] = row("YYYYYYNNNN"); PAIRS[3] = row("YYYYYYNNNN"); PAIRS[4] = row("NNNYYNNNNN");
  PAIRS[5] = row("NNNNNNNNNN"); PAIRS[6] = row("YYYYYNNNNN"); PAIRS[7] = row("YYYYYYNNNN");
  PAIRS[8] = row("YYYYYYYYYY"); PAIRS[9] = row("YYYYYNYYNN"); PAIRS[10] = row("NNNNNNNNNN"); PAIRS[11] = row("YYYYYYYYYY");

  function hv(vals) {
    let t = 0, a = 0;
    for (const v of vals) { t += v; if (v === 11) a++; }
    while (t > 21 && a) { t -= 10; a--; }
    return { t, soft: a > 0 };
  }
  function decide(vals, up, canDouble, canSplit) {
    if (canSplit && vals.length === 2 && vals[0] === vals[1] && PAIRS[vals[0]][up] === "Y") return "P";
    const { t, soft } = hv(vals);
    if (t > 21) return "S";
    if (soft) {
      const a = SOFT[t][up];
      if (a === "D" && !canDouble) return t === 18 ? "S" : "H";
      return a;
    }
    const a = HARD[Math.max(t, 4)][up];
    return a === "D" && !canDouble ? "H" : a;
  }
  const PAIR_NAME = { 2: "2s", 3: "3s", 4: "4s", 5: "5s", 6: "6s", 7: "7s", 8: "8s", 9: "9s", 10: "10s", 11: "aces" };
  function handType(vals) {
    if (vals[0] === vals[1]) return "pair of " + PAIR_NAME[vals[0]];
    const { t, soft } = hv(vals);
    if (soft && t === 21) return "blackjack";
    return (soft ? "soft " : "hard ") + t;
  }

  // ---------- model lookups from the exported grid ----------
  function forecast(vals, up, tc) {
    const h = BJ.hand_types.indexOf(handType(vals));
    const c = BJ.explorer[h * 10 + (up - 2)];
    const x = Math.max(-4, Math.min(4, tc));
    const i = Math.round((x + 4) * 4);
    const out = {};
    MODELS.forEach((m) => (out[m] = c.pred[m][i]));
    let b = 0; BJ.count_bin_edges.forEach((e) => { if (tc >= e) b++; });
    out.ref = c.ref[b];
    out.clamped = Math.abs(tc) > 4;
    out.type = handType(vals);
    return out;
  }

  // ---------- game state ----------
  const G = {
    shoe: [], pos: 0, rc: 0, bank: 1000, bet: 25, R: null, busy: false, fast: false,
    model: "Logistic", seen: new Set(), nextId: 0, decks: 6, cut: 78, guessMode: false,
    duel: { n: 0, you: 0, model: 0 },
    stats: { n: 0, wins: 0, pushes: 0, net: 0, log: [] },
  };

  function newShoe() {
    const cards = [];
    G.cut = Math.round(0.25 * 52 * G.decks);   // same 75% penetration as the simulator, for any shoe size
    for (let d = 0; d < G.decks; d++) for (const s of SUITS) for (const r of RANKS) cards.push({ r, s, v: val(r) });
    for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
    G.shoe = cards; G.pos = 0; G.rc = 0;
  }
  function draw(faceUp = true) {
    const c = { ...G.shoe[G.pos++], id: G.nextId++, up: faceUp };
    if (faceUp) G.rc += hilo(c.v);
    return c;
  }
  const left = () => G.shoe.length - G.pos;
  const vals = (h) => h.c.map((x) => x.v);
  const pause = (ms) => (G.fast || reduceMotion ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

  // ---------- live Monte Carlo from the real shoe ----------
  function liveOdds(R, n = 4000) {
    const cnt = new Array(12).fill(0);
    for (let i = G.pos; i < G.shoe.length; i++) cnt[G.shoe[i].v]++;
    const holeUnknown = R.holeHidden;
    if (holeUnknown) cnt[R.dealer[1].v]++;
    const up = R.dealer[0].v;
    let w = 0, p = 0;
    for (let k = 0; k < n; k++) {
      const c = cnt.slice(); let tot = 0; for (let v = 2; v <= 11; v++) tot += c[v];
      const dr = () => { let r = Math.random() * tot; for (let v = 2; v <= 11; v++) { r -= c[v]; if (r < 0) { c[v]--; tot--; return v; } } c[11]--; tot--; return 11; };
      let hole = holeUnknown ? null : R.dealer[1].v;
      if (holeUnknown) {
        if (R.peeked && up >= 10) {          // dealer already checked: hole can't complete a blackjack
          for (let tries = 0; tries < 50; tries++) {
            const h = dr();
            if (hv([up, h]).t === 21) { c[h]++; tot++; continue; }
            hole = h; break;
          }
          if (hole === null) hole = 2;
        } else hole = dr();
      }
      let net;
      const pv = vals(R.hands[0]);
      if (!R.peeked) {
        const pbj = R.hands.length === 1 && pv.length === 2 && hv(pv).t === 21;
        const dbj = hv([up, hole]).t === 21;
        if (dbj) net = pbj ? 0 : -1; else if (pbj) net = 1.5;
      }
      if (net === undefined) net = playOut(R, up, hole, dr);
      if (net > 0) w++; else if (net === 0) p++;
    }
    return { w: w / n, p: p / n, l: 1 - (w + p) / n, n };
  }
  function playOut(R, up, hole, dr) {
    let hands = R.hands.map((h) => ({ c: vals(h), m: h.m, done: h.done }));
    let active = R.active;
    if (hands.length === 1 && !R.split && !R.acted && decide(hands[0].c, up, true, true) === "P") {
      const [a, b] = hands[0].c, sa = a === 11;
      hands = [{ c: [a, dr()], m: 1, done: sa }, { c: [b, dr()], m: 1, done: sa }];
      active = 0;
    }
    for (let i = active; i < hands.length; i++) {
      const h = hands[i];
      if (h.done) continue;
      for (;;) {
        if (hv(h.c).t >= 21) break;
        const a = decide(h.c, up, h.c.length === 2, false);
        if (a === "S") break;
        if (a === "D") { h.m = 2; h.c.push(dr()); break; }
        h.c.push(dr());
      }
    }
    const d = [up, hole];
    if (hands.some((h) => hv(h.c).t <= 21)) while (hv(d).t < 17) d.push(dr());
    const dt = hv(d).t;
    let net = 0;
    for (const h of hands) {
      const t = hv(h.c).t;
      if (t > 21) net -= h.m; else if (dt > 21 || t > dt) net += h.m; else if (t < dt) net -= h.m;
    }
    return net;
  }

  // ---------- round flow ----------
  async function deal() {
    if (G.busy || (G.R && !G.R.over)) return;
    if (G.bank < G.bet) { say("Not enough chips for that bet. Pick a smaller chip or take a new stack."); return; }
    G.busy = true;
    if (left() < G.cut) { newShoe(); toast("Cut card reached. A new shoe is shuffled and the count restarts at zero."); }
    const decks = left() / 52, tc = G.rc / decks;
    G.R = { hands: [{ c: [], m: 1, done: false, sa: false }], dealer: [], holeHidden: true, active: 0, split: false,
            peeked: false, acted: false, deviated: false, over: false, pre: { rc: G.rc, decks, tc }, msg: "Dealing.",
            shoeDecks: G.decks, guess: null, locked: false };
    const R = G.R;
    render();
    R.hands[0].c.push(draw()); render(); await pause(240);
    R.dealer.push(draw()); render(); await pause(240);
    R.hands[0].c.push(draw()); render(); await pause(240);
    R.dealer.push(draw(false)); render(); await pause(240);

    const pv = vals(R.hands[0]), up = R.dealer[0].v;
    R.fc = forecast(pv, up, tc);
    if (!G.fast) R.live = liveOdds(R);
    R.msg = "The model has priced this hand.";
    render();

    const pbj = hv(pv).t === 21, dbj = hv([up, R.dealer[1].v]).t === 21;
    if (up >= 10) { R.msg = "The dealer checks for blackjack."; render(); await pause(800); }
    R.peeked = true;
    if (dbj) { await reveal(); return finish(pbj ? 0 : -1, pbj ? "Both have blackjack. Push." : "Dealer blackjack."); }
    if (pbj) { await reveal(); return finish(1.5, "Blackjack. Paid 3 to 2."); }
    R.msg = "Your move.";
    if (!G.fast) R.live = liveOdds(R);
    G.busy = false;
    render();
  }

  function allowed() {
    const R = G.R;
    if (!R || R.over || G.busy || R.active >= R.hands.length) return {};
    const h = R.hands[R.active], v = vals(h);
    return {
      H: true, S: true,
      D: v.length === 2 && G.bank >= G.bet * (R.hands.reduce((s, x) => s + x.m, 0) + 1),
      P: !R.split && R.hands.length === 1 && v.length === 2 && v[0] === v[1] && G.bank >= G.bet * 2,
    };
  }
  function suggestion() {
    const R = G.R, h = R.hands[R.active], v = vals(h);
    return decide(v, R.dealer[0].v, v.length === 2, !R.split && R.hands.length === 1 && v.length === 2);
  }

  async function act(a) {
    const R = G.R;
    if (!allowed()[a]) return;
    if (a !== suggestion()) R.deviated = true;
    R.acted = true;
    G.busy = true;
    const h = R.hands[R.active];
    if (a === "H") { h.c.push(draw()); if (hv(vals(h)).t >= 21) h.done = true; }
    if (a === "S") h.done = true;
    if (a === "D") { h.m = 2; h.c.push(draw()); h.done = true; }
    if (a === "P") {
      R.split = true;
      const [c1, c2] = h.c, sa = c1.v === 11;
      R.hands = [{ c: [c1], m: 1, done: sa, sa }, { c: [c2], m: 1, done: sa, sa }];
      render(); await pause(200);
      R.hands[0].c.push(draw()); render(); await pause(220);
      R.hands[1].c.push(draw());
      R.active = 0;
    }
    render(); await pause(180);
    while (R.active < R.hands.length && R.hands[R.active].done) R.active++;
    if (R.active >= R.hands.length) return dealerTurn();
    R.msg = R.hands.length > 1 ? `Playing hand ${R.active + 1} of 2.` : "Your move.";
    if (!G.fast) R.live = liveOdds(R);
    G.busy = false;
    render();
  }

  async function reveal() {
    const R = G.R;
    R.holeHidden = false; R.dealer[1].up = true; G.rc += hilo(R.dealer[1].v);
    render(); await pause(450);
  }
  async function dealerTurn() {
    const R = G.R;
    R.msg = "Dealer's turn.";
    await reveal();
    const live = R.hands.some((h) => hv(vals(h)).t <= 21);
    if (live) while (hv(R.dealer.map((c) => c.v)).t < 17) { R.dealer.push(draw()); render(); await pause(420); }
    const dt = hv(R.dealer.map((c) => c.v)).t;
    let net = 0;
    const words = R.hands.map((h, i) => {
      const t = hv(vals(h)).t, tag = R.hands.length > 1 ? `Hand ${i + 1}: ` : "";
      if (t > 21) { net -= h.m; return tag + "bust"; }
      if (dt > 21) { net += h.m; return tag + "dealer busts, you win"; }
      if (t > dt) { net += h.m; return tag + `${t} beats ${dt}`; }
      if (t < dt) { net -= h.m; return tag + `${dt} beats ${t}`; }
      return tag + `push at ${t}`;
    });
    const msg = words.join(". ");
    finish(net, msg.charAt(0).toUpperCase() + msg.slice(1) + ".");
  }

  function finish(net, msg) {
    const R = G.R;
    R.over = true; R.net = net; R.live = null;
    R.msg = msg;
    G.bank += net * G.bet;
    G.stats.n++; G.stats.net += net;
    if (net > 0) G.stats.wins++; else if (net === 0) G.stats.pushes++;
    G.stats.log.push({ fc: R.fc, win: net > 0 ? 1 : 0, book: !R.deviated, decks: R.shoeDecks });
    if (R.locked && !R.deviated && R.fc) {          // "you vs the model": Brier score on hands played by the book
      const y = net > 0 ? 1 : 0, pm = R.fc[G.model];
      G.duel.n++; G.duel.you += (R.guess - y) ** 2; G.duel.model += (pm - y) ** 2;
    }
    G.busy = false;
    if (!G.fast) { render(); if (net !== 0) burst(net > 0); }
  }

  // the basic-strategy move, falling back when the bankroll can't cover a double or split
  function bookMove() {
    const R = G.R, h = R.hands[R.active], v = vals(h), ok = allowed();
    let a = suggestion();
    if (a === "P" && !ok.P) a = decide(v, R.dealer[0].v, v.length === 2, false);
    if (a === "D" && !ok.D) a = decide(v, R.dealer[0].v, false, false);
    return a;
  }
  async function playByTheBook() {
    if (!G.R || G.R.over) return;
    while (G.R && !G.R.over) { if (G.busy) await new Promise((r) => setTimeout(r, 60)); else await act(bookMove()); }
  }
  async function fastHands(k) {
    if (G.busy || (G.R && !G.R.over)) return;
    G.fast = true;
    const startBank = G.bank;
    for (let i = 0; i < k; i++) {
      if (G.bank < G.bet) G.bank += 1000;   // quietly top up so the run finishes
      await deal();
      while (!G.R.over) await act(bookMove());
    }
    G.fast = false;
    G.R.msg = `Played ${k} hands by the book. Your stack moved by ${fmtChips(G.bank - startBank)}.`;
    render();
  }

  // ---------- drawing ----------
  const pct = (p, d = 1) => (100 * p).toFixed(d) + "%";
  const fmtChips = (x) => (x >= 0 ? "+" : "−") + Math.abs(Math.round(x)).toLocaleString();
  function cardEl(c) {
    const el = document.createElement("div");
    const red = c.s === "♥" || c.s === "♦";
    el.className = "pcard" + (c.up ? "" : " down") + (red ? " red" : "");
    if (!G.seen.has(c.id)) { el.classList.add("dealt"); G.seen.add(c.id); }
    if (c.up && c.wasDown) { el.classList.add("flip"); c.wasDown = false; }
    if (c.up) {
      el.innerHTML = `<span class="ix">${c.r}<br>${c.s}</span><span class="pip">${c.s}</span><span class="ix br">${c.r}<br>${c.s}</span>`;
      el.setAttribute("aria-label", `${c.r} of ${{ "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[c.s]}`);
    } else { c.wasDown = true; el.setAttribute("aria-label", "face-down card"); }
    return el;
  }
  function totalLabel(cards) {
    const { t, soft } = hv(cards.map((c) => c.v));
    if (cards.length === 2 && t === 21) return "Blackjack";
    if (t > 21) return `Bust (${t})`;
    return (soft ? "Soft " : "") + t;
  }
  function say(m) { if (G.R) { G.R.msg = m; render(); } else $("g-msg").textContent = m; }
  function toast(m) { if (G.fast) return; const t = $("g-toast"); t.textContent = m; t.classList.remove("show"); void t.offsetWidth; t.classList.add("show"); }
  function burst(win) {
    if (reduceMotion) return;
    const host = $("g-felt");
    for (let i = 0; i < (win ? 14 : 0); i++) {
      const ch = document.createElement("span");
      ch.className = "fly-chip";
      ch.style.left = 40 + Math.random() * 20 + "%";
      ch.style.setProperty("--dx", (Math.random() * 2 - 1) * 180 + "px");
      ch.style.setProperty("--dy", -(80 + Math.random() * 140) + "px");
      ch.style.animationDelay = Math.random() * 0.15 + "s";
      host.appendChild(ch);
      setTimeout(() => ch.remove(), 1300);
    }
  }
  function countTo(el, target) {
    const from = parseFloat(el.dataset.v || "0");
    el.dataset.v = target;
    if (reduceMotion || G.fast) { el.textContent = (100 * target).toFixed(1) + "%"; return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 450), e = 1 - Math.pow(1 - k, 3);
      el.textContent = (100 * (from + (target - from) * e)).toFixed(1) + "%";
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function render() {
    if (G.fast) return;
    const R = G.R;
    // cards
    const dz = $("g-dealer"), pz = $("g-player");
    dz.innerHTML = ""; pz.innerHTML = "";
    if (R) {
      const row1 = document.createElement("div"); row1.className = "cards";
      R.dealer.forEach((c) => row1.appendChild(cardEl(c)));
      dz.appendChild(row1);
      const dl = document.createElement("div"); dl.className = "tot";
      dl.textContent = R.dealer.length < 2 ? "" : R.holeHidden ? `Showing ${R.dealer[0].r === "A" ? "an ace" : R.dealer[0].v}` : totalLabel(R.dealer);
      dz.appendChild(dl);
      R.hands.forEach((h, i) => {
        const wrap = document.createElement("div");
        wrap.className = "hand" + (R.hands.length > 1 && i === R.active && !R.over ? " active" : "");
        const row2 = document.createElement("div"); row2.className = "cards";
        h.c.forEach((c) => row2.appendChild(cardEl(c)));
        wrap.appendChild(row2);
        const tl = document.createElement("div"); tl.className = "tot";
        tl.textContent = h.c.length ? totalLabel(h.c) + (h.m === 2 ? ", doubled" : "") : "";
        wrap.appendChild(tl);
        pz.appendChild(wrap);
      });
    }
    $("g-msg").textContent = R ? R.msg : "Choose a bet and deal.";
    $("g-msg").className = "g-msg" + (R && R.over ? (R.net > 0 ? " win" : R.net < 0 ? " lose" : " push") : "");

    // buttons
    const ok = allowed();
    ["H", "S", "D", "P"].forEach((a) => ($("g-" + a).disabled = !ok[a]));
    $("g-deal").disabled = G.busy || (R && !R.over);
    $("g-book").disabled = !R || R.over || G.busy;
    $("g-fast").disabled = G.busy || (R && !R.over);
    document.querySelectorAll("#g-chips button").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.v === G.bet));
    $("g-bank").textContent = Math.round(G.bank).toLocaleString();
    $("g-betv").textContent = G.bet;

    // forecast panel
    const hide = G.guessMode && R && R.fc && !R.locked && !R.over;
    $("g-guess").hidden = !hide;
    if (hide) {
      $("g-p").textContent = "?"; $("g-p").dataset.v = 0; $("g-pnot").textContent = "?";
      $("g-hand").textContent = `${R.fc.type[0].toUpperCase() + R.fc.type.slice(1)} against a dealer ${R.dealer[0].r === "A" ? "ace" : R.dealer[0].v}. What is your chance of winning this round?`;
      $("g-others").innerHTML = ""; $("g-ref").textContent = "";
      $("g-gv").textContent = $("g-gs").value + "%";
    } else if (R && R.fc) {
      const fc = R.fc;
      countTo($("g-p"), fc[G.model]);
      $("g-pnot").textContent = pct(1 - fc[G.model]);
      $("g-hand").textContent = `${fc.type[0].toUpperCase() + fc.type.slice(1)} against a dealer ${R.dealer[0].r === "A" ? "ace" : R.dealer[0].v}, count ${(R.pre.tc >= 0 ? "+" : "") + R.pre.tc.toFixed(2)}${fc.clamped ? " (the model grid stops at ±4, so ±4 is used)" : ""}.` +
        (R.shoeDecks !== 6 ? ` The models were trained on 6-deck shoes only; with ${R.shoeDecks} deck${R.shoeDecks > 1 ? "s" : ""} this forecast is outside the conditions they learned from. Compare it with the live simulation.` : "") +
        (R.locked ? ` Your guess was ${Math.round(100 * R.guess)}%.` : "");
      $("g-others").innerHTML = MODELS.map((m) => `<button type="button" aria-pressed="${m === G.model}" data-m="${m}"><span>${m}</span><b>${pct(fc[m])}</b></button>`).join("");
      $("g-others").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { G.model = b.dataset.m; render(); }));
      $("g-ref").textContent = fc.ref ? `20M-round reference for this hand and count bin: ${pct(fc.ref[0])} ± ${(100 * fc.ref[1]).toFixed(1)}` : "";
    } else {
      $("g-p").textContent = "–"; $("g-p").dataset.v = 0; $("g-pnot").textContent = "–";
      $("g-hand").textContent = "Deal a hand to see the forecast.";
      $("g-others").innerHTML = ""; $("g-ref").textContent = "";
    }
    // the small read-out on the felt, so the forecast is visible next to the cards on a phone
    const pill = $("g-pill");
    if (R && R.fc && !R.over) {
      pill.hidden = false;
      pill.textContent = hide ? "Make your guess before the model reveals its forecast." :
        `${G.model} forecast ${pct(R.fc[G.model])} to win` + (R.live ? `, live simulation ${pct(R.live.w)}` : "");
    } else if (R && R.over && R.fc) {
      pill.hidden = false;
      pill.textContent = `The forecast was ${pct(R.fc[G.model])}. ` + (R.net > 0 ? "This one landed." : "This one did not.");
    } else pill.hidden = true;
    // live bar
    const L = R && R.live && !hide;   // in guess mode the live odds would give the answer away
    $("g-live").style.opacity = L ? 1 : 0.35;
    const w = L ? L.w : 0, p = L ? L.p : 0, l = L ? L.l : 0;
    $("g-lw").style.width = pct(w); $("g-lp").style.width = pct(p); $("g-ll").style.width = pct(l);
    $("g-livetxt").textContent = hide ? "Hidden until you lock in your guess." : L ? `Win ${pct(w)}, push ${pct(p)}, lose ${pct(l)} (each ± about 0.8 points)` : (R && R.over ? "The hand is over." : "Starts when a hand is dealt.");
    // hint
    if (R && !R.over && R.peeked && R.active < R.hands.length) {
      const s = { H: "hit", S: "stand", D: "double down", P: "split" }[suggestion()];
      $("g-hint").innerHTML = `Basic strategy says <b>${s}</b>.` + (R.deviated ? " You have left basic strategy this hand, so the model's forecast no longer describes it. The live simulation still does." : "");
    } else $("g-hint").textContent = R && R.over && R.deviated ? "This hand left basic strategy, so it is excluded from the forecast check below." : "";
    // count
    $("g-rc").textContent = (G.rc >= 0 ? "+" : "") + G.rc;
    $("g-dk").textContent = (left() / 52).toFixed(1);
    const tcNow = G.rc / (left() / 52);
    $("g-tc").textContent = (tcNow >= 0 ? "+" : "") + tcNow.toFixed(2);
    // session check
    const book = G.stats.log.filter((x) => x.book && x.decks === 6);
    if (book.length) {
      const avg = book.reduce((s, x) => s + x.fc[G.model], 0) / book.length;
      const won = book.reduce((s, x) => s + x.win, 0) / book.length;
      const se = Math.sqrt(Math.max(avg * (1 - avg), 0.01) / book.length);
      $("g-check").innerHTML = `Over <b>${book.length.toLocaleString()}</b> hand${book.length > 1 ? "s" : ""} played by the book, ${G.model} forecast an average win chance of <b>${pct(avg)}</b>. You won <b>${pct(won)}</b>. ` +
        (book.length < 200 ? "With this few hands, gaps of several points are normal." : `The expected spread at this sample size is about ±${(196 * se).toFixed(1)} points.`);
    } else $("g-check").textContent = G.decks !== 6 ? "The forecast check counts 6-deck hands only, because that is what the models were trained on. Switch back to 6 decks to add to it." :
      "Play a few hands, or run 200 at once, to check the model's forecasts against what actually happens.";
    const D = G.duel;
    $("g-duel").innerHTML = D.n ? `<b>You against ${G.model}</b> over ${D.n} guessed hand${D.n > 1 ? "s" : ""}: Brier score ${(D.you / D.n).toFixed(3)} for you, ${(D.model / D.n).toFixed(3)} for the model (lower is better). ` +
      (D.n < 20 ? "Too few hands to call it yet." : D.you < D.model ? "You are ahead." : "The model is ahead.") : "";
    $("g-arc").textContent = `Blackjack pays 3 to 2. Dealer stands on all 17s. ${G.decks} deck${G.decks > 1 ? "s" : ""}, new shoe at the cut card.`;
    const midHand = !!(R && !R.over) || G.busy;
    $("g-decks").disabled = midHand; $("g-newshoe").disabled = midHand;
    $("g-decks").value = G.decks;
    $("g-sess").textContent = `${G.stats.n} hands, ${G.stats.wins} won, ${G.stats.pushes} pushed, net ${fmtChips(G.stats.net * G.bet)} at the current bet`;
  }

  // ---------- wiring ----------
  function init() {
    if (!$("g-felt")) return;
    newShoe();
    [10, 25, 100, 500].forEach((v) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip c" + v; b.dataset.v = v; b.textContent = v;
      b.setAttribute("aria-label", "Bet " + v);
      b.addEventListener("click", () => { if (G.R && !G.R.over) return; G.bet = v; render(); });
      $("g-chips").appendChild(b);
    });
    $("g-deal").addEventListener("click", deal);
    $("g-H").addEventListener("click", () => act("H"));
    $("g-S").addEventListener("click", () => act("S"));
    $("g-D").addEventListener("click", () => act("D"));
    $("g-P").addEventListener("click", () => act("P"));
    $("g-book").addEventListener("click", playByTheBook);
    $("g-fast").addEventListener("click", () => fastHands(200));
    $("g-rebuy").addEventListener("click", () => { G.bank += 1000; render(); });
    $("g-decks").addEventListener("change", (e) => {
      if (G.busy || (G.R && !G.R.over)) { e.target.value = G.decks; return; }
      G.decks = +e.target.value; newShoe(); G.R = null;
      toast(`New ${G.decks}-deck shoe. The count is back to zero.`); render();
    });
    $("g-newshoe").addEventListener("click", () => {
      if (G.busy || (G.R && !G.R.over)) return;
      newShoe(); G.R = null; toast("Fresh shoe shuffled. The count is back to zero."); render();
    });
    $("g-guessmode").addEventListener("change", (e) => { G.guessMode = e.target.checked; render(); });
    $("g-gs").addEventListener("input", () => { $("g-gv").textContent = $("g-gs").value + "%"; });
    $("g-lock").addEventListener("click", () => {
      const R = G.R; if (!R || R.over || R.locked) return;
      R.guess = +$("g-gs").value / 100; R.locked = true; render();
    });
    $("g-resetstats").addEventListener("click", () => {
      G.stats = { n: 0, wins: 0, pushes: 0, net: 0, log: [] }; G.duel = { n: 0, you: 0, model: 0 }; render();
    });
    document.addEventListener("keydown", (e) => {
      if (e.target.closest("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const map = { h: "H", s: "S", d: "D", p: "P" };
      if (map[k] && G.R && !G.R.over) { act(map[k]); }
      else if ((k === "n" || k === "enter") && !G.busy && (!G.R || G.R.over) && document.activeElement === document.body) deal();
    });
    render();
  }
  init();
})();
