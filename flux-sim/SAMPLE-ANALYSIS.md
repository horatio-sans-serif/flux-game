# Flux — Strategy & Rules Analysis

## 1. Overall match outcomes (auto-selecting strategies)

| Metric | Value |
|---|---|
| Games | 500 |
| Cell A wins | 47.0% |
| Cell B wins | 48.8% |
| Draws | 4.2% |
| Avg points (A / B) | 30.03 / 29.76 |
| Ended by close-out / time rule | 100.0% / 0.0% |
| **Pyrrhic close-outs** (ended the game but lost on points) | 0.0% |

## 2. Strategy payoff matrix (row = A, win rate for A)

| A \\ B | Rush | Control | Aggro | Contain | Balanced |
|---|---|---|---|---|---|
| **Rush** | 52.5% | 78.3% | 39.2% | 90.8% | 75.8% |
| **Control** | 19.2% | 56.7% | 25.8% | 83.3% | 58.3% |
| **Aggro** | 32.5% | 66.7% | 57.5% | 90.8% | 70.0% |
| **Contain** | 11.7% | 10.0% | 8.3% | 41.7% | 23.3% |
| **Balanced** | 30.0% | 47.5% | 30.8% | 78.3% | 44.2% |

## 3. Best responses

| If opponent plays | Your best answer | Win rate |
|---|---|---|
| Rush | Rush | 52.5% |
| Control | Rush | 78.3% |
| Aggro | Aggro | 57.5% |
| Contain | Rush | 90.8% |
| Balanced | Rush | 75.8% |

## 4. Game-theory equilibrium

No single strategy dominates. The equilibrium is a **mix** -- play
each strategy with the following frequency to be unexploitable:

| Strategy | Play frequency |
|---|---|
| Rush | 65.2% |
| Aggro | 34.8% |

Guaranteed win rate of this mix vs. any opponent: **45.5%**
(≈ 50% confirms a balanced, fair design).

## 5. Best technique per game state

Monte-Carlo value of each technique, conditioned on the situation at
the moment of choosing. Use this as the in-game decision guide.

| Game state | Best technique | Win rate | Runner-up |
|---|---|---|---|
| ahead / ball-even | **Contain** | 57.7% | Control (57.2%) |
| ahead / ball-lead | **Aggro** | 80.6% | Control (77.0%) |
| ahead / ball-trail | **Rush** | 35.2% | Balanced (33.3%) |
| even / ball-even | **Aggro** | 50.3% | Balanced (50.1%) |
| even / ball-lead | **Rush** | 73.4% | Aggro (71.7%) |
| even / ball-trail | **Contain** | 35.1% | Balanced (31.9%) |
| behind / ball-even | **Aggro** | 48.0% | Balanced (41.7%) |
| behind / ball-lead | **Rush** | 69.2% | Contain (67.7%) |
| behind / ball-trail | **Aggro** | 29.6% | Control (22.5%) |

## 6. Rules signals (possible holes)

- No major red flags detected at current settings.

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
