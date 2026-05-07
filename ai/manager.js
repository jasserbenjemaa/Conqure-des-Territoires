
/**
 * COORDINATEUR IA
 * Plain-global version — no modules. Must be loaded AFTER base.js and service-ai.js.
 *
 * This file is intentionally thin: index.js already owns the render loop,
 * the combat queue, and the turn-state machine via maybeRunAI() / launchCombat().
 *
 * What this file adds:
 *   • autoPlaceAI()  — unchanged from index.js but kept here for organisation
 *   • The real maybeRunAI() that calls getBestMove() from service-ai.js
 *     and replaces the stub that was in index.js.
 *
 * HOW TO INTEGRATE
 * ────────────────
 * 1. Load order in your HTML (before index.js):
 *      <script src="GridSquare.js"></script>
 *      <script src="Board.js"></script>
 *      <!-- your other game files (Game class, unit classes, etc.) -->
 *      <script src="base.js"></script>
 *      <script src="service-ai.js"></script>
 *      <script src="manager.js"></script>
 *      <script src="index.js"></script>
 *
 * 2. In index.js DELETE the old maybeRunAI() function entirely.
 *    manager.js defines the real one.
 *
 * 3. The rest of index.js stays exactly as-is.
 */

/* ─────────────────────────────────────────────────────────────
   AUTO-PLACE  (AI placement phase — strategic)
   Delete the autoPlaceAI() in index.js and use this one.

   PLACEMENT LOGIC
   ───────────────
   P2 deploys at high row numbers and pushes toward row 0.
   "Front row" = lowest-numbered deploy row (closest to enemy).
   "Back row"  = highest-numbered deploy row (safest).

   • TANK     → back row, central cols (3-4).
                Ranged; doesn't need to be forward.
                Central position covers the widest firing arc.

   • CAVALIER → front row, outer cols (0-1 or 6-7).
                High mobility profits from starting close to the
                enemy and on the flanks where lanes are open.

   • SOLDAT   → remaining cells, scored to maximise column spread
                and slight forward preference for early pressure.

   All units get a proximity penalty so they don't cluster.
───────────────────────────────────────────────────────────── */

/**
 * Score a candidate placement cell for a given unit type.
 * Higher = better.
 *
 * @param {string}  type        - 'tank' | 'cavalier' | 'soldat'
 * @param {number}  r           - row
 * @param {number}  c           - col
 * @param {number}  frontRow    - lowest-numbered deploy row (closest to enemy)
 * @param {Array}   placed      - already-placed cells [{ r, c }]
 */
function _scorePlacement(type, r, c, frontRow, placed) {
  var score = 0;
  var midCol = 3.5;                          // board centre (8 cols)

  // ── Proximity penalty: spread units out ─────────────────
  placed.forEach(function(p) {
    var dist = Math.abs(p.r - r) + Math.abs(p.c - c);
    if (dist <= 1) score -= 40;             // directly adjacent — strongly avoid
    else if (dist <= 2) score -= 15;
  });

  // ── Column spread bonus: prefer cols not yet occupied ───
  var colsTaken = placed.map(function(p) { return p.c; });
  if (colsTaken.indexOf(c) === -1) score += 20;

  // ── Type-specific scoring ────────────────────────────────
  if (type === 'tank') {
    // Central column → widest ranged coverage
    score += (4 - Math.abs(c - midCol)) * 12;
    // Back row is safer for a unit that never needs to close in
    if (r !== frontRow) score += 25;

  } else if (type === 'cavalier') {
    // Flank columns → open lanes for fast movement
    var flankBonus = Math.max(0, 3 - Math.min(c, 7 - c));  // 0→3, 7→3, 3→0
    score += flankBonus * 14;
    // Front row → start closer to the action
    if (r === frontRow) score += 20;

  } else {
    // soldat — even column spread, slight front preference
    score += (4 - Math.abs(c - midCol)) * 3;   // mild centre lean
    if (r === frontRow) score += 10;
  }

  return score;
}

/**
 * Strategic AI placement.
 * Places units one at a time, highest-priority type first,
 * always picking the best-scoring free cell.
 */
