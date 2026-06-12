// Strategies are declarative: they describe how a cell allocates its players
// between chasing balls, defending stands, and hunting spars, plus a few
// behavior flags. The engine turns these into concrete targets each tick.
//
// The same definitions are used two ways:
//   1. Live: the auto-selector picks a strategy from the current game state.
//   2. Evaluator: a strategy is *forced* on a cell to fill a payoff matrix.
(function (root) {
  "use strict";

  const STRATEGIES = {
    Rush: {
      desc: "Grab balls and pocket fast. Win on the clock before points matter.",
      weights: { ball: 0.7, defend: 0.1, hunt: 0.2 },
    },
    Control: {
      desc: "Occupy circles, keep possession, grind a points lead.",
      weights: { ball: 0.4, defend: 0.35, hunt: 0.25 },
    },
    Aggro: {
      desc: "Hunt spars to strip opponent points. Target high scorers.",
      weights: { ball: 0.3, defend: 0.1, hunt: 0.6 },
      huntHighScorers: true,
    },
    Contain: {
      desc: "Defend stands, deny the opponent's close-out, protect a lead.",
      weights: { ball: 0.25, defend: 0.6, hunt: 0.15 },
    },
    Balanced: {
      desc: "Even split across balls, defense, and spars.",
      weights: { ball: 0.45, defend: 0.3, hunt: 0.25 },
    },
  };

  // Every strategy respects the same end-game rule: do not pocket your own
  // 3rd ball (close out the game) while you are behind on points -- ending the
  // game would hand the win to the opponent. This is enforced in the engine.
  Object.values(STRATEGIES).forEach((s) => (s.holdAt2IfBehind = true));

  const STRATEGY_NAMES = Object.keys(STRATEGIES);

  // Auto-selection: choose a strategy from the live game state. This encodes the
  // central insight of Flux -- the ball race is the clock, points are the score,
  // so timing matters more than speed.
  function autoSelect(state, cellId) {
    const me = state.cells[cellId];
    const them = state.cells[cellId === "A" ? "B" : "A"];
    const pointDiff = me.points - them.points;
    const win = root.Flux.CONFIG.match.pocketsToCloseOut;

    // Far ahead on points and one ball from the end -> slam the door.
    if (pointDiff > 6 && me.pockets >= win - 1) return "Rush";
    // Ahead on points -> keep racing, the clock favors you.
    if (pointDiff > 6) return "Rush";
    // Behind on points and they are one pocket from ending it -> deny it.
    if (pointDiff < -6 && them.pockets >= win - 1) return "Contain";
    // Behind on points with time left -> claw points back.
    if (pointDiff < -3) return "Aggro";
    // Roughly even -> control the field and build an edge.
    if (Math.abs(pointDiff) <= 3) return "Control";
    return "Balanced";
  }

  root.Flux = root.Flux || {};
  root.Flux.STRATEGIES = STRATEGIES;
  root.Flux.STRATEGY_NAMES = STRATEGY_NAMES;
  root.Flux.autoSelect = autoSelect;
})(typeof self !== "undefined" ? self : this);
