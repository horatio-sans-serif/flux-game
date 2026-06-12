# Flux

An outdoor team sport invented by a kid — plus a 3D simulator that play-tests it.

**▶ Play / explore:** https://horatio-sans-serif.github.io/flux-game/

Flux is two games at once: a **ball race** (the clock) and a **ribbon duel** (the
score). You win by ending the ball race while ahead on ribbon points.

## What's here

|                                |                                                 |
| ------------------------------ | ----------------------------------------------- |
| [QUICKSTART.md](QUICKSTART.md) | One-page pickup-game guide.                     |
| [RULEBOOK.md](RULEBOOK.md)     | The full rules.                                 |
| [TRAINING.md](TRAINING.md)     | The practice and development system.            |
| [flux-sim/](flux-sim/)         | Babylon.js 3D simulator + game-theory analyzer. |

## The simulator

Watch matches in 3D, run fast headless batches, and run a game-theory analysis
that finds the optimal way to play and flags holes in the rules. See
[flux-sim/README.md](flux-sim/README.md) for how it works and
[flux-sim/SAMPLE-ANALYSIS.md](flux-sim/SAMPLE-ANALYSIS.md) for an example report.

Run locally:

```bash
cd flux-sim
python3 -m http.server 8000   # then open http://localhost:8000
```