function autoPlaceAI() {
  game.state = 'PLACE_2';

  var deployRows = game.player(2).deployRows();
  if (!deployRows || deployRows.length === 0) return;

  // Front row = numerically smallest (closest to row 0 = enemy side)
  var frontRow = Math.min.apply(null, deployRows);

  // Priority order: tank first so it claims centre, then cavaliers, then soldats
  var queue = ['tank', 'cavalier', 'soldat', 'soldat', 'soldat'];

  // Track already-placed positions for the spread/proximity scoring
  var placedCells = [];

  queue.forEach(function(type) {
    var bestScore = -Infinity;
    var bestR = -1, bestC = -1;

    // Evaluate every free cell in the deploy zone
    for (var ri = 0; ri < deployRows.length; ri++) {
      var r = deployRows[ri];
      for (var c = 0; c < 8; c++) {
        if (game.board.sq(r, c).units.length > 0) continue;   // occupied
        var s = _scorePlacement(type, r, c, frontRow, placedCells);
        if (s > bestScore) { bestScore = s; bestR = r; bestC = c; }
      }
    }

    if (bestR === -1) return;  // no free cell found (shouldn't happen)

    game.chosenType = type;
    if (game.tryPlace(bestR, bestC)) {
      placedCells.push({ r: bestR, c: bestC });
    }
  });
}

/* ─────────────────────────────────────────────────────────────
   AI TURN  — replaces maybeRunAI() in index.js
───────────────────────────────────────────────────────────── */
/**
 * Called by renderAll() (index.js) every time the board re-renders.
 * Checks whether it's the AI's turn; if so, runs the engine and
 * executes the chosen move via the same game API that the human
 * player uses (selectUnit → tryMove), so all game rules apply.
 *
 * Relies on these index.js globals (must already exist when called):
 *   vsAI, aiThinking, combatQueue
 *   game, renderAll, launchCombat
 */
function maybeRunAI() {
  // Guard: only runs when it's AI's turn, AI mode is on, board is idle
  if (!vsAI)                               return;
  if (aiThinking)                          return;
  if (game.state !== 'BATTLE_2')           return;
  if (combatQueue && combatQueue.length)   return;

  aiThinking = true;

  setTimeout(function() {

    // ── 1. Collect available AI units ───────────────────────
    var aiUnits = getAvailableUnits(2);

    if (!aiUnits || aiUnits.length === 0) {
      aiThinking = false;
      if (typeof game.endTurn === 'function') {
        game.endTurn();
        renderAll();
      }
      return;
    }

    // ── 2. Ask the engine for the best move ─────────────────
    var plans;
    try {
      plans = getBestMove(aiUnits);
    } catch (err) {
      console.error('[AI] Engine error:', err);
      aiThinking = false;
      return;
    }

    // ── 3. Fallback — pick any available move if engine returns nothing ──
    if (!plans || plans.length === 0) {
      var safeMove = null;
      for (var i = 0; i < aiUnits.length && !safeMove; i++) {
        var reach = getAllReachableForUnit(aiUnits[i]) || [];

        // FIX (bug 4): prefer a non-attack move, but fall back to an attack
        // move rather than skipping this unit entirely. The old code only
        // accepted non-attack moves, so a unit with nothing but attacks ahead
        // would be silently skipped and the AI could do nothing this turn.
        var preferred = null;
        var fallback  = null;
        for (var j = 0; j < reach.length; j++) {
          if (!reach[j].isAttack) { preferred = reach[j]; break; }
          if (!fallback)            fallback  = reach[j];
        }
        var chosen = preferred || fallback;
        if (chosen) safeMove = { unit: aiUnits[i], dest: chosen };
      }

      if (safeMove) {
        game.selectUnit(safeMove.unit);
        var fallbackResult = game.tryMove(safeMove.dest.r, safeMove.dest.c);
        if (fallbackResult && fallbackResult.kind === 'combat') {
          launchCombat(
            fallbackResult.attacker, fallbackResult.sq,
            fallbackResult.toR, fallbackResult.toC,
            fallbackResult.ranged || false
          );
        } else {
          renderAll();
        }
      }

      aiThinking = false;
      return;
    }

    // ── 4. Execute the engine's chosen move ─────────────────
    var plan = plans[0];

    // Show the AI "thinking" by selecting the unit first (visual feedback)
    game.selectUnit(plan.unit);
    renderAll();

    setTimeout(function() {
      var result = game.tryMove(plan.dest.r, plan.dest.c);
      aiThinking = false;

      if (!result) {
        // Move was rejected by the game engine (shouldn't happen, but safe)
        game.clearSel();
        renderAll();
        return;
      }

      if (result.kind === 'combat') {
        launchCombat(
          result.attacker, result.sq,
          result.toR, result.toC,
          result.ranged || false
        );
      } else {
        renderAll();
      }
    }, 600);  // Delay between selection flash and actual move (UX)

  }, 500);    // Initial "thinking" pause (UX)
}