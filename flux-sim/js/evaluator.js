// Offline analysis built on the deterministic engine:
//   - runBatch:        many games, aggregate outcome stats
//   - payoffMatrix:    strategy-vs-strategy win rates
//   - fictitiousPlay:  solve the matrix for a (mixed) Nash equilibrium
//   - gamestateValue:  Monte-Carlo value of each technique per game-state bucket
//   - report:          turn all of the above into a written analysis
(function (root) {
  "use strict";

  const F = root.Flux;
  const NAMES = F.STRATEGY_NAMES;

  function fmtPct(x) {
    return (100 * x).toFixed(1) + "%";
  }
  function fmt(x, d = 2) {
    return Number(x).toFixed(d);
  }

  // ---- Game-state bucketing (shared by auto-select context + evaluator) ------
  function bucketFor(state, cellId) {
    const me = state.cells[cellId];
    const them = state.cells[cellId === "A" ? "B" : "A"];
    const pd = me.points - them.points;
    const ptStatus = pd > 3 ? "ahead" : pd < -3 ? "behind" : "even";
    const bd = me.pockets - them.pockets;
    const ballStatus =
      bd > 0 ? "ball-lead" : bd < 0 ? "ball-trail" : "ball-even";
    return ptStatus + " / " + ballStatus;
  }

  // ---- Batch -----------------------------------------------------------------
  function runBatch(opts, n, onProgress) {
    const agg = {
      games: n,
      aWins: 0,
      bWins: 0,
      draws: 0,
      pointsA: 0,
      pointsB: 0,
      steps: 0,
      closeout: 0,
      timerule: 0,
      pyrrhic: 0,
    };
    for (let i = 0; i < n; i++) {
      const eng = new F.FluxEngine(
        Object.assign({}, opts, { seed: (opts.seed || 1) * 7919 + i }),
      );
      const r = eng.run();
      if (r.winnerCell === "A") agg.aWins++;
      else if (r.winnerCell === "B") agg.bWins++;
      else agg.draws++;
      agg.pointsA += r.pointsA;
      agg.pointsB += r.pointsB;
      agg.steps += r.steps;
      if (r.reason === "closeout") agg.closeout++;
      else agg.timerule++;
      if (r.pyrrhic) agg.pyrrhic++;
      if (onProgress && i % 10 === 0) onProgress(i / n);
    }
    agg.avgPointsA = agg.pointsA / n;
    agg.avgPointsB = agg.pointsB / n;
    agg.avgSteps = agg.steps / n;
    agg.pyrrhicRate = agg.pyrrhic / n;
    agg.timeruleRate = agg.timerule / n;
    agg.drawRate = agg.draws / n;
    return agg;
  }

  // ---- Payoff matrix: A plays row strategy, B plays column strategy ----------
  // M[i][j] = win probability for the row player (A). Because the field is
  // symmetric, this is a fair game and the matrix is meaningful on its own.
  function payoffMatrix(gamesPerCell, baseSeed, onProgress) {
    const n = NAMES.length;
    const M = Array.from({ length: n }, () => new Array(n).fill(0));
    let done = 0;
    const total = n * n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let aw = 0;
        for (let g = 0; g < gamesPerCell; g++) {
          const eng = new F.FluxEngine({
            seed: (baseSeed || 1) * 31 + i * 1009 + j * 101 + g,
            strategyA: NAMES[i],
            strategyB: NAMES[j],
          });
          const r = eng.run();
          if (r.winnerCell === "A") aw += 1;
          else if (r.winnerCell === "draw") aw += 0.5;
        }
        M[i][j] = aw / gamesPerCell;
        if (onProgress) onProgress(++done / total);
      }
    }
    return M;
  }

  // ---- Fictitious play: mixed-strategy equilibrium of a zero-sum matrix ------
  function fictitiousPlay(M, iters) {
    iters = iters || 20000;
    const n = M.length;
    const rowCount = new Array(n).fill(0);
    const colCount = new Array(n).fill(0);
    rowCount[0] = 1;
    colCount[0] = 1;
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    for (let t = 0; t < iters; t++) {
      const cs = sum(colCount);
      // Row maximizes expected payoff against the column's empirical mix.
      let bi = 0,
        bv = -Infinity;
      for (let i = 0; i < n; i++) {
        let v = 0;
        for (let j = 0; j < n; j++) v += M[i][j] * (colCount[j] / cs);
        if (v > bv) {
          bv = v;
          bi = i;
        }
      }
      rowCount[bi]++;
      const rs = sum(rowCount);
      // Column minimizes the row's expected payoff (zero-sum opponent).
      let bj = 0,
        bw = Infinity;
      for (let j = 0; j < n; j++) {
        let v = 0;
        for (let i = 0; i < n; i++) v += M[i][j] * (rowCount[i] / rs);
        if (v < bw) {
          bw = v;
          bj = j;
        }
      }
      colCount[bj]++;
    }
    const rs = sum(rowCount);
    const dist = rowCount.map((c) => c / rs);
    // Game value = what the equilibrium mix guarantees against the best reply.
    let value = Infinity;
    for (let j = 0; j < n; j++) {
      let v = 0;
      for (let i = 0; i < n; i++) v += dist[i] * M[i][j];
      value = Math.min(value, v);
    }
    return { dist, value };
  }

  function bestResponses(M) {
    // For each opponent strategy, which row strategy answers it best?
    return M[0].map((_, j) => {
      let bi = 0,
        bv = -Infinity;
      for (let i = 0; i < M.length; i++)
        if (M[i][j] > bv) {
          bv = M[i][j];
          bi = i;
        }
      return { vs: NAMES[j], best: NAMES[bi], winRate: bv };
    });
  }

  function dominantStrategy(M) {
    // A row strictly dominates if it beats every other row column-wise.
    for (let i = 0; i < M.length; i++) {
      let dom = true;
      for (let k = 0; k < M.length && dom; k++) {
        if (k === i) continue;
        for (let j = 0; j < M.length; j++)
          if (M[i][j] < M[k][j]) {
            dom = false;
            break;
          }
      }
      if (dom) return NAMES[i];
    }
    return null;
  }

  // ---- Per-gamestate technique value (Monte Carlo with exploration) ----------
  // Run games where each cell, at each decision tick, mostly auto-selects but
  // sometimes explores a random strategy. Label every (bucket, choice) by the
  // eventual win/loss for that cell. Averaging gives a value per technique per
  // state -- the "strategy evaluator for each technique-gamestate pairing".
  function gamestateValue(games, epsilon, baseSeed, onProgress) {
    epsilon = epsilon == null ? 0.35 : epsilon;
    const table = {}; // bucket -> strategy -> {n, wins}
    function record(bucket, strat, win) {
      table[bucket] = table[bucket] || {};
      const s = (table[bucket][strat] = table[bucket][strat] || {
        n: 0,
        wins: 0,
      });
      s.n++;
      s.wins += win;
    }
    for (let g = 0; g < games; g++) {
      const eng = new F.FluxEngine({ seed: (baseSeed || 1) * 13 + g * 17 });
      const erng = F.makeRng((baseSeed || 1) * 777 + g);
      const visits = { A: [], B: [] };
      // Override strategy selection on this instance to add exploration + logging.
      eng._chooseStrategies = function () {
        for (const id of ["A", "B"]) {
          const auto = F.autoSelect(this, id);
          let choice = auto;
          if (erng.chance(epsilon)) choice = erng.pick(NAMES);
          this.cells[id].strategy = choice;
          visits[id].push({ bucket: bucketFor(this, id), strat: choice });
        }
      };
      const r = eng.run();
      const win = {
        A: r.winnerCell === "A" ? 1 : r.winnerCell === "draw" ? 0.5 : 0,
        B: r.winnerCell === "B" ? 1 : r.winnerCell === "draw" ? 0.5 : 0,
      };
      for (const id of ["A", "B"]) {
        // First-visit: dedupe (bucket,strat) within a game.
        const seen = new Set();
        for (const v of visits[id]) {
          const key = v.bucket + "|" + v.strat;
          if (seen.has(key)) continue;
          seen.add(key);
          record(v.bucket, v.strat, win[id]);
        }
      }
      if (onProgress && g % 10 === 0) onProgress(g / games);
    }
    // Reduce to best technique per bucket.
    const best = {};
    for (const bucket of Object.keys(table)) {
      const rows = Object.entries(table[bucket])
        .map(([strat, s]) => ({ strat, n: s.n, winRate: s.wins / s.n }))
        .filter((r) => r.n >= Math.max(5, games * 0.01))
        .sort((a, b) => b.winRate - a.winRate);
      if (rows.length) best[bucket] = rows;
    }
    return best;
  }

  // ---- Report ----------------------------------------------------------------
  function makeReport(params) {
    const { batch, M, eq, brs, dom, gsv } = params;
    const L = [];
    L.push("# Flux — Strategy & Rules Analysis\n");

    L.push("## 1. Overall match outcomes (auto-selecting strategies)\n");
    L.push("| Metric | Value |\n|---|---|");
    L.push(`| Games | ${batch.games} |`);
    L.push(`| Cell A wins | ${fmtPct(batch.aWins / batch.games)} |`);
    L.push(`| Cell B wins | ${fmtPct(batch.bWins / batch.games)} |`);
    L.push(`| Draws | ${fmtPct(batch.drawRate)} |`);
    L.push(
      `| Avg points (A / B) | ${fmt(batch.avgPointsA)} / ${fmt(batch.avgPointsB)} |`,
    );
    L.push(
      `| Ended by close-out / time rule | ${fmtPct(1 - batch.timeruleRate)} / ${fmtPct(batch.timeruleRate)} |`,
    );
    L.push(
      `| **Pyrrhic close-outs** (ended the game but lost on points) | ${fmtPct(batch.pyrrhicRate)} |`,
    );
    L.push("");

    L.push("## 2. Strategy payoff matrix (row = A, win rate for A)\n");
    L.push("| A \\\\ B | " + NAMES.join(" | ") + " |");
    L.push("|---|" + NAMES.map(() => "---").join("|") + "|");
    M.forEach((row, i) => {
      L.push(
        "| **" +
          NAMES[i] +
          "** | " +
          row.map((v) => fmtPct(v)).join(" | ") +
          " |",
      );
    });
    L.push("");

    L.push("## 3. Best responses\n");
    L.push(
      "| If opponent plays | Your best answer | Win rate |\n|---|---|---|",
    );
    brs.forEach((b) =>
      L.push(`| ${b.vs} | ${b.best} | ${fmtPct(b.winRate)} |`),
    );
    L.push("");

    L.push("## 4. Game-theory equilibrium\n");
    if (dom) {
      L.push(
        `A pure strategy **dominates**: always play **${dom}**. This is a red`,
      );
      L.push(
        `flag for the rules -- one technique beating all others means the`,
      );
      L.push(`strategic space is shallow and should be rebalanced.\n`);
    } else {
      L.push(
        "No single strategy dominates. The equilibrium is a **mix** -- play",
      );
      L.push(
        "each strategy with the following frequency to be unexploitable:\n",
      );
      L.push("| Strategy | Play frequency |\n|---|---|");
      eq.dist.forEach((p, i) => {
        if (p > 0.001) L.push(`| ${NAMES[i]} | ${fmtPct(p)} |`);
      });
      L.push(
        `\nGuaranteed win rate of this mix vs. any opponent: **${fmtPct(eq.value)}**`,
      );
      L.push("(≈ 50% confirms a balanced, fair design).\n");
    }

    L.push("## 5. Best technique per game state\n");
    L.push(
      "Monte-Carlo value of each technique, conditioned on the situation at",
    );
    L.push("the moment of choosing. Use this as the in-game decision guide.\n");
    L.push(
      "| Game state | Best technique | Win rate | Runner-up |\n|---|---|---|---|",
    );
    const order = (b) =>
      b.startsWith("ahead") ? 0 : b.startsWith("even") ? 1 : 2;
    Object.keys(gsv)
      .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
      .forEach((bucket) => {
        const rows = gsv[bucket];
        const top = rows[0];
        const runner = rows[1];
        L.push(
          `| ${bucket} | **${top.strat}** | ${fmtPct(top.winRate)} | ` +
            (runner ? `${runner.strat} (${fmtPct(runner.winRate)})` : "—") +
            " |",
        );
      });
    L.push("");

    L.push("## 6. Rules signals (possible holes)\n");
    const signals = [];
    if (batch.pyrrhicRate > 0.12)
      signals.push(
        `**Close-out timing is exploitable.** ${fmtPct(batch.pyrrhicRate)} of games ` +
          `were ended by the cell that then LOST on points. The "balls are the clock" ` +
          `rule creates strong incentive to stall at 2 pockets; consider a rule that ` +
          `discourages indefinite stalling (e.g. a soft cap or escalating ball spawn).`,
      );
    if (batch.timeruleRate > 0.5)
      signals.push(
        `**The clock rarely resolves the game.** ${fmtPct(batch.timeruleRate)} of games ` +
          `hit the time rule instead of a close-out -- pocketing may be too hard ` +
          `relative to defense, or stalling is too easy.`,
      );
    if (batch.drawRate > 0.1)
      signals.push(
        `**Draws are common** (${fmtPct(batch.drawRate)}). Add a tiebreaker.`,
      );
    if (dom)
      signals.push(
        `**Degenerate strategy space.** "${dom}" dominates; rebalance.`,
      );
    if (Math.abs(batch.aWins - batch.bWins) / batch.games > 0.1)
      signals.push(
        `**Side asymmetry.** A and B win rates differ by ` +
          `${fmtPct(Math.abs(batch.aWins - batch.bWins) / batch.games)} despite a mirrored ` +
          `field -- check for a first-mover or layout bias.`,
      );
    if (!signals.length)
      signals.push("No major red flags detected at current settings.");
    signals.forEach((s) => L.push("- " + s));
    L.push("");

    L.push("## 7. How to play (plain-language summary)\n");
    L.push(
      "- Flux is two games at once: the **ball race** (the clock) and the",
    );
    L.push(
      "  **ribbon duel** (the score). You win by ending the ball race while",
    );
    L.push("  ahead on ribbons.");
    L.push(
      "- When **ahead on points**, push the ball race (Rush) to end it before",
    );
    L.push("  the opponent catches up.");
    L.push(
      "- When **behind on points**, do NOT pocket your third ball. Stall at two",
    );
    L.push("  and hunt ribbons (Aggro), or deny their close-out (Contain).");
    L.push(
      "- Scoring joint ribbons makes you a target: a vital pull strips your",
    );
    L.push("  accumulated points, so a high scorer is worth hunting.");
    return L.join("\n");
  }

  root.Flux = root.Flux || {};
  root.Flux.evaluator = {
    bucketFor,
    runBatch,
    payoffMatrix,
    fictitiousPlay,
    bestResponses,
    dominantStrategy,
    gamestateValue,
    makeReport,
  };
})(typeof self !== "undefined" ? self : this);
