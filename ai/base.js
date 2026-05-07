
var AI_GRID_SIZE = 8;

// Unit type metadata — extend if you add more unit types
var AI_UNIT_TYPES = {
  tank:     { val: 3, force: 3 },
  cavalier: { val: 2, force: 2 },
  soldat:   { val: 1, force: 1 }
};

var AI_PLAYER = { P1: 1, P2: 2 };

/* ─────────────────────────────────────────────
   REACHABLE-CELLS  (replaces pathfinder import)
   Uses game.validMoves after game.selectUnit()
   to discover reachable cells for a given unit.
───────────────────────────────────────────── */
/**
 * Returns an array of { r, c, isAttack } objects for every cell
 * the unit can reach (move to OR attack).
 *
 * Strategy:
 *   • Temporarily select the unit via game.selectUnit() to populate
 *     game.validMoves and game.validRangedAttacks, then restore state.
 *   • Tank ranged attacks (game.validRangedAttacks) are flagged isAttack=true.
 */
function getAllReachableForUnit(unit) {
  if (!unit || typeof unit.row !== 'number') return [];

  // Save current selection so we can restore it
  var prevSelected  = game.selectedUnit;
  var prevMoves     = game.validMoves.slice();
  var prevRanged    = (game.validRangedAttacks || []).slice();

  game.selectUnit(unit);

  var results = [];

  // Normal moves / melee attacks
  (game.validMoves || []).forEach(function(pair) {
    var r = pair[0], c = pair[1];
    var sq = game.board.sq(r, c);
    results.push({ r: r, c: c, isAttack: sq.hasEnemy(unit.player) });
  });

  // Ranged attacks (tank)
  (game.validRangedAttacks || []).forEach(function(pair) {
    var r = pair[0], c = pair[1];
    // Avoid duplicates added by validMoves
    var already = results.some(function(x) { return x.r === r && x.c === c; });
    if (!already) results.push({ r: r, c: c, isAttack: true, ranged: true });
    else {
      // Mark existing entry as ranged too
      results.forEach(function(x) {
        if (x.r === r && x.c === c) x.ranged = true;
      });
    }
  });

  // Restore previous selection state
  if (prevSelected) game.selectUnit(prevSelected);
  else game.clearSel();
  game.validMoves          = prevMoves;
  game.validRangedAttacks  = prevRanged;

  return results;
}

/**
 * All AI (player 2) units that have not yet moved this turn.
 * Sorted by descending unit value so high-value pieces are tried first.
 */
function getAvailableUnits(playerNum) {
  var units = game.player(playerNum).units || [];
  return units
    .filter(function(u) { return u && !u.hasMoved; })
    .sort(function(a, b) {
      return (AI_UNIT_TYPES[b.type] ? AI_UNIT_TYPES[b.type].val : 1)
           - (AI_UNIT_TYPES[a.type] ? AI_UNIT_TYPES[a.type].val : 1);
    });
}

/* ─────────────────────────────────────────────
   GAME-STATE CLONE / RESTORE
   Snapshots the board grid + unit positions so
   the AI can simulate moves and roll back.
───────────────────────────────────────────── */
function cloneGameState() {
  var gridSnap = [];
  for (var r = 0; r < AI_GRID_SIZE; r++) {
    gridSnap[r] = [];
    for (var c = 0; c < AI_GRID_SIZE; c++) {
      var sq = game.board.sq(r, c);
      gridSnap[r][c] = sq.units.map(function(u) { return u.id; });
    }
  }

  // Clone every unit's mutable position fields
  var unitsSnap = {};
  [1, 2].forEach(function(pid) {
    (game.player(pid).units || []).forEach(function(u) {
      unitsSnap[u.id] = { row: u.row, col: u.col, hasMoved: u.hasMoved, alive: true };
    });
  });

  // FIX (bug 1): Also snapshot the player unit arrays.
  // _applyMove removes killed units from game.player(pid).units, so
  // getAllUnitsFlat() called inside restoreGameState() would miss them,
  // leaving killed units permanently absent after the first simulated attack.
  var playerUnitsSnap = {};
  [1, 2].forEach(function(pid) {
    playerUnitsSnap[pid] = (game.player(pid).units || []).slice();
  });

  return { grid: gridSnap, units: unitsSnap, playerUnits: playerUnitsSnap };
}

function restoreGameState(snapshot) {
  if (!snapshot) return false;
  try {
    // Restore board grid unit-lists
    for (var r = 0; r < AI_GRID_SIZE; r++) {
      for (var c = 0; c < AI_GRID_SIZE; c++) {
        game.board.grid[r][c].units = [];
      }
    }

    // FIX (bug 1): Restore player unit arrays BEFORE iterating them.
    // Without this, any unit removed from game.player(pid).units by
    // _applyMove is invisible to getAllUnitsFlat() and never re-placed.
    if (snapshot.playerUnits) {
      [1, 2].forEach(function(pid) {
        game.player(pid).units = snapshot.playerUnits[pid].slice();
      });
    }

    // Re-place every unit that was alive in the snapshot
    var allUnits = getAllUnitsFlat();
    allUnits.forEach(function(u) {
      var snap = snapshot.units[u.id];
      if (!snap) return; // unit was dead at snapshot time — skip
      u.row      = snap.row;
      u.col      = snap.col;
      u.hasMoved = snap.hasMoved;
      game.board.grid[u.row][u.col].units.push(u);
    });

    return true;
  } catch (e) {
    return false;
  }
}

/** Helper: flat array of all living units from both players */
function getAllUnitsFlat() {
  var result = [];
  [1, 2].forEach(function(pid) {
    (game.player(pid).units || []).forEach(function(u) { result.push(u); });
  });
  return result;
}

/* ─────────────────────────────────────────────
   WIN-PROBABILITY  (dice model: d6 + stat)
───────────────────────────────────────────── */
/**
 * Returns probability that attacker beats defender in one dice roll.
 * Both add a d6; attacker also adds atk, defender adds def.
 * @param {number} atk  - attacker's ATK value
 * @param {number} def  - defender's DEF value
 */
function calculateWinProbability(atk, def) {
  var wins = 0;
  for (var a = 1; a <= 6; a++) {
    for (var d = 1; d <= 6; d++) {
      if ((a + atk) > (d + def)) wins++;
    }
  }
  return wins / 36;
}

/* ─────────────────────────────────────────────
   STATE HASH  (transposition table key)
───────────────────────────────────────────── */
function hashGameState() {
  var parts = [];
  for (var r = 0; r < AI_GRID_SIZE; r++) {
    for (var c = 0; c < AI_GRID_SIZE; c++) {
      var sq = game.board.sq(r, c);
      sq.units.forEach(function(u) {
        parts.push(u.id + ':' + u.player + ':' + r + ':' + c + ':' + (u.hasMoved ? 1 : 0));
      });
    }
  }
  return parts.join('|');
}