// Everything on this page is drawn from window.BJ (docs/data.js), which src/run.py writes.
// No server, no libraries: plain SVG so it works on GitHub Pages and when opened as a file.
(function () {
  const BJ = window.BJ;
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const UPS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "A"];
  const MODELS = ["Table", "Table+count", "Logistic", "Boosted trees"];
  const COLOR = { "Table": "--grey", "Table+count": "--blue", "Logistic": "--win", "Boosted trees": "--ochre" };
  const pct = (p, d = 1) => (100 * p).toFixed(d) + "%";
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const cell = (h, u) => BJ.explorer[h * 10 + u];

  // ---------- tiny chart helper ----------
  function chart(host, o) {
    host.innerHTML = "";
    const W = Math.max(340, Math.min(o.width || 760, host.clientWidth || 760)), H = (o.height || 340) * (W < 560 ? 0.9 : 1), m = { l: 58, r: 16, t: 14, b: 44, ...(o.margin || {}) };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": o.label || "" }, host);
    const xs = o.xlog ? (v) => m.l + (Math.log10(v) - Math.log10(o.x[0])) / (Math.log10(o.x[1]) - Math.log10(o.x[0])) * (W - m.l - m.r)
                      : (v) => m.l + (v - o.x[0]) / (o.x[1] - o.x[0]) * (W - m.l - m.r);
    const ys = (v) => H - m.b - (v - o.y[0]) / (o.y[1] - o.y[0]) * (H - m.t - m.b);
    const grid = el("g", { class: "grid" }, svg), ax = el("g", { class: "axis" }, svg);
    (o.yticks || []).forEach((t) => {
      el("line", { x1: m.l, x2: W - m.r, y1: ys(t), y2: ys(t) }, grid);
      el("text", { x: m.l - 8, y: ys(t) + 4, "text-anchor": "end" }, ax).textContent = o.yfmt ? o.yfmt(t) : t;
    });
    (o.xticks || []).forEach((t) => {
      el("line", { x1: xs(t), x2: xs(t), y1: H - m.b, y2: H - m.b + 5 }, ax);
      el("text", { x: xs(t), y: H - m.b + 19, "text-anchor": "middle" }, ax).textContent = o.xfmt ? o.xfmt(t) : t;
    });
    el("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }, ax);
    if (o.xlabel) el("text", { x: (m.l + W - m.r) / 2, y: H - 6, "text-anchor": "middle", class: "lbl" }, ax).textContent = o.xlabel;
    if (o.ylabel) el("text", { x: 14, y: (m.t + H - m.b) / 2, "text-anchor": "middle", class: "lbl",
      transform: `rotate(-90 14 ${(m.t + H - m.b) / 2})` }, ax).textContent = o.ylabel;
    if (o.zero !== undefined) el("line", { x1: m.l, x2: W - m.r, y1: ys(o.zero), y2: ys(o.zero), stroke: css("--ink"), "stroke-width": 1 }, svg);
    (o.lines || []).forEach((s) => {
      let d = "";
      s.pts.forEach(([x, y], i) => {
        if (y === null) return;
        if (!d) d = `M${xs(x)},${ys(y)}`;
        else d += s.step ? `H${xs(x)}V${ys(y)}` : `L${xs(x)},${ys(y)}`;
      });
      el("path", { d, fill: "none", stroke: css(s.color), "stroke-width": s.width || 2.2, "stroke-dasharray": s.dash || "" }, svg);
      if (s.dots) s.pts.forEach(([x, y]) => el("circle", { cx: xs(x), cy: ys(y), r: 3.2, fill: css(s.color) }, svg));
    });
    (o.points || []).forEach((s) => s.pts.forEach(([x, y, lo, hi]) => {
      el("line", { x1: xs(x), x2: xs(x), y1: ys(Math.max(lo, o.y[0])), y2: ys(Math.min(hi, o.y[1])), stroke: css(s.color), "stroke-width": 1.4 }, svg);
      el("circle", { cx: xs(x), cy: ys(y), r: s.r || 4, fill: css("--card"), stroke: css(s.color), "stroke-width": 2 }, svg);
    }));
    if (o.vline !== undefined) el("line", { x1: xs(o.vline), x2: xs(o.vline), y1: m.t, y2: H - m.b,
      stroke: css("--ink"), "stroke-dasharray": "3 4", "stroke-width": 1 }, svg);
    return { svg, xs, ys };
  }
  const niceTicks = (lo, hi, n = 5) => {
    const step0 = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= step0);
    const out = []; for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-12; t += step) out.push(+t.toFixed(10));
    return out;
  };

  // ---------- 1. strategy-card heatmap ----------
  function mix(a, b, t) {
    const pa = a.match(/\w\w/g).map((x) => parseInt(x, 16)), pb = b.match(/\w\w/g).map((x) => parseInt(x, 16));
    return "rgb(" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(",") + ")";
  }
  function heatColor(p) {
    const win = css("--win"), loss = css("--loss"), mid = css("--mid");
    return p >= 0.5 ? mix(mid, win, Math.min(1, (p - 0.5) / 0.4)) : mix(mid, loss, Math.min(1, (0.5 - p) / 0.3));
  }
  const GROUP_START = new Set(["hard 5", "soft 13", "blackjack", "pair of 2s"]);
  function drawGrid() {
    const g = document.getElementById("grid");
    g.innerHTML = "";
    const corner = document.createElement("div"); corner.className = "hd"; corner.textContent = "You \\ dealer"; g.appendChild(corner);
    UPS.forEach((u) => { const d = document.createElement("div"); d.className = "hd"; d.textContent = u; g.appendChild(d); });
    BJ.hand_types.forEach((name, h) => {
      if (GROUP_START.has(name) && h > 0) { const s = document.createElement("div"); s.className = "sep"; g.appendChild(s); }
      const l = document.createElement("div"); l.className = "rl"; l.textContent = name; g.appendChild(l);
      for (let u = 0; u < 10; u++) {
        const p = cell(h, u).pred["Table"][0];
        const b = document.createElement("button");
        b.textContent = Math.round(100 * p);
        b.style.background = heatColor(p);
        b.style.color = Math.abs(p - 0.5) > 0.2 ? css("--card") : css("--ink");
        b.dataset.h = h; b.dataset.u = u;
        b.setAttribute("aria-label", `${name} against dealer ${UPS[u]}: ${pct(p)} win chance. Open in explorer.`);
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", () => { setState({ h, u }); document.getElementById("explore").scrollIntoView(); });
        g.appendChild(b);
      }
    });
    const bar = document.querySelector(".legend .bar");
    bar.style.background = `linear-gradient(90deg, ${heatColor(0.2)}, ${heatColor(0.5)}, ${heatColor(0.9)})`;
  }

  // ---------- 2. explorer ----------
  const S = { h: BJ.hand_types.indexOf("hard 16"), u: 8, x: 0, on: new Set(MODELS) };
  function setState(patch) { Object.assign(S, patch); drawExplorer(); syncControls(); }
  function syncControls() {
    document.getElementById("hand").value = S.h;
    document.querySelectorAll(".ups button").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.u === S.u));
    document.querySelectorAll("#grid button").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.h === S.h && +b.dataset.u === S.u));
    document.getElementById("countval").textContent = (S.x > 0 ? "+" : "") + S.x.toFixed(2);
  }
  function binOf(x) { let b = 0; BJ.count_bin_edges.forEach((e) => { if (x >= e) b++; }); return b; }
  function drawExplorer() {
    const c = cell(S.h, S.u), xs = BJ.count_grid;
    const refPts = c.ref.map((r, b) => r && [b - 4, r[0], r[0] - r[1], r[0] + r[1]]).filter(Boolean);
    let lo = 1, hi = 0;
    MODELS.forEach((m) => { if (S.on.has(m)) c.pred[m].forEach((v) => { lo = Math.min(lo, v); hi = Math.max(hi, v); }); });
    refPts.forEach((r) => { lo = Math.min(lo, r[2]); hi = Math.max(hi, r[3]); });
    const pad = Math.max(0.01, (hi - lo) * 0.12); lo = Math.max(0, lo - pad); hi = Math.min(1, hi + pad);
    chart(document.getElementById("exchart"), {
      x: [-4.4, 4.4], y: [lo, hi], xticks: [-4, -3, -2, -1, 0, 1, 2, 3, 4],
      xfmt: (t) => (t > 0 ? "+" : "") + t, yticks: niceTicks(lo, hi), yfmt: (t) => (100 * t).toFixed(hi - lo < 0.05 ? 1 : 0) + "%",
      xlabel: "Player's estimated true count (before the deal)", ylabel: "Chance the round is a win",
      label: "Win probability against count for the chosen hand",
      lines: MODELS.filter((m) => S.on.has(m)).map((m) => ({
        color: COLOR[m], step: m === "Table+count", dash: m === "Table" ? "5 4" : "",
        pts: xs.map((x, i) => [x, c.pred[m][i]]) })),
      points: [{ color: "--ink", pts: refPts }], vline: S.x,
    });
    const i = xs.indexOf(Math.round(S.x * 4) / 4), b = binOf(S.x), r = c.ref[b];
    const rows = MODELS.map((m) => `<tr><td><span class="sw" style="background:${css(COLOR[m])}"></span> ${m}</td><td class="num">${pct(c.pred[m][i])}</td></tr>`).join("");
    const refRow = r ? `<tr><td>Big simulation, this count bin (${r[2].toLocaleString()} rounds)</td><td class="num">${pct(r[0])} ± ${(100 * r[1]).toFixed(1)}</td></tr>` : "";
    document.getElementById("readout").innerHTML = `<tr><th>At count ${(S.x > 0 ? "+" : "") + S.x.toFixed(2)}</th><th class="num">P(win)</th></tr>` + rows + refRow;
    const lg = c.pred["Logistic"], swing = lg[lg.length - 1] - lg[0];
    const name = BJ.hand_types[S.h];
    document.getElementById("explain").textContent =
      `${name[0].toUpperCase() + name.slice(1)} against a dealer ${UPS[S.u]} wins about ${pct(c.pred["Table"][0], 0)} of the time ` +
      `(${c.train_n.toLocaleString()} training rounds). Going from a count of −4 to +4 moves the logistic estimate by ` +
      `${swing >= 0 ? "+" : "−"}${Math.abs(100 * swing).toFixed(1)} percentage points. ` +
      (c.train_n < 1500 ? "This is a rare hand, so the curves wobble more and the reference error bars are wide. " : "") +
      "Black circles are the 20M-round reference with 95% error bars: the closer a line runs through them, the better.";
  }
  function initExplorer() {
    const sel = document.getElementById("hand");
    BJ.hand_types.forEach((n, h) => { const o = document.createElement("option"); o.value = h; o.textContent = n; sel.appendChild(o); });
    sel.addEventListener("change", () => setState({ h: +sel.value }));
    const ups = document.querySelector(".ups");
    UPS.forEach((u, i) => { const b = document.createElement("button"); b.textContent = u; b.dataset.u = i;
      b.setAttribute("aria-label", "Dealer shows " + u); b.addEventListener("click", () => setState({ u: i })); ups.appendChild(b); });
    const range = document.getElementById("count");
    range.addEventListener("input", () => setState({ x: +range.value }));
    const tg = document.getElementById("toggles");
    MODELS.forEach((m) => {
      const l = document.createElement("label");
      l.innerHTML = `<input type="checkbox" checked> <span class="sw" style="background:${css(COLOR[m])}"></span> ${m}`;
      l.querySelector("input").addEventListener("change", (e) => { e.target.checked ? S.on.add(m) : S.on.delete(m); drawExplorer(); });
      tg.appendChild(l);
    });
    setState({});
  }

  // ---------- 3. calibration (observed minus predicted) ----------
  function drawCalib(model) {
    const pts = BJ.calibration[model].map((b) => [b.pred, 100 * (b.obs - b.pred), 100 * (b.lo - b.pred), 100 * (b.hi - b.pred)]);
    chart(document.getElementById("calchart"), {
      x: [0, 1], y: [-3, 3], xticks: [0, .2, .4, .6, .8, 1], xfmt: (t) => Math.round(100 * t) + "%",
      yticks: [-3, -2, -1, 0, 1, 2, 3], yfmt: (t) => (t > 0 ? "+" : "") + t, zero: 0, height: 300,
      xlabel: "Predicted chance of a win (15 equal-size groups of test rounds)", ylabel: "Actual minus predicted (points)",
      label: "Calibration on the test shoes", points: [{ color: COLOR[model], pts }],
    });
  }
  function initCalib() {
    const host = document.getElementById("calpick");
    MODELS.forEach((m, i) => {
      const b = document.createElement("button"); b.textContent = m; b.setAttribute("aria-pressed", i === 2);
      b.addEventListener("click", () => { host.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); drawCalib(m); });
      host.appendChild(b);
    });
    drawCalib("Logistic");
  }

  // ---------- 4. static charts and tables ----------
  function drawCountEffect() {
    const ev = BJ.ev_by_count;
    const evPts = ev.map((r) => [r.mid, 100 * r.ev, 100 * (r.ev - 1.96 * r.ev_se), 100 * (r.ev + 1.96 * r.ev_se)]);
    const lo = Math.min(...evPts.map((p) => p[2])), hi = Math.max(...evPts.map((p) => p[3]));
    chart(document.getElementById("evchart"), { x: [-4.5, 4.5], y: [Math.floor(lo), Math.ceil(hi)], width: 480, height: 300,
      xticks: [-4, -2, 0, 2, 4], xfmt: (t) => (t > 0 ? "+" : "") + t, yticks: niceTicks(Math.floor(lo), Math.ceil(hi), 4),
      yfmt: (t) => (t > 0 ? "+" : "") + t + "%", zero: 0, xlabel: "Estimated true count", ylabel: "Average result per unit bet",
      label: "Expected return by count", points: [{ color: "--blue", pts: evPts }] });
    const wPts = ev.map((r) => [r.mid, 100 * r.win, 100 * (r.win - 1.96 * r.win_se), 100 * (r.win + 1.96 * r.win_se)]);
    const lo2 = Math.min(...wPts.map((p) => p[2])), hi2 = Math.max(...wPts.map((p) => p[3]));
    // same vertical span (in points) as the EV chart so the two slopes can be compared by eye
    const span = Math.ceil(hi) - Math.floor(lo), midw = (lo2 + hi2) / 2;
    chart(document.getElementById("winchart"), { x: [-4.5, 4.5], y: [midw - span / 2, midw + span / 2], width: 480, height: 300,
      xticks: [-4, -2, 0, 2, 4], xfmt: (t) => (t > 0 ? "+" : "") + t, yticks: niceTicks(midw - span / 2, midw + span / 2, 4),
      yfmt: (t) => t.toFixed(0) + "%", xlabel: "Estimated true count", ylabel: "Share of rounds won",
      label: "Win rate by count", points: [{ color: "--win", pts: wPts }] });
  }
  function drawCurve() {
    const lc = BJ.learning_curve, ms = ["Table", "Table+count", "Logistic", "Boosted trees"];
    const vals = lc.flatMap((p) => ms.map((m) => p[m]));
    const lo = Math.min(...vals), hi = Math.max(...vals);
    chart(document.getElementById("lcchart"), { x: [lc[0].rows * 0.8, lc[lc.length - 1].rows * 1.25], xlog: true,
      y: [lo - (hi - lo) * 0.05, hi + (hi - lo) * 0.05], height: 320,
      xticks: lc.map((p) => p.rows), xfmt: (t) => t >= 1000 ? Math.round(t / 1000) + "k" : t,
      yticks: niceTicks(lo, hi), yfmt: (t) => t.toFixed(3),
      xlabel: "Training rounds (log scale)", ylabel: "Held-out log-loss (lower is better)", label: "Learning curve",
      lines: ms.map((m) => ({ color: COLOR[m], dots: true, dash: m === "Table" ? "5 4" : "", pts: lc.map((p) => [p.rows, p[m]]) })) });
    document.getElementById("lclegend").innerHTML = ms.map((m) => `<span><span class="sw" style="background:${css(COLOR[m])}"></span> ${m}</span>`).join(" &nbsp; ");
  }
  function f(v, d) { return v.toFixed(d); }
  function tables() {
    const t = BJ.test, fl = BJ.data;
    document.getElementById("testtable").innerHTML =
      `<tr><th>Model</th><th class="num">Log-loss</th><th class="num">Better than table by (log-loss, ×1000)</th>
       <th class="num">Brier</th><th class="num">AUC</th><th class="num">ECE</th><th class="num">RMSE to reference</th></tr>` +
      t.map((r) => `<tr><td>${r.model}</td>
        <td class="num">${f(r.logloss, 4)}</td>
        <td class="num">${r.model === "Table" ? "–" : `${(1000 * r.ll_gain_vs_table).toFixed(2)} [${(1000 * r.ll_gain_ci[0]).toFixed(2)}, ${(1000 * r.ll_gain_ci[1]).toFixed(2)}]`}</td>
        <td class="num">${f(r.brier, 4)}</td><td class="num">${f(r.auc, 3)}</td><td class="num">${f(r.ece, 4)}</td>
        <td class="num">${(100 * r.rmse_to_ref).toFixed(2)} pts</td></tr>`).join("") +
      `<tr><td>Perfect model (noise floor)</td><td class="num">${f(fl.floor_logloss, 4)}</td><td></td><td class="num">${f(fl.floor_brier, 4)}</td><td></td><td></td><td class="num">0</td></tr>`;
    document.getElementById("abltable").innerHTML =
      `<tr><th>Model</th><th>Count given to the model</th><th class="num">Log-loss</th><th class="num">Gain vs no count (×1000) [95% CI]</th></tr>` +
      BJ.ablation.slice().sort((a, b) => a.model.localeCompare(b.model) || a.logloss - b.logloss).reverse().map((r) =>
        `<tr><td>${r.model}</td><td>${r.count}</td><td class="num">${f(r.logloss, 5)}</td>
         <td class="num">${r.count === "no count" ? "–" : `${(1000 * r.gain_vs_no_count).toFixed(2)} [${(1000 * r.lo).toFixed(2)}, ${(1000 * r.hi).toFixed(2)}]`}</td></tr>`).join("");
    const cvRows = [];
    for (const m in BJ.cv) BJ.cv[m].forEach((r) => cvRows.push(`<tr class="${JSON.stringify(r.params) === JSON.stringify(BJ.best_params[m]) ? "pick" : ""}">
      <td>${m}</td><td>${Object.entries(r.params).map(([k, v]) => k + " = " + v).join(", ")}</td><td class="num">${f(r.cv_logloss, 5)}</td></tr>`));
    document.getElementById("cvtable").innerHTML = `<tr><th>Model</th><th>Setting</th><th class="num">Mean CV log-loss</th></tr>` + cvRows.join("");
    const up = (u) => (u === 11 ? "A" : u);
    const sur = (rows) => rows.map((r) => `<tr><td>${r.hand}</td><td>${up(r.up)}</td><td class="num">${(r.count > 0 ? "+" : "") + r.count}</td><td class="num">${pct(r.p)}</td><td class="num">${(r.net > 0 ? "+" : "") + r.net}</td></tr>`).join("");
    const head = `<tr><th>Hand</th><th>Dealer</th><th class="num">Count</th><th class="num">Logistic P(win)</th><th class="num">Result</th></tr>`;
    document.getElementById("surwon").innerHTML = head + sur(BJ.surprises_won);
    document.getElementById("surlost").innerHTML = head + sur(BJ.surprises_lost);
    document.getElementById("celltable").innerHTML =
      `<tr><th>Hand</th><th>Dealer</th><th class="num">Training rounds</th><th class="num">Reference P(win)</th><th class="num">Table off by</th><th class="num">Logistic off by</th><th class="num">Trees off by</th></tr>` +
      BJ.cell_errors.slice(0, 8).map((r) => `<tr><td>${r.hand}</td><td>${r.up === 11 ? "A" : r.up}</td><td class="num">${r.train_n.toLocaleString()}</td>
        <td class="num">${pct(r.ref)}</td>${["Table", "Logistic", "Boosted trees"].map((m) => `<td class="num">${(r[m] > 0 ? "+" : "") + (100 * r[m]).toFixed(1)}</td>`).join("")}</tr>`).join("");
  }

  // ---------- nav highlight ----------
  function nav() {
    const links = [...document.querySelectorAll("nav.top a")];
    const secs = links.map((a) => document.querySelector(a.getAttribute("href")));
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) links.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id));
    }), { rootMargin: "-40% 0px -55% 0px" });
    secs.forEach((s) => s && io.observe(s));
  }

  function all() { drawGrid(); initExplorer(); initCalib(); drawCountEffect(); drawCurve(); tables(); nav(); }
  all();
  // redraw on light/dark switch so the SVG colours follow
  const redraw = () => {
    drawGrid(); drawExplorer(); syncControls(); drawCountEffect(); drawCurve();
    const on = document.querySelector('#calpick button[aria-pressed="true"]'); drawCalib(on ? on.textContent : "Logistic");
  };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(redraw, 150); });
})();
