# Flux — Strategy & Rules Analysis

## 1. Overall match outcomes (auto-selecting strategies)

| Metric | Value |
|---|---|
| Games | 500 |
| Cell A wins | 45.8% |
| Cell B wins | 47.4% |
| Draws | 6.8% |
| Avg points (A / B) | 30.50 / 31.08 |
| Ended by close-out / time rule | 99.8% / 0.2% |
| **Pyrrhic close-outs** (ended the game but lost on points) | 0.0% |

## 2. Strategy payoff matrix (row = A, win rate for A)

| A \\ B | Rush | Control | Aggro | Contain | Balanced |
|---|---|---|---|---|---|
| **Rush** | 39.2% | 50.8% | 40.0% | 62.5% | 55.0% |
| **Control** | 42.5% | 45.8% | 47.5% | 75.8% | 38.3% |
| **Aggro** | 47.5% | 46.7% | 52.5% | 65.8% | 62.5% |
| **Contain** | 28.3% | 36.7% | 40.8% | 45.0% | 36.7% |
| **Balanced** | 38.3% | 41.7% | 43.3% | 65.8% | 48.3% |

## 3. Best responses

| If opponent plays | Your best answer | Win rate |
|---|---|---|
| Rush | Aggro | 47.5% |
| Control | Rush | 50.8% |
| Aggro | Aggro | 52.5% |
| Contain | Control | 75.8% |
| Balanced | Aggro | 62.5% |

## 4. Game-theory equilibrium

No strategy *strictly* dominates, but the equilibrium concentrates on a
single technique: **Aggro** (93.3% of the mix).
As a whole-game commitment, **Aggro** is the strongest plan here.
The richer strategic variety lives in the per-game-state guide below --
what to do *changes* with the situation even if one plan wins on average.

## 5. Best technique per game state

Monte-Carlo value of each technique, conditioned on the situation at
the moment of choosing. Use this as the in-game decision guide.

| Game state | Best technique | Win rate | Runner-up |
|---|---|---|---|
| ahead / ball-even | **Contain** | 55.8% | Aggro (55.0%) |
| ahead / ball-lead | **Aggro** | 72.4% | Contain (70.6%) |
| ahead / ball-trail | **Control** | 38.3% | Aggro (37.8%) |
| even / ball-even | **Rush** | 51.9% | Contain (50.4%) |
| even / ball-lead | **Contain** | 69.3% | Balanced (68.2%) |
| even / ball-trail | **Control** | 36.8% | Rush (34.5%) |
| behind / ball-even | **Aggro** | 49.2% | Control (46.5%) |
| behind / ball-lead | **Control** | 64.3% | Contain (63.0%) |
| behind / ball-trail | **Aggro** | 33.2% | Balanced (30.3%) |

## 6. Rules signals (possible holes)

- **Thin whole-game strategy space.** "Aggro" is the equilibrium (93.3% of the mix) -- committing to it wins on average. Lower `spar.baseVitalShare` to make racing the ball-clock (Rush) competitive again, or buff the weaker plans. Note the per-game-state guide still rewards switching tactics by situation.

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
