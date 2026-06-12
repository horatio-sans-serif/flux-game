// FluxEngine: a pure, deterministic simulation of a Flux match.
//
// No DOM, no Babylon, no Math.random -- everything flows from a seeded RNG so a
// given (seed, scenario) always produces the identical match. That is what makes
// headless batch runs and game-theory analysis possible: the same code that the
// 3D view plays back can be run thousands of times with no rendering.
(function (root) {
  "use strict";

  const C = root.Flux.CONFIG;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  // ---- Attribute model -------------------------------------------------------
  function buildStats(post, beat, rng) {
    const base = {
      speed: 1,
      strike: 1,
      defense: 1,
      carry: 1,
      intercept: 1,
      lead: 0,
    };
    const p = C.posts[post] || {};
    const b = C.beats[beat] || {};
    const out = {};
    for (const k of Object.keys(base)) {
      out[k] =
        base[k] + (p[k] || 0) + (b[k] || 0) + rng.gauss(0, C.statJitterSd);
      if (k !== "lead") out[k] = clamp(out[k], 0.5, 1.8);
    }
    return out;
  }

  // ---- Engine ----------------------------------------------------------------
  function FluxEngine(opts) {
    opts = opts || {};
    this.rng = root.Flux.makeRng(opts.seed != null ? opts.seed : 12345);
    // null strategy => auto-selected from game state each decision tick.
    this.forced = { A: opts.strategyA || null, B: opts.strategyB || null };
    this.opts = opts;
    // Board layout is independent of the match RNG so a chosen layout stays
    // fixed while seeds/strategies vary (and can be previewed before play).
    this.circleCount = opts.circleCount || C.circle.count;
    this.layoutSeed =
      opts.layoutSeed != null
        ? opts.layoutSeed
        : opts.seed != null
          ? opts.seed
          : 12345;
    this.events = []; // light log for the renderer (spars, pockets, KOs)
    this._init();
  }

  FluxEngine.prototype._init = function () {
    const rng = this.rng;
    this.step = 0;
    this.time = 0;
    this.result = null;
    this.circles = this._makeCircles();
    this.cells = {
      A: this._makeCell("A", -1),
      B: this._makeCell("B", 1),
    };
    this.balls = [];
    for (let i = 0; i < C.match.ballsAtStart; i++) this._spawnBall();
  };

  // Symmetric circle layout: place half in the left field and mirror across
  // x = 0, so neither cell gets a geometric advantage (important for fair
  // strategy comparison in the evaluator).
  FluxEngine.prototype._makeCircles = function () {
    const { width, depth, margin } = C.field;
    const count = this.circleCount;
    const half = Math.floor(count / 2);
    // Try to honor the minimum distance; relax it if the count won't fit.
    let left = [];
    let minDist = C.circle.minDist;
    for (let attempt = 0; attempt < 6 && left.length < half; attempt++) {
      left = [];
      const rng = root.Flux.makeRng(
        (this.layoutSeed >>> 0) + attempt * 1013 + count * 7,
      );
      let guard = 0;
      while (left.length < half && guard++ < 4000) {
        const x = rng.range(-width / 2 + margin, -margin);
        const z = rng.range(-depth / 2 + margin, depth / 2 - margin);
        const cand = { x, z };
        if (left.every((c) => dist(c, cand) >= minDist)) left.push(cand);
      }
      minDist *= 0.8; // ease the constraint for the next attempt if needed
    }
    const circles = [];
    left.forEach((c, i) => {
      circles.push({ id: i, x: c.x, z: c.z, r: C.circle.radius });
      circles.push({ id: i + half, x: -c.x, z: c.z, r: C.circle.radius });
    });
    if (count % 2 === 1)
      circles.push({ id: circles.length, x: 0, z: 0, r: C.circle.radius });
    // The basket hangs off the pole on an arm pointing toward field center, so
    // the pole never passes through the net and there is an open side to shoot
    // from. (bx,bz) is the basket's ground position; (adx,adz) the arm direction.
    circles.forEach((c) => {
      let dx = -c.x,
        dz = -c.z;
      let L = Math.hypot(dx, dz);
      if (L < 1e-3) {
        dx = 0;
        dz = 1;
        L = 1;
      }
      c.adx = dx / L;
      c.adz = dz / L;
      c.bx = c.x + c.adx * C.circle.basketArm;
      c.bz = c.z + c.adz * C.circle.basketArm;
    });
    return circles;
  };

  FluxEngine.prototype.circleById = function (id) {
    return this.circles.find((c) => c.id === id) || null;
  };

  FluxEngine.prototype._makeCell = function (id, side) {
    const rng = this.rng;
    const startX = side * (C.field.width / 2 - C.field.margin);
    const players = C.roster.map((r, i) => {
      const z = (i - (C.roster.length - 1) / 2) * 7;
      return {
        id: id + i,
        cell: id,
        post: r.post,
        beat: r.beat,
        name: r.post,
        stats: buildStats(r.post, r.beat, rng),
        pos: { x: startX, z },
        target: { x: 0, z },
        role: "SEEK",
        ballId: null,
        sparPoints: 0,
        driveProgress: 0,
        state: "active", // active | sparring | penalty | sideline
        timer: 0,
        sparWith: null,
        sparOutcome: null,
        holding: false, // carrying but deliberately not closing out (behind on pts)
      };
    });
    return {
      id,
      side,
      pockets: 0,
      points: 0,
      strategy: this.forced[id] || "Balanced",
      players,
    };
  };

  FluxEngine.prototype._spawnBall = function () {
    const rng = this.rng;
    this.balls.push({
      id: this.balls.length,
      pos: { x: rng.range(-2, 2), z: rng.range(-2, 2) },
      state: "loose", // loose | carried | pocketed
      carrier: null,
    });
  };

  // ---- Geometry helpers ------------------------------------------------------
  FluxEngine.prototype.circleAt = function (pos) {
    for (const c of this.circles) if (dist(c, pos) <= c.r) return c;
    return null;
  };
  FluxEngine.prototype.other = function (id) {
    return id === "A" ? "B" : "A";
  };
  FluxEngine.prototype.playerById = function (pid) {
    for (const k of ["A", "B"]) {
      const p = this.cells[k].players.find((x) => x.id === pid);
      if (p) return p;
    }
    return null;
  };
  FluxEngine.prototype.activeCount = function (id) {
    return this.cells[id].players.filter(
      (p) => p.state === "active" || p.state === "sparring",
    ).length;
  };

  // ---- Strategy + role assignment -------------------------------------------
  FluxEngine.prototype._chooseStrategies = function () {
    for (const id of ["A", "B"]) {
      this.cells[id].strategy =
        this.forced[id] || root.Flux.autoSelect(this, id);
    }
  };

  FluxEngine.prototype._assignRoles = function (id) {
    const cell = this.cells[id];
    const strat =
      root.Flux.STRATEGIES[cell.strategy] || root.Flux.STRATEGIES.Balanced;
    const enemies = this.cells[this.other(id)].players;
    const looseBalls = this.balls.filter((b) => b.state === "loose");

    const avail = cell.players.filter((p) => p.state === "active");
    // Carriers always carry (unless deliberately holding short of close-out).
    const carriers = avail.filter((p) => p.ballId != null);
    const free = avail.filter((p) => p.ballId == null);

    const nDef = Math.round(strat.weights.defend * free.length);
    const nHunt = Math.round(strat.weights.hunt * free.length);

    // Suitability sort: best defenders defend, best fighters hunt, fastest seek.
    const byDef = [...free].sort((a, b) => b.stats.defense - a.stats.defense);
    const defenders = byDef.slice(0, nDef);
    const rest = byDef.slice(nDef);
    const byStrike = [...rest].sort(
      (a, b) =>
        b.stats.strike + b.stats.speed - (a.stats.strike + a.stats.speed),
    );
    const hunters = byStrike.slice(0, nHunt);
    const seekers = byStrike.slice(nHunt);

    carriers.forEach((p) => this._setCarry(p, id));
    defenders.forEach((p, i) => this._setDefend(p, i));
    hunters.forEach((p) => this._setHunt(p, enemies, strat));
    seekers.forEach((p) => this._setSeek(p, looseBalls));
  };

  FluxEngine.prototype._setSeek = function (p, looseBalls) {
    p.role = "SEEK";
    if (looseBalls.length) {
      let best = null,
        bd = Infinity;
      for (const b of looseBalls) {
        const d = dist(p.pos, b.pos);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      p.target = { x: best.pos.x, z: best.pos.z };
    } else {
      p.target = { x: 0, z: p.pos.z }; // hover near center for the next ball
    }
  };

  FluxEngine.prototype._setCarry = function (p, id) {
    p.role = "CARRY";
    // Pick the best basket: nearest, penalized by enemies guarding it.
    let best = null,
      bs = Infinity;
    for (const c of this.circles) {
      const enemyNear = this.cells[this.other(id)].players.filter(
        (e) =>
          e.state !== "sideline" &&
          Math.hypot(e.pos.x - c.bx, e.pos.z - c.bz) <= C.match.blockRadius,
      ).length;
      const s = Math.hypot(p.pos.x - c.bx, p.pos.z - c.bz) + enemyNear * 14;
      if (s < bs) {
        bs = s;
        best = c;
      }
    }
    p.targetCircleId = best.id;
    // Aim at a shooting spot offset from the pole along the arm (off the pole).
    p.target = {
      x: best.x + best.adx * C.match.shootStandoff,
      z: best.z + best.adz * C.match.shootStandoff,
    };
  };

  FluxEngine.prototype._setDefend = function (p, i) {
    p.role = "DEFEND";
    // Defend a basket: crowd one threatened by an enemy carrier, else spread.
    let target = null;
    let bd = Infinity;
    for (const b of this.balls) {
      if (b.state !== "carried") continue;
      const carrier = this.playerById(b.carrier);
      if (!carrier || carrier.cell === p.cell) continue;
      const c =
        (carrier.targetCircleId != null &&
          this.circleById(carrier.targetCircleId)) ||
        this._nearestCircleByBasket(carrier.pos);
      if (!c) continue;
      const d = dist(p.pos, { x: c.bx, z: c.bz });
      if (d < bd) {
        bd = d;
        target = c;
      }
    }
    if (!target) target = this.circles[i % this.circles.length];
    // Stand at the basket to block shots (the open shooting lane).
    p.target = { x: target.bx, z: target.bz };
  };

  FluxEngine.prototype._nearestCircleByBasket = function (pos) {
    let best = null,
      bd = Infinity;
    for (const c of this.circles) {
      const d = Math.hypot(pos.x - c.bx, pos.z - c.bz);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  };

  FluxEngine.prototype._setHunt = function (p, enemies, strat) {
    p.role = "HUNT";
    // Prefer enemy carriers; with Aggro, prefer enemies holding the most points.
    const targets = enemies.filter(
      (e) => e.state === "active" || e.state === "sparring",
    );
    if (!targets.length) {
      p.target = { x: 0, z: p.pos.z };
      return;
    }
    let best = null,
      bs = -Infinity;
    for (const e of targets) {
      let score = -dist(p.pos, e.pos) * 0.1;
      if (e.ballId != null) score += 8;
      if (strat.huntHighScorers) score += e.sparPoints * 0.5;
      if (score > bs) {
        bs = score;
        best = e;
      }
    }
    p.target = { x: best.pos.x, z: best.pos.z };
    p._huntTarget = best.id;
  };

  // ---- Movement --------------------------------------------------------------
  FluxEngine.prototype._move = function (p) {
    if (p.state !== "active") return;
    const sp = C.move.baseSpeed * p.stats.speed * C.match.dt;
    const dx = p.target.x - p.pos.x;
    const dz = p.target.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-3) {
      const m = Math.min(sp, d);
      p.pos.x += (dx / d) * m;
      p.pos.z += (dz / d) * m;
    }
    const hx = C.field.width / 2,
      hz = C.field.depth / 2;
    p.pos.x = clamp(p.pos.x, -hx, hx);
    p.pos.z = clamp(p.pos.z, -hz, hz);
    // Carried ball follows its carrier.
    if (p.ballId != null) {
      const b = this.balls[p.ballId];
      if (b) {
        b.pos.x = p.pos.x;
        b.pos.z = p.pos.z;
      }
    }
  };

  // ---- Ball pickup -----------------------------------------------------------
  FluxEngine.prototype._pickups = function () {
    for (const b of this.balls) {
      if (b.state !== "loose") continue;
      let best = null,
        bd = C.match.pickupRadius;
      for (const id of ["A", "B"]) {
        for (const p of this.cells[id].players) {
          if (p.state !== "active" || p.ballId != null) continue;
          const d = dist(p.pos, b.pos);
          if (d <= bd) {
            bd = d;
            best = p;
          }
        }
      }
      if (best) {
        b.state = "carried";
        b.carrier = best.id;
        best.ballId = b.id;
        best.holding = false;
        best.shotCharge = 0;
      }
    }
  };

  // ---- Player collision: nobody passes through anyone else -------------------
  // A simple positional separation pass. Active players get pushed out of any
  // overlap; an active player overlapping a stationary one (sparring/penalty)
  // is pushed the whole way so it can't stand inside them.
  FluxEngine.prototype._separate = function () {
    const minSep = C.move.playerRadius * 2;
    const all = [];
    for (const id of ["A", "B"])
      for (const p of this.cells[id].players)
        if (p.state !== "sideline") all.push(p);
    // A few relaxation passes so clusters fully resolve, not just neighbours.
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i],
            b = all[j];
          const aMov = a.state === "active";
          const bMov = b.state === "active";
          if (!aMov && !bMov) continue;
          let dx = a.pos.x - b.pos.x;
          let dz = a.pos.z - b.pos.z;
          let d = Math.hypot(dx, dz);
          if (d >= minSep) continue;
          if (d < 1e-4) {
            dx = ((i * 7 + j) % 2 ? 1 : -1) * 0.01;
            dz = 0.01;
            d = Math.hypot(dx, dz);
          }
          const overlap = minSep - d;
          const nx = dx / d,
            nz = dz / d;
          const aShare = aMov && bMov ? 0.5 : aMov ? 1 : 0;
          const bShare = aMov && bMov ? 0.5 : bMov ? 1 : 0;
          a.pos.x += nx * overlap * aShare;
          a.pos.z += nz * overlap * aShare;
          b.pos.x -= nx * overlap * bShare;
          b.pos.z -= nz * overlap * bShare;
          moved = true;
        }
      }
      if (!moved) break;
    }
    const hx = C.field.width / 2,
      hz = C.field.depth / 2;
    for (const p of all) {
      p.pos.x = clamp(p.pos.x, -hx, hx);
      p.pos.z = clamp(p.pos.z, -hz, hz);
      if (p.ballId != null) {
        const ball = this.balls[p.ballId];
        if (ball) {
          ball.pos.x = p.pos.x;
          ball.pos.z = p.pos.z;
        }
      }
    }
  };

  // ---- Sparring (velcro-ribbon model) ---------------------------------------
  // tagChance / vitalShare scale with the attacker's offense vs the defender's
  // defense. A landed tag is a ribbon pull; a vital pull ends the spar.
  FluxEngine.prototype._tagChance = function (off, def) {
    return clamp(C.spar.baseTagChance * ((2 * off) / (off + def)), 0.05, 0.95);
  };
  FluxEngine.prototype._vitalShare = function (off, def) {
    return clamp(C.spar.baseVitalShare * ((2 * off) / (off + def)), 0.02, 0.7);
  };

  // Precompute the full outcome of a spar at the moment it starts. The visual
  // timer only delays *applying* it, so headless and watched runs are identical.
  FluxEngine.prototype._resolveSpar = function (a, b) {
    const rng = this.rng;
    let pa = 0,
      pb = 0,
      winner = null,
      vital = false,
      surrender = null;
    const pairs = [
      [a, b, "a"],
      [b, a, "b"],
    ];
    for (let k = 0; k < C.spar.exchanges && !winner; k++) {
      for (const [att, def, who] of pairs) {
        if (winner) break;
        if (rng.chance(this._tagChance(att.stats.strike, def.stats.defense))) {
          if (
            rng.chance(this._vitalShare(att.stats.strike, def.stats.defense))
          ) {
            winner = who;
            vital = true;
            break;
          } else {
            if (who === "a") pa += C.spar.jointPoints;
            else pb += C.spar.jointPoints;
          }
        }
      }
      if (winner) break;
      // The trailing fighter may "close in" (surrender) rather than risk a vital.
      if (
        pa - pb <= C.spar.surrenderThreshold &&
        rng.chance(C.spar.surrenderChance)
      ) {
        winner = "b";
        surrender = "a";
        break;
      }
      if (
        pb - pa <= C.spar.surrenderThreshold &&
        rng.chance(C.spar.surrenderChance)
      ) {
        winner = "a";
        surrender = "b";
        break;
      }
    }
    if (!winner) winner = pa > pb ? "a" : pb > pa ? "b" : null; // points decide
    const malicious = rng.chance(C.penalty.maliciousChance)
      ? rng.chance(0.5)
        ? "a"
        : "b"
      : null;
    return { pa, pb, winner, vital, surrender, malicious };
  };

  FluxEngine.prototype._maybeIntercept = function (target) {
    // A -sub / high-intercept teammate within range may step in for `target`.
    const mates = this.cells[target.cell].players.filter(
      (m) =>
        m !== target &&
        m.state === "active" &&
        dist(m.pos, target.pos) <= C.spar.interceptRadius,
    );
    if (!mates.length) return target;
    mates.sort((a, b) => b.stats.intercept - a.stats.intercept);
    const sub = mates[0];
    const p = clamp(0.4 + (sub.stats.intercept - 1) * 0.6, 0.1, 0.9);
    if (this.rng.chance(p)) {
      this.events.push({
        t: this.step,
        type: "intercept",
        who: sub.id,
        for: target.id,
      });
      return sub;
    }
    return target;
  };

  FluxEngine.prototype._startSpar = function (att, defRaw, context) {
    const def = this._maybeIntercept(defRaw);
    if (att.state !== "active" || def.state !== "active") return;
    const outcome = this._resolveSpar(att, def);
    for (const [pl, side] of [
      [att, "att"],
      [def, "def"],
    ]) {
      pl.state = "sparring";
      pl.timer = C.spar.durationSteps;
      pl.sparWith = side === "att" ? def.id : att.id;
      pl.sparOutcome = outcome;
      pl._sparSide = side === "att" ? "a" : "b";
      pl._sparContext = context;
      pl._sparPartner = side === "att" ? def : att;
    }
    // Open-field spar: a carrier drops the ball immediately and it freezes.
    if (context === "open") {
      for (const pl of [att, def])
        if (pl.ballId != null) this._dropBall(pl, false);
    }
    this.events.push({
      t: this.step,
      type: "spar",
      a: att.id,
      b: def.id,
      context,
    });
  };

  FluxEngine.prototype._dropBall = function (p, toCenter) {
    if (p.ballId == null) return;
    const b = this.balls[p.ballId];
    p.ballId = null;
    p.shotCharge = 0;
    if (!b) return;
    b.state = "loose";
    b.carrier = null;
    if (toCenter) {
      b.pos = { x: this.rng.range(-2, 2), z: this.rng.range(-2, 2) };
      this.events.push({ t: this.step, type: "ko", ball: b.id });
    }
  };

  FluxEngine.prototype._applySparOutcome = function (p) {
    // Only the attacker side applies, to avoid double-counting.
    if (p._sparSide !== "a") {
      p.state = "active";
      p.sparWith = null;
      return;
    }
    const a = p;
    const b = p._sparPartner;
    const o = p.sparOutcome;
    // Joint ribbon pulls score for the puller's cell (and personal tally).
    this.cells[a.cell].points += o.pa;
    a.sparPoints += o.pa;
    this.cells[b.cell].points += o.pb;
    b.sparPoints += o.pb;

    const winner = o.winner === "a" ? a : o.winner === "b" ? b : null;
    const loser = winner ? (winner === a ? b : a) : null;

    if (o.vital && loser) {
      // Vital pull ends the spar; the loser's accumulated points are stripped
      // from their cell and do NOT transfer to the winner.
      this.cells[loser.cell].points -= loser.sparPoints;
      loser.sparPoints = 0;
      this.events.push({
        t: this.step,
        type: "vital",
        winner: winner.id,
        loser: loser.id,
      });
    }

    // Circle context: losing the spar means losing the circle -> ball KO'd.
    if (p._sparContext === "circle" && loser && loser.ballId != null) {
      this._dropBall(loser, true);
    }

    // Penalty for a malicious hit.
    if (o.malicious) {
      const guilty = o.malicious === "a" ? a : b;
      guilty.state = "penalty";
      guilty.timer = C.penalty.durationSteps;
      guilty.sparWith = null;
      this.events.push({ t: this.step, type: "penalty", who: guilty.id });
    }

    for (const pl of [a, b]) {
      if (pl.state === "sparring") {
        pl.state = "active";
        pl.sparWith = null;
      }
      pl.sparOutcome = null;
      pl._sparPartner = null;
    }
  };

  FluxEngine.prototype._tryStartSpars = function () {
    // Open-field hunts.
    for (const id of ["A", "B"]) {
      for (const p of this.cells[id].players) {
        if (p.state !== "active" || p.role !== "HUNT") continue;
        const enemies = this.cells[this.other(id)].players;
        let target = null,
          bd = C.match.sparRange;
        for (const e of enemies) {
          if (e.state !== "active") continue;
          const d = dist(p.pos, e.pos);
          if (d <= bd) {
            bd = d;
            target = e;
          }
        }
        if (target) {
          const ctx =
            this.circleAt(p.pos) || this.circleAt(target.pos)
              ? "circle"
              : "open";
          this._startSpar(p, target, ctx);
        }
      }
    }
    // Circle challenges: an enemy inside a circle near a friendly carrier/defender.
    for (const c of this.circles) {
      const inside = [];
      for (const id of ["A", "B"])
        for (const p of this.cells[id].players)
          if (p.state === "active" && dist(p.pos, c) <= c.r) inside.push(p);
      const A = inside.filter((p) => p.cell === "A");
      const B = inside.filter((p) => p.cell === "B");
      if (A.length && B.length) {
        // Pair the closest cross-cell, prefer one being a carrier.
        let best = null,
          bd = Infinity;
        for (const a of A)
          for (const b of B) {
            if (a.state !== "active" || b.state !== "active") continue;
            const d =
              dist(a.pos, b.pos) -
              (a.ballId != null || b.ballId != null ? 4 : 0);
            if (d < bd) {
              bd = d;
              best = [a, b];
            }
          }
        if (best && dist(best[0].pos, best[1].pos) <= c.r) {
          const attacker = best[0].ballId == null ? best[0] : best[1];
          const defender = attacker === best[0] ? best[1] : best[0];
          this._startSpar(attacker, defender, "circle");
        }
      }
    }
  };

  // ---- Pocketing: charge a shot from standoff range, then shoot --------------
  FluxEngine.prototype._pocketing = function () {
    for (const id of ["A", "B"]) {
      const cell = this.cells[id];
      const them = this.cells[this.other(id)];
      for (const p of cell.players) {
        if (p.ballId == null || p.state !== "active") continue;
        const c =
          (p.targetCircleId != null && this.circleById(p.targetCircleId)) ||
          this._nearestCircleByBasket(p.pos);
        if (!c) continue;
        const dB = Math.hypot(p.pos.x - c.bx, p.pos.z - c.bz);
        if (dB > C.match.shootRange) {
          p.shotCharge = Math.max(0, (p.shotCharge || 0) - 1);
          continue;
        }
        // Would a successful shot close out the game while behind on points?
        const wouldCloseOut = cell.pockets + 1 >= C.match.pocketsToCloseOut;
        const behind = cell.points < them.points;
        const strat = root.Flux.STRATEGIES[cell.strategy];
        if (wouldCloseOut && behind && strat.holdAt2IfBehind) {
          p.holding = true;
          p.role = "DEFEND";
          p.shotCharge = 0;
          continue;
        }
        p.shotCharge = (p.shotCharge || 0) + 1;
        if (p.shotCharge >= C.match.shotChargeSteps) {
          p.shotCharge = 0;
          this._takeShot(p, cell, them, c);
        }
      }
    }
  };

  FluxEngine.prototype._takeShot = function (p, cell, them, c) {
    // Opponents crowding the basket lower the odds; a miss is knocked back to
    // center (matches "knocked-back balls chucked to center").
    const blockers = them.players.filter(
      (e) =>
        e.state === "active" &&
        Math.hypot(e.pos.x - c.bx, e.pos.z - c.bz) <= C.match.blockRadius,
    ).length;
    const prob = clamp(
      C.match.baseShotChance * p.stats.carry - blockers * C.match.blockPenalty,
      0.03,
      0.95,
    );
    if (this.rng.chance(prob)) {
      this._pocket(p, cell, c);
    } else {
      this.events.push({ t: this.step, type: "miss", by: p.id, blockers });
      this._dropBall(p, true); // knocked back to center
    }
  };

  FluxEngine.prototype._pocket = function (p, cell, c) {
    const b = this.balls[p.ballId];
    if (b) {
      b.state = "pocketed";
      b.carrier = null;
      // Remember which basket it went into so the renderer can animate the arc.
      if (c) b.basket = { x: c.bx, z: c.bz };
    }
    p.ballId = null;
    p.shotCharge = 0;
    cell.pockets += 1;
    this.events.push({ t: this.step, type: "pocket", cell: cell.id, by: p.id });
    this._spawnBall();
    if (cell.pockets >= C.match.pocketsToCloseOut)
      this._finish("closeout", cell.id);
  };

  // ---- Timers ----------------------------------------------------------------
  FluxEngine.prototype._timers = function () {
    for (const id of ["A", "B"]) {
      for (const p of this.cells[id].players) {
        if (p.state === "sparring") {
          p.timer -= 1;
          if (p.timer <= 0) this._applySparOutcome(p);
        } else if (p.state === "penalty") {
          p.timer -= 1;
          if (p.timer <= 0) p.state = "active";
        } else if (p.state === "sideline") {
          p.timer -= 1;
          if (p.timer <= 0) p.state = "active";
        }
      }
    }
  };

  // ---- Main step -------------------------------------------------------------
  FluxEngine.prototype.step1 = function () {
    if (this.result) return this.result;
    if (this.step % C.match.decisionInterval === 0) {
      this._chooseStrategies();
      this._assignRoles("A");
      this._assignRoles("B");
    }
    for (const id of ["A", "B"])
      for (const p of this.cells[id].players) this._move(p);
    this._separate(); // players can't pass through each other
    this._pickups();
    this._tryStartSpars();
    this._pocketing();
    this._timers();

    this.step += 1;
    this.time += C.match.dt;
    if (!this.result && this.step >= C.match.stepCap)
      this._finish("timerule", null);
    return this.result;
  };

  FluxEngine.prototype._finish = function (reason, closedBy) {
    const a = this.cells.A.points,
      b = this.cells.B.points;
    const winnerCell = a > b ? "A" : b > a ? "B" : "draw";
    this.result = {
      reason,
      closedBy,
      winnerCell,
      pointsA: a,
      pointsB: b,
      pocketsA: this.cells.A.pockets,
      pocketsB: this.cells.B.pockets,
      steps: this.step,
      // True when a cell ended the game but LOST on points -- a key rules signal.
      pyrrhic: closedBy && winnerCell !== "draw" && winnerCell !== closedBy,
    };
  };

  // Run headless to completion. Used by the evaluator at high speed.
  FluxEngine.prototype.run = function () {
    while (!this.result) this.step1();
    return this.result;
  };

  // ---- Snapshot for the renderer --------------------------------------------
  FluxEngine.prototype.snapshot = function () {
    return {
      step: this.step,
      time: this.time,
      result: this.result,
      circles: this.circles,
      balls: this.balls.map((b) => ({
        id: b.id,
        x: b.pos.x,
        z: b.pos.z,
        state: b.state,
        basket: b.basket || null,
      })),
      cells: {
        A: this._cellSnap("A"),
        B: this._cellSnap("B"),
      },
    };
  };
  FluxEngine.prototype._cellSnap = function (id) {
    const c = this.cells[id];
    return {
      id,
      strategy: c.strategy,
      points: c.points,
      pockets: c.pockets,
      players: c.players.map((p) => ({
        id: p.id,
        name: p.name,
        beat: p.beat,
        role: p.role,
        state: p.state,
        x: p.pos.x,
        z: p.pos.z,
        hasBall: p.ballId != null,
        sparPoints: p.sparPoints,
      })),
    };
  };

  root.Flux = root.Flux || {};
  root.Flux.FluxEngine = FluxEngine;
})(typeof self !== "undefined" ? self : this);
