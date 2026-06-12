# Flux — Strategy & Rules Analysis

## 1. Overall match outcomes (auto-selecting strategies)

| Metric | Value |
|---|---|
| Games | 500 |
| Cell A wins | 46.2% |
| Cell B wins | 49.6% |
| Draws | 4.2% |
| Avg points (A / B) | 31.10 / 31.35 |
| Ended by close-out / time rule | 99.6% / 0.4% |
| **Pyrrhic close-outs** (ended the game but lost on points) | 0.0% |

## 2. Strategy payoff matrix (row = A, win rate for A)

| A \\ B | Rush | Control | Aggro | Contain | Balanced |
|---|---|---|---|---|---|
| **Rush** | 45.8% | 69.2% | 30.8% | 91.7% | 71.7% |
| **Control** | 31.7% | 51.7% | 34.2% | 85.0% | 43.3% |
| **Aggro** | 50.8% | 66.7% | 58.3% | 94.2% | 65.8% |
| **Contain** | 15.0% | 5.0% | 16.7% | 34.2% | 15.8% |
| **Balanced** | 20.8% | 43.3% | 24.2% | 90.0% | 45.8% |

## 3. Best responses

| If opponent plays | Your best answer | Win rate |
|---|---|---|
| Rush | Aggro | 50.8% |
| Control | Rush | 69.2% |
| Aggro | Aggro | 58.3% |
| Contain | Aggro | 94.2% |
| Balanced | Rush | 71.7% |

## 4. Game-theory equilibrium

No strategy *strictly* dominates, but the equilibrium concentrates on a
single technique: **Aggro** (100.0% of the mix).
As a whole-game commitment, **Aggro** is the strongest plan here.
The richer strategic variety lives in the per-game-state guide below --
what to do *changes* with the situation even if one plan wins on average.

## 5. Best technique per game state

Monte-Carlo value of each technique, conditioned on the situation at
the moment of choosing. Use this as the in-game decision guide.

| Game state | Best technique | Win rate | Runner-up |
|---|---|---|---|
| ahead / ball-even | **Control** | 59.2% | Aggro (57.9%) |
| ahead / ball-lead | **Contain** | 78.4% | Aggro (75.3%) |
| ahead / ball-trail | **Aggro** | 43.2% | Control (40.0%) |
| even / ball-even | **Rush** | 51.1% | Balanced (50.6%) |
| even / ball-lead | **Aggro** | 70.5% | Rush (66.9%) |
| even / ball-trail | **Control** | 38.1% | Contain (35.7%) |
| behind / ball-even | **Aggro** | 47.9% | Balanced (43.2%) |
| behind / ball-lead | **Balanced** | 62.5% | Rush (61.3%) |
| behind / ball-trail | **Aggro** | 33.6% | Control (24.8%) |

## 6. Rules signals (possible holes)

- **Thin whole-game strategy space.** "Aggro" is the equilibrium (100.0% of the mix) -- committing to it wins on average. Lower `spar.baseVitalShare` to make racing the ball-clock (Rush) competitive again, or buff the weaker plans. Note the per-game-state guide still rewards switching tactics by situation.

## 7. How to play (plain-language summary)

- Flux is two games at once: the **ball race** (the clock) and the
  **ribbon duel** (the score). You win by ending the ball race while
  ahead on ribbons.
- When **ahead on points**, push the ball race (Rush) to end it before
  the opponent catches up.
- When **behind on points**, do NOT pocket your third ball. Stall at two
  and hunt ribbons (Aggro), or deny their close-out (Contain).
- Scoring joint ribbons makes you a target: a vital pull strips your
  accumulated points, so a high scorer is worth hunting.
