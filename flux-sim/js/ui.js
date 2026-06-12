// Wires the DOM controls to the scene and the offline evaluator. Long analyses
// run in cooperative chunks (yielding to the event loop) so the page stays
// responsive and a progress bar can update -- no Web Worker required, so this
// works straight from file://.
(function (root) {
  "use strict";

  const F = root.Flux;
  const $ = (id) => document.getElementById(id);
  const yield_ = () => new Promise((r) => setTimeout(r, 0));

  let scene, current;
  let layoutSeed = F.hashSeed("flux"); // board layout, independent of match seed
  let busy = false; // true while a batch/analysis is running

  function strategyOptions(sel, includeAuto) {
    sel.innerHTML = "";
    if (includeAuto) sel.add(new Option("Auto (game state)", "auto"));
    F.STRATEGY_NAMES.forEach((n) => sel.add(new Option(n, n)));
  }

  function readScenario() {
    const sa = $("stratA").value;
    const sb = $("stratB").value;
    return {
      seed: $("seed").value || "flux",
      strategyA: sa === "auto" ? null : sa,
      strategyB: sb === "auto" ? null : sb,
      circleCount: parseInt($("circleCount").value, 10) || 6,
      layoutSeed,
    };
  }

  // ---- Game state + control gating ------------------------------------------
  function gameState() {
    if (!current) return "ready";
    if (current.result) return "ended";
    if (scene.playing) return "playing";
    if (current.step > 0) return "paused";
    return "ready";
  }

  function refreshControls() {
    const s = gameState();
    const inProgress = s === "playing" || s === "paused";
    // Scenario + board can't change mid-match.
    ["seed", "stratA", "stratB", "circleCount"].forEach(
      (id) => ($(id).disabled = inProgress || busy),
    );
    $("shuffleBoard").disabled = inProgress || busy;
    // Heavy offline runs are blocked while a match is actively playing or busy.
    $("runBatch").disabled = s === "playing" || busy;
    $("runAnalysis").disabled = s === "playing" || busy;
    $("newBtn").disabled = busy;
    $("playBtn").disabled = busy;
    setStatus(s);
  }

  function setStatus(s) {
    const el = $("status");
    el.className = "status " + s;
    if (s === "ready") el.textContent = "Ready";
    else if (s === "playing") el.textContent = "● Live";
    else if (s === "paused") el.textContent = "Paused";
    else {
      const r = current.result;
      el.textContent =
        r.winnerCell === "draw"
          ? "Draw"
          : r.winnerCell === "A"
            ? "Red wins"
            : "Blue wins";
    }
    $("playBtn").textContent =
      s === "playing" ? "Pause" : s === "ended" ? "Replay" : "Play";
  }

  // ---- Match lifecycle -------------------------------------------------------
  function newMatch() {
    current = new F.FluxEngine(readScenario());
    scene.build(current);
    scene.pause();
    hideAnalysis();
    drawMinimap();
    updateScoreboard(current.snapshot());
    refreshControls();
  }

  function hideAnalysis() {
    $("reportOut").innerHTML =
      '<p class="hint">Run the analysis to generate the optimal-play writeup and rules check.</p>';
    $("downloadReport").disabled = true;
    $("anStatus").textContent = "";
    setBar("anBar", 0);
    window._fluxReport = null;
  }

  function updateScoreboard(snap) {
    const a = snap.cells.A,
      b = snap.cells.B;
    const win = F.CONFIG.match.pocketsToCloseOut;
    $("scoreA").textContent = a.points.toFixed(0);
    $("scoreB").textContent = b.points.toFixed(0);
    $("pocketsA").textContent =
      "● ".repeat(a.pockets) + "○ ".repeat(win - a.pockets);
    $("pocketsB").textContent =
      "● ".repeat(b.pockets) + "○ ".repeat(win - b.pockets);
    $("stratLiveA").textContent = a.strategy;
    $("stratLiveB").textContent = b.strategy;
    if (snap.result) {
      const r = snap.result;
      $("clock").textContent =
        `${r.reason}${r.pyrrhic ? " · pyrrhic!" : ""} · pts ${r.pointsA}–${r.pointsB}`;
    } else {
      $("clock").textContent =
        "step " + snap.step + " · " + snap.time.toFixed(1) + "s";
    }
    refreshControls();
  }

  // ---- Board layout preview --------------------------------------------------
  function drawMinimap() {
    const cv = $("minimap");
    const ctx = cv.getContext("2d");
    const W = cv.width,
      H = cv.height;
    const fw = F.CONFIG.field.width,
      fd = F.CONFIG.field.depth;
    const pad = 10;
    const sx = (W - 2 * pad) / fw,
      sz = (H - 2 * pad) / fd;
    const tx = (x) => W / 2 + x * sx;
    const tz = (z) => H / 2 + z * sz;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#46b14e";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#ffffffaa";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(pad, pad, W - 2 * pad, H - 2 * pad);
    ctx.beginPath();
    ctx.moveTo(W / 2, pad);
    ctx.lineTo(W / 2, H - pad);
    ctx.stroke();
    // A throwaway engine just to read its circle positions for this layout.
    const eng = new F.FluxEngine(readScenario());
    eng.circles.forEach((c) => {
      ctx.beginPath();
      ctx.arc(tx(c.x), tz(c.z), c.r * sx, 0, Math.PI * 2);
      ctx.strokeStyle = "#f4e04d";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tx(c.x), tz(c.z), 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ff7a1a";
      ctx.fill();
    });
  }

  function shuffleBoard() {
    // Deterministic LCG step -> a fresh but reproducible layout (no Math.random).
    layoutSeed = (Math.imul(layoutSeed, 1664525) + 1013904223) >>> 0;
    newMatch();
  }

  // ---- Batch -----------------------------------------------------------------
  async function runBatch() {
    busy = true;
    refreshControls();
    const n = Math.max(1, parseInt($("batchN").value, 10) || 100);
    const out = $("batchOut");
    out.textContent = "Running…";
    await yield_();
    const sc = readScenario();
    const acc = {
      aWins: 0,
      bWins: 0,
      draws: 0,
      pA: 0,
      pB: 0,
      pyr: 0,
      steps: 0,
      closeout: 0,
    };
    let done = 0;
    const chunk = 25;
    while (done < n) {
      const m = Math.min(chunk, n - done);
      for (let i = 0; i < m; i++) {
        const eng = new F.FluxEngine(
          Object.assign({}, sc, {
            seed: F.hashSeed(String(sc.seed)) + done + i,
          }),
        );
        const r = eng.run();
        if (r.winnerCell === "A") acc.aWins++;
        else if (r.winnerCell === "B") acc.bWins++;
        else acc.draws++;
        acc.pA += r.pointsA;
        acc.pB += r.pointsB;
        acc.steps += r.steps;
        if (r.pyrrhic) acc.pyr++;
        if (r.reason === "closeout") acc.closeout++;
      }
      done += m;
      setBar("batchBar", done / n);
      out.textContent = `${done}/${n}…`;
      await yield_();
    }
    out.innerHTML =
      `<b>Red ${pct(acc.aWins / n)}</b> · <b>Blue ${pct(acc.bWins / n)}</b> · Draw ${pct(acc.draws / n)}<br>` +
      `Avg points ${(acc.pA / n).toFixed(1)} – ${(acc.pB / n).toFixed(1)}<br>` +
      `Close-outs ${pct(acc.closeout / n)} · <b>Pyrrhic ${pct(acc.pyr / n)}</b><br>` +
      `Avg length ${(acc.steps / n).toFixed(0)} steps`;
    busy = false;
    refreshControls();
  }

  // ---- Full analysis ---------------------------------------------------------
  async function runAnalysis() {
    busy = true;
    refreshControls();
    const gpc = Math.max(5, parseInt($("anGames").value, 10) || 40);
    const gsGames = Math.max(50, parseInt($("anGsGames").value, 10) || 300);
    const status = $("anStatus");
    const seed = F.hashSeed(String($("seed").value || "flux"));

    status.textContent = "Overall batch…";
    setBar("anBar", 0.05);
    await yield_();
    const batch = F.evaluator.runBatch(
      { seed, strategyA: null, strategyB: null },
      200,
    );

    status.textContent = "Payoff matrix…";
    await yield_();
    const M = await chunkedMatrix(gpc, seed, (p) =>
      setBar("anBar", 0.1 + 0.5 * p),
    );

    status.textContent = "Solving equilibrium…";
    await yield_();
    const eq = F.evaluator.fictitiousPlay(M);
    const brs = F.evaluator.bestResponses(M);
    const dom = F.evaluator.dominantStrategy(M);

    status.textContent = "Game-state values…";
    await yield_();
    const gsv = await chunkedGsv(gsGames, seed, (p) =>
      setBar("anBar", 0.6 + 0.4 * p),
    );

    const report = F.evaluator.makeReport({ batch, M, eq, brs, dom, gsv });
    window._fluxReport = report;
    $("reportOut").innerHTML = mdToHtml(report);
    setBar("anBar", 1);
    status.textContent = "Done.";
    $("downloadReport").disabled = false;
    busy = false;
    refreshControls();
  }

  async function chunkedMatrix(gpc, seed, onP) {
    const N = F.STRATEGY_NAMES.length;
    const M = Array.from({ length: N }, () => new Array(N).fill(0));
    let done = 0;
    const total = N * N;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        let aw = 0;
        for (let g = 0; g < gpc; g++) {
          const eng = new F.FluxEngine({
            seed: seed * 31 + i * 1009 + j * 101 + g,
            strategyA: F.STRATEGY_NAMES[i],
            strategyB: F.STRATEGY_NAMES[j],
          });
          const r = eng.run();
          if (r.winnerCell === "A") aw += 1;
          else if (r.winnerCell === "draw") aw += 0.5;
        }
        M[i][j] = aw / gpc;
        onP(++done / total);
        await yield_();
      }
    }
    return M;
  }

  async function chunkedGsv(games, seed, onP) {
    const table = {};
    const NAMES = F.STRATEGY_NAMES;
    const rec = (bucket, strat, win) => {
      table[bucket] = table[bucket] || {};
      const s = (table[bucket][strat] = table[bucket][strat] || {
        n: 0,
        wins: 0,
      });
      s.n++;
      s.wins += win;
    };
    const eps = 0.35;
    for (let g = 0; g < games; g++) {
      const eng = new F.FluxEngine({ seed: seed * 13 + g * 17 });
      const erng = F.makeRng(seed * 777 + g);
      const visits = { A: [], B: [] };
      eng._chooseStrategies = function () {
        for (const id of ["A", "B"]) {
          let choice = F.autoSelect(this, id);
          if (erng.chance(eps)) choice = erng.pick(NAMES);
          this.cells[id].strategy = choice;
          visits[id].push({
            bucket: F.evaluator.bucketFor(this, id),
            strat: choice,
          });
        }
      };
      const r = eng.run();
      const win = {
        A: r.winnerCell === "A" ? 1 : r.winnerCell === "draw" ? 0.5 : 0,
        B: r.winnerCell === "B" ? 1 : r.winnerCell === "draw" ? 0.5 : 0,
      };
      for (const id of ["A", "B"]) {
        const seen = new Set();
        for (const v of visits[id]) {
          const key = v.bucket + "|" + v.strat;
          if (seen.has(key)) continue;
          seen.add(key);
          rec(v.bucket, v.strat, win[id]);
        }
      }
      if (g % 20 === 0) {
        onP(g / games);
        await yield_();
      }
    }
    const best = {};
    for (const bucket of Object.keys(table)) {
      const rows = Object.entries(table[bucket])
        .map(([strat, s]) => ({ strat, n: s.n, winRate: s.wins / s.n }))
        .filter((r) => r.n >= Math.max(5, games * 0.01))
        .sort((a, b) => b.winRate - a.winRate);
      if (rows.length) best[bucket] = rows;
    }
    onP(1);
    return best;
  }

  // ---- Tiny helpers ----------------------------------------------------------
  function pct(x) {
    return (100 * x).toFixed(0) + "%";
  }
  function setBar(id, x) {
    $(id).style.width = Math.round(100 * x) + "%";
  }

  function download(name, text) {
    const blob = new Blob([text], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function mdToHtml(md) {
    const lines = md.split("\n");
    let html = "",
      i = 0;
    const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    while (i < lines.length) {
      const ln = lines[i];
      if (/^\| /.test(ln)) {
        const rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
        const cells = (r) =>
          r
            .split("|")
            .slice(1, -1)
            .map((c) => c.trim());
        const head = cells(rows[0]);
        const body = rows.slice(2);
        html +=
          "<table><thead><tr>" +
          head.map((h) => "<th>" + inline(h) + "</th>").join("") +
          "</tr></thead><tbody>";
        body.forEach((r) => {
          html +=
            "<tr>" +
            cells(r)
              .map((c) => "<td>" + inline(c) + "</td>")
              .join("") +
            "</tr>";
        });
        html += "</tbody></table>";
        continue;
      }
      if (/^# /.test(ln)) html += "<h2>" + inline(ln.slice(2)) + "</h2>";
      else if (/^## /.test(ln)) html += "<h3>" + inline(ln.slice(3)) + "</h3>";
      else if (/^- /.test(ln)) {
        const items = [];
        while (i < lines.length && /^- /.test(lines[i]))
          items.push("<li>" + inline(lines[i++].slice(2)) + "</li>");
        html += "<ul>" + items.join("") + "</ul>";
        continue;
      } else if (ln.trim() === "") html += "";
      else html += "<p>" + inline(ln) + "</p>";
      i++;
    }
    return html;
  }

  // ---- Boot ------------------------------------------------------------------
  function init() {
    strategyOptions($("stratA"), true);
    strategyOptions($("stratB"), true);
    const cc = $("circleCount");
    [4, 6, 8].forEach((n) => cc.add(new Option(String(n), String(n))));
    cc.value = "6";

    scene = new F.FluxScene($("renderCanvas"));
    scene.onState = updateScoreboard;
    scene.engine.resize();
    newMatch();

    $("newBtn").onclick = newMatch;
    $("playBtn").onclick = () => {
      if (current.result) newMatch();
      if (scene.playing) scene.pause();
      else scene.play();
      refreshControls();
    };
    $("speed").oninput = (e) => {
      scene.setSpeed(parseFloat(e.target.value));
      $("speedVal").textContent = e.target.value + "×";
    };
    $("circleCount").onchange = newMatch;
    $("shuffleBoard").onclick = shuffleBoard;
    $("runBatch").onclick = runBatch;
    $("runAnalysis").onclick = runAnalysis;
    $("downloadReport").onclick = () =>
      download("flux-analysis.md", window._fluxReport || "");
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();

  root.Flux = root.Flux || {};
  root.Flux.initUI = init;
})(typeof self !== "undefined" ? self : this);
