# ⚔️ Conquête des Territoires

A turn-based territory-control strategy game for two players (or one player vs AI), playable directly in the browser. Deploy your units, outmaneuver your opponent, and dominate the 8×8 map through tactical combat and area control.

---

## 🎮 Gameplay Overview

Each game unfolds in three phases:

**1. Deployment Phase**
Both players take turns placing exactly 5 units on their respective deployment rows. Player 1 (Blue) deploys first, followed by Player 2 (Red) — or the AI in solo mode.

**2. Initiative Roll**
Before battle begins, both sides roll a d6. The higher roll goes first. Ties are automatically re-rolled until a winner is determined.

**3. Battle Phase**
Players alternate turns, selecting a unit and moving it across the board. Moving onto an enemy cell triggers dice combat. Territory is claimed as units traverse the map — the player controlling the most cells at the end wins.

---

## 🪖 Units

| Unit | Symbol | Role |
|------|--------|------|
| **Soldat** | Infantry | Balanced attacker, versatile across the board |
| **Cavalier** | Cavalry | Fast-moving unit, covers more ground per turn |
| **Tank** | Armored | High attack power; supports **ranged attacks** with a distance penalty |

Each unit has ATK and DEF stats displayed in the UI. Powerups scattered across the board can temporarily buff or debuff these values.

---

## 🎲 Combat System

When a unit moves onto a cell occupied by an enemy, dice combat is triggered:

```
Attacker total  =  d6 roll  +  ATK stat  +  ATK modifier
Defender total  =  d6 roll  +  DEF stat  +  DEF modifier
```

The side with the higher total wins the exchange. Ties go to the defender. Tank ranged attacks subtract 1 ATK for each tile of distance beyond 1.

Results are shown in a dedicated combat overlay, one enemy at a time, with colored dice faces and a clear verdict.

---

## ⚡ Powerups

Five powerups spawn randomly across the board at the start of the battle phase. A unit that steps on one gains a temporary ATK or DEF modifier, displayed as an emoji badge on the token.

---

## 🤖 AI Opponent

When playing against the AI:
- The AI auto-places its 5 units (2 Cavaliers, 1 Tank, 2 Soldats) at the start of its deployment rows.
- During battle, the AI uses a `getBestMove()` heuristic to select and move one unit per turn.
- The AI takes its turn automatically after a short delay so the player can follow along.

---

## 🗂️ Project Structure

```
Conqure-des-Territoires/
├── index.html        # Main HTML shell — board, overlays, UI panels
├── index.js          # UI controller — rendering, input, combat flow, AI loop
├── styles.css        # All visual styling
├── game/             # Core game logic (Game, Board, Square, units)
└── ai/               # AI move-selection logic (getBestMove)
```

### `index.js` responsibilities

| Section | What it does |
|---|---|
| DOM refs & unit stats | Grabs all UI elements; initializes ATK/DEF display for each unit type |
| `renderBoard()` | Rebuilds the 8×8 grid every turn — cells, ownership dots, unit tokens, powerup tokens, valid-move highlights |
| `renderTerritoryStats()` | Updates the live territory bars (cell count + percentage) for both players |
| `onCellClick / onUnitClick` | Routes player input to placement or movement logic in the `Game` object |
| `autoPlaceAI / maybeRunAI` | Handles AI deployment and automated battle turns |
| `launchCombat / showCombat / advanceCombat` | Builds the combat queue, renders the dice overlay, and applies results |
| `showInitiativeOverlay` | Manages the pre-battle d6 roll to decide who goes first |
| `doRestart` | Fully resets all state — game, UI, overlays, AI flags |

---

## 🚀 Getting Started

No build step required. Just open `index.html` in any modern browser.

```bash
git clone https://github.com/jasserbenjemaa/Conqure-des-Territoires.git
cd Conqure-des-Territoires
open index.html   # or double-click it
```

---

## 🕹️ Controls

- **Click a unit** → select it (highlights valid moves in blue, attack targets in red, ranged targets in purple)
- **Click a highlighted cell** → move the selected unit there
- **Click the same unit again** → deselect it
- **✔ button** → confirm placement and end your deployment phase
- **✖ button** → reset your placed units and start over
- **Exit button** → return to the main menu (with confirmation)
- **? Help button** → open the in-game guide

---

## 🏆 Winning

The game ends when one player eliminates all enemy units or achieves a dominant territorial advantage. A win overlay displays the winner and the reason for victory. Players can then restart from the main menu.

---

## 🛠️ Tech Stack

- Vanilla JavaScript (ES6+)
- HTML5 / CSS3
