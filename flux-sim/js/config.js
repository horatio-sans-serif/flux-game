// All tunable constants live here. Change these to test whether the sparring
// concept and the "balls are the clock" idea produce sensible play.
(function (root) {
  "use strict";

  const CONFIG = {
    // --- Field geometry (arbitrary world units; renderer scales to taste) ---
    field: { width: 120, depth: 80, margin: 10 },
    circle: {
      count: 6,
      radius: 9,
      minDist: 26,
      standHeight: 7,
      pocketRadius: 3,
    },

    // --- Match rules ---
    match: {
      ballsAtStart: 2,
      pocketsToCloseOut: 3, // a cell closing out ends the game
      stepCap: 1400, // "time rule": hard cap on sim steps -> ends by points
      dt: 0.08, // sim seconds per step
      decisionInterval: 8, // steps between strategy re-selection
      pickupRadius: 2.2,
      sparRange: 3.0, // how close to start a spar
      driveStepsToPocket: 14, // uncontested steps near a stand to pocket
    },

    // --- Movement ---
    move: { baseSpeed: 11 }, // units/sec, multiplied by player's speed stat

    // --- Sparring / velcro-ribbon model ---
    // A spar is a short series of exchanges. Each exchange, a player may "tag"
    // (pull a ribbon). Location is vital / joint / inconsequential.
    spar: {
      durationSteps: 16, // visual length; outcome is precomputed at start
      exchanges: 5,
      jointPoints: 2, // points for a joint ribbon pull
      baseTagChance: 0.55, // base chance to land a tag in an exchange
      // KEY BALANCE LEVER: share of a landed tag that hits a vital ribbon.
      // At ~0.28+ the point-stripping "Aggro" hunt strictly dominates and the
      // ball race becomes irrelevant. At ~0.18 the equilibrium is a real mix of
      // Rush (race the clock) and Aggro (strip points) -- the intended tension.
      baseVitalShare: 0.18,
      surrenderThreshold: -6, // if a player trails this much, they may close-in
      surrenderChance: 0.4,
      interceptRadius: 5.0, // a -sub teammate within this range can intercept
    },

    penalty: {
      durationSteps: 25, // "2 minutes" compressed
      maliciousChance: 0.04, // chance a spar produces a malicious hit -> penalty
    },

    // --- Player attribute model -------------------------------------------
    // Final stat = base 1.0 + post contribution + beat contribution + jitter.
    // Posts shape decision/role tendencies and some physical stats.
    posts: {
      Kova: {
        strike: 0.0,
        defense: 0.1,
        carry: 0.05,
        intercept: 0.1,
        speed: 0.0,
        lead: 0.25,
      },
      Kela: {
        strike: 0.0,
        defense: 0.2,
        carry: 0.0,
        intercept: 0.2,
        speed: 0.0,
        lead: 0.1,
      },
      Kora: {
        strike: 0.1,
        defense: 0.1,
        carry: 0.1,
        intercept: 0.2,
        speed: 0.1,
        lead: 0.05,
      },
      Koda: {
        strike: 0.25,
        defense: 0.25,
        carry: 0.2,
        intercept: 0.0,
        speed: -0.05,
        lead: 0.0,
      },
      Kreva: {
        strike: 0.2,
        defense: 0.0,
        carry: 0.05,
        intercept: 0.05,
        speed: 0.2,
        lead: 0.0,
      },
    },
    // Beats are functional jobs layered on the post.
    beats: {
      van: { speed: 0.3, carry: 0.05 }, // runner
      bin: { carry: 0.3, speed: 0.05 }, // carrier
      lid: { defense: 0.3 }, // defender
      jab: { strike: 0.3 }, // striker
      sub: { intercept: 0.35 }, // interceptor
    },
    statJitterSd: 0.06,

    // Roster: one of each post; coach assigns beats independently.
    roster: [
      { post: "Kova", beat: "sub" },
      { post: "Kela", beat: "lid" },
      { post: "Kora", beat: "van" },
      { post: "Koda", beat: "jab" },
      { post: "Kreva", beat: "bin" },
    ],
  };

  root.Flux = root.Flux || {};
  root.Flux.CONFIG = CONFIG;
})(typeof self !== "undefined" ? self : this);
