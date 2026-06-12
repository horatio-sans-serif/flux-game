# Flux Simulator

A Babylon.js simulation of the game of Flux. It watches matches in 3D, runs fast
headless batches, and does game-theory analysis to surface the optimal way to
play — and any holes in the rules.

## Run it

Open `index.html`. It works straight from disk (double-click) — the only network
dependency is Babylon.js from CDN. If your browser blocks local files, serve it:

```bash
cd flux-sim
python3 -m http.server 8000
# then open http://localhost:8000
```

## What you can do

- **Watch a match.** Pick a seed and a plan for each team (or leave them on
  **Auto**, where each team picks its plan from the live game state). Press Play.
  Players are ellipsoids (Red / Blue) with floating post labels (Kova, Kela,
  Kora, Koda, Kreva). A `●` before a name means that player is carrying a ball.
- **Fast batch.** Run e.g. 100 games with no rendering and get win rates,
  average points, close-out vs. time-rule rate, and the pyrrhic-close-out rate.
- **Game-theory analysis.** Builds the full strategy-vs-strategy payoff matrix,
  solves it for the equilibrium mix, computes the best technique for each game
  state, flags possible rules holes, and writes it all up. Download as Markdown.

See `SAMPLE-ANALYSIS.md` for a generated example report.

## Architecture

The decision logic is a **pure, deterministic engine** with no rendering and no
`Math.random` — everything flows from a seeded RNG. That is the central design
choice: the same code runs the 3D playback _and_ thousands of headless games for
analysis, and any (seed, scenario) reproduces exactly.

| File               | Role                                                           |
| ------------------ | -------------------------------------------------------------- |
| `js/rng.js`        | Seeded RNG (mulberry32) + string-seed hashing.                 |
| `js/config.js`     | All tunable constants — field, stats, sparring model.          |
| `js/strategies.js` | Strategy definitions + the live auto-selector.                 |
| `js/engine.js`     | The deterministic match simulation.                            |
| `js/evaluator.js`  | Batch, payoff matrix, fictitious-play solver, report.          |
| `js/scene.js`      | Babylon renderer; advances the engine and interpolates meshes. |
| `js/ui.js`         | DOM wiring; chunked batch/analysis with progress.              |

Real rigid-body physics was deliberately _not_ used for gameplay: it would make
the 100-iteration batches noisy and slow, defeating the analysis goal. Gameplay
is deterministic-kinematic; Babylon adds the visual polish (soft shadows,
interpolation, the bright Wii-Sports look).

## How the rules were modeled (and the interpretations made)

The rulebook leaves some things open. The engine commits to one coherent reading
of each; these are the spots worth a second look:

- **"Hold ball inside a circle" vs. carrying it to a stand.** Modeled as: you can
  pick up and carry a ball anywhere, but it is only _safe_ inside a circle —
  being sparred in the open field makes you drop it (matches "ball drops and
  freezes if carrier is sparred on open field").
- **"Relay — passing" vs. "no passing".** The engine does not pass balls between
  players; relay is left out until the rule is clarified.
- **Sparring scoring.** "Vitals high, joints low" but "vital points don't transfer
  to winner." Modeled as: joint pulls score small points for the puller's cell;
  a **vital pull ends the spar and strips the loser's accumulated points** (not
  transferred). This makes a high scorer a target — an emergent, testable effect.
- **The clock vs. the score.** A cell closes out by pocketing 3 balls, but wins on
  points. The engine enforces the natural consequence: **a cell behind on points
  will not pocket its 3rd ball** (doing so would hand the opponent the win), so it
  stalls at two and hunts points.
- **Pocketing is a contested shot.** The basket hangs off the pole on an arm. A
  carrier moves to a standoff spot and shoots toward the basket; opponents
  crowding the basket lower the success odds, and a **missed/blocked shot is
  knocked back to center** (matching "knocked-back balls chucked to center").
  Defenders position at the threatened basket to block.
- **Players collide.** A separation pass keeps players from passing through each
  other, so crowding a basket or a ball carrier physically matters.

## Findings (default tuning)

- **The sparring concept works, but spar-hunting is strong.** `baseVitalShare`
  in `config.js` is the key balance lever. Around 0.28+, the point-stripping hunt
  ("Aggro") strictly dominates and the ball race becomes irrelevant — the
  analyzer flags this. Even at the shipped **0.18**, Aggro is the strongest
  _whole-game commitment_, so the analyzer reports a "thin whole-game strategy
  space." Push toward ~0.13 to pull **Rush** (racing the clock) into a real mixed
  equilibrium. Importantly, the **per-game-state** guidance stays varied across
  this whole range — what to do changes with the situation (Contain when ahead
  and even on balls, Rush when even and ball-leading, etc.) even when one plan
  wins on average. The takeaway: her two-games-at-once idea is sound; the ribbon
  game just needs vital pulls kept relatively rare so it doesn't swamp the ball
  race.
- **The "balls are the clock" rule creates a stalling incentive.** Because ending
  the game while behind loses, a trailing team wants to hold at two pockets. The
  engine models this; if you raise vital frequency you also start to see
  "pyrrhic close-outs" (a team ends the game and loses), which the report tracks
  as a rules signal. Consider a rule that discourages indefinite stalling.

## Tuning

Everything is in `js/config.js`. Good knobs to turn:

- `spar.baseVitalShare` — how often a tag is a spar-ending vital (main balance lever).
- `spar.jointPoints` — value of a joint ribbon pull.
- `match.baseShotChance` / `match.blockPenalty` — how easy pocketing is, and how
  much each blocking defender hurts the shot.
- `match.pocketsToCloseOut` — length of the ball race.
- `circle.basketArm` — how far the basket hangs off the pole.
- `move.playerRadius` — player collision size.

Re-run the analysis after any change to see the new equilibrium and rules signals.
