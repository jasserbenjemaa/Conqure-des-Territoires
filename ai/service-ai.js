
/**
 * IA PROFESSIONNELLE — EXPECTIMINIMAX + OPTIMISATIONS
 * Plain-global version — no modules. Must be loaded AFTER base.js.
 *
 * Exposes: getBestMove(units) → [{ unit, dest }]
 *
 * "dest" shape: { r, c, isAttack, ranged }
 * This matches what index.js already expects in maybeRunAI():
 *   game.selectUnit(plan.unit)
 *   game.tryMove(plan.dest.r, plan.dest.c)
 */

var AI_CONFIG = {
  MAX_DEPTH:             3,
  TIME_LIMIT_MS:         180,
  SAFETY_MARGIN_MS:      25,
  BRANCH_LIMIT_BASE:     12,
  ATTACK_PROB_THRESHOLD: 0.60,
  KILLER_MOVES_DEPTH:    4,
  TT_MAX_SIZE:           5000,
  EVAL_CACHE_MAX:        5000,
  NULL_MOVE_REDUCTION:   2,
  LMR_THRESHOLD:         4,
  RANDOMNESS_FACTOR:     0.03
};

/* ═══════════════════════════════════════════════════════════
   ENGINE CLASS
═══════════════════════════════════════════════════════════ */
function ProAIEngine() {
  this.tt          = new Map();
  this.evalCache   = new Map();
  this.history     = new Map();
  this.killers     = [];
  for (var i = 0; i <= AI_CONFIG.KILLER_MOVES_DEPTH; i++) this.killers.push([]);

  this.startTime     = 0;
  this.nodesEvaluated = 0;
  this.bestRootMove  = null;
  this.aiPlayer      = 2;   // Player 2 is always the AI
}

/* ─── Entry point ─────────────────────────────────────────── */
ProAIEngine.prototype.decide = function(units) {
  if (!Array.isArray(units) || units.length === 0) return [];

  this.startTime      = performance.now();
  this.nodesEvaluated = 0;
  this.bestRootMove   = null;
  this.tt.clear();
  this.evalCache.clear();

  var bestScore = -Infinity;

  for (var depth = 1; depth <= AI_CONFIG.MAX_DEPTH; depth++) {
    if (!this._hasTime()) break;

    var result = this._expectiminimax(depth, -Infinity, Infinity, this.aiPlayer, true);

    if (result && result.move && result.score > bestScore) {
      bestScore         = result.score;
      this.bestRootMove = result.move;
    }

    if (Math.abs(bestScore) >= 9000) break;
  }

  // Controlled randomness — vary among nearly-equal moves occasionally
  if (this.bestRootMove && Math.random() < AI_CONFIG.RANDOMNESS_FACTOR) {
    var alts = this._generateAndOrderMoves(this.aiPlayer)
      .slice(0, 3)
      .filter(function(m) {
        return Math.abs((m.rawScore || 0) - (this.bestRootMove.rawScore || 0)) < 15;
      }.bind(this));
    if (alts.length > 1) {
      this.bestRootMove = alts[Math.floor(Math.random() * alts.length)];
    }
  }

  return this.bestRootMove ? [this.bestRootMove] : [];
};

/* ─── Expectiminimax ──────────────────────────────────────── */
ProAIEngine.prototype._expectiminimax = function(depth, alpha, beta, player, allowNullMove) {
  if (!this._hasTime()) {
    return { score: this._evaluate(), move: this.bestRootMove };
  }

  if (depth <= 0 || this._isTerminal()) {
    return { score: this._quiescence(alpha, beta, player, 3), move: null };
  }

  this.nodesEvaluated++;
  var hash    = hashGameState();
  var ttEntry = this.tt.get(hash);

  if (ttEntry && ttEntry.depth >= depth) {
    if (ttEntry.flag === 'EXACT') return { score: ttEntry.score, move: ttEntry.bestMove };
    if (ttEntry.flag === 'LOWER') alpha = Math.max(alpha, ttEntry.score);
    if (ttEntry.flag === 'UPPER') beta  = Math.min(beta,  ttEntry.score);
    if (alpha >= beta)            return { score: ttEntry.score, move: ttEntry.bestMove };
  }

  // Null-move pruning
  if (allowNullMove && depth >= 2 && player === this.aiPlayer) {
    var enemyCount = game.player(1).units.length;
    if (enemyCount > 2) {
      var nullResult = this._expectiminimax(
        depth - 1 - AI_CONFIG.NULL_MOVE_REDUCTION,
        beta - 1, beta,
        this._nextPlayer(player),
        false
      );
      if (nullResult.score >= beta) return { score: beta, move: null };
    }
  }

  var moves = this._generateAndOrderMoves(player);
  if (moves.length === 0) return { score: this._evaluate(), move: null };

  var limit        = Math.max(4, AI_CONFIG.BRANCH_LIMIT_BASE - depth);
  var limitedMoves = moves.slice(0, limit);
  var isMax        = (player === this.aiPlayer);
  var bestMove     = null;
  var bestScore    = isMax ? -Infinity : Infinity;
  var alphaOrig    = alpha;
  var betaOrig     = beta;

  for (var i = 0; i < limitedMoves.length; i++) {
    var move     = limitedMoves[i];
    var snapshot = cloneGameState();
    var score;

    if (move.dest.isAttack && move.winProb !== undefined) {
      // Chance node — weighted expected value
      restoreGameState(snapshot);
      this._applyMove(move, 'win');
      var winScore = this._expectiminimax(depth - 1, alpha, beta, this._nextPlayer(player)).score;

      restoreGameState(snapshot);
      this._applyMove(move, 'loss');
      var lossScore = this._expectiminimax(depth - 1, alpha, beta, this._nextPlayer(player)).score;

      restoreGameState(snapshot);
      score = move.winProb * winScore + (1 - move.winProb) * lossScore;

    } else {
      this._applyMove(move, 'win');

      var reduction = 0;
      if (i >= AI_CONFIG.LMR_THRESHOLD && depth >= 2 && !move.dest.isAttack) {
        reduction = 1;
      }

      score = this._expectiminimax(depth - 1 - reduction, alpha, beta, this._nextPlayer(player)).score;
      restoreGameState(snapshot);
    }

    if (isMax) {
      if (score > bestScore) { bestScore = score; bestMove = move; }
      alpha = Math.max(alpha, bestScore);
    } else {
      if (score < bestScore) { bestScore = score; bestMove = move; }
      beta  = Math.min(beta, bestScore);
    }

    if (beta <= alpha) {
      this._recordKiller(depth, move);
      this._updateHistory(move, depth * depth);
      break;
    }
  }

  if (this.tt.size < AI_CONFIG.TT_MAX_SIZE) {
    var flag = 'EXACT';
    if (bestScore <= alphaOrig) flag = 'UPPER';
    else if (bestScore >= betaOrig) flag = 'LOWER';
    this.tt.set(hash, { depth: depth, score: bestScore, bestMove: bestMove, flag: flag });
  }

  return { score: bestScore, move: bestMove };
};

/* ─── Quiescence search ───────────────────────────────────── */
ProAIEngine.prototype._quiescence = function(alpha, beta, player, depth) {
  var standPat = this._evaluate();
  if (depth <= 0 || !this._hasTime()) return standPat;

  if (player === this.aiPlayer) {
    if (standPat >= beta)   return beta;
    alpha = Math.max(alpha, standPat);
  } else {
    if (standPat <= alpha)  return alpha;
    beta  = Math.min(beta,  standPat);
  }

  var attacks = this._generateAndOrderMoves(player)
    .filter(function(m) {
      return m.dest.isAttack && m.winProb >= AI_CONFIG.ATTACK_PROB_THRESHOLD;
    });

  for (var i = 0; i < attacks.length; i++) {
    var move     = attacks[i];
    var snapshot = cloneGameState();
    this._applyMove(move, 'win');

    var score = this._quiescence(alpha, beta, this._nextPlayer(player), depth - 1);
    restoreGameState(snapshot);

    if (player === this.aiPlayer) {
      if (score >= beta)   return beta;
      alpha = Math.max(alpha, score);
    } else {
      if (score <= alpha)  return alpha;
      beta  = Math.min(beta, score);
    }
  }

  return player === this.aiPlayer ? alpha : beta;
};

/* ─── Move generation & ordering ─────────────────────────── */
ProAIEngine.prototype._generateAndOrderMoves = function(player) {
  var self       = this;
  var candidates = [];
  var units      = game.player(player).units.filter(function(u) { return u && !u.hasMoved; });

  units.forEach(function(unit) {
    var reachable = getAllReachableForUnit(unit) || [];

    reachable.forEach(function(dest) {
      var sq    = game.board.sq(dest.r, dest.c);
      var score = 0;
      var prob  = 1;

      if (dest.isAttack) {
        var enemies = sq.enemiesOf(unit.player);
        if (!enemies.length) return;

        // Pick the weakest enemy to attack (most likely to win)
        var defender = enemies.reduce(function(best, e) {
          return (e.def < best.def) ? e : best;
        }, enemies[0]);

        prob = calculateWinProbability(unit.atk, defender.def);
        if (prob < AI_CONFIG.ATTACK_PROB_THRESHOLD) return;

        score += prob * 100;
        var typeVal = AI_UNIT_TYPES[defender.type] ? AI_UNIT_TYPES[defender.type].val : 1;
        score += typeVal * 25;
      }

      // Territory bonus — encourage pushing forward
      score += 10 * (player === 2
        ? (AI_GRID_SIZE - 1 - dest.r)   // P2 deploys at high rows, pushes toward row 0
        : dest.r);

      // Exposure penalty
      score -= self._countAdjacentEnemies(dest.r, dest.c, player) * 5;

      // Heuristics
      score += self._getHistory(unit, dest);
      if (self._isKiller(unit, dest)) score += 50;

      candidates.push({ unit: unit, dest: dest, winProb: prob, rawScore: score });
    });
  });

  return candidates.sort(function(a, b) { return b.rawScore - a.rawScore; });
};

/* ─── Heuristic evaluation ────────────────────────────────── */
ProAIEngine.prototype._evaluate = function() {
  var hash = hashGameState();
  if (this.evalCache.has(hash)) return this.evalCache.get(hash);

  var score         = 0;
  var aiTerritory   = 0;
  var enemyTerritory = 0;
  var self          = this;

  [1, 2].forEach(function(pid) {
    (game.player(pid).units || []).forEach(function(unit) {
      var typeInfo = AI_UNIT_TYPES[unit.type] || { val: 1 };
      var value    = typeInfo.val;
      var isAI     = (unit.player === self.aiPlayer);

      // Material value
      score += isAI ? value * 15 : -value * 15;

      // Central positioning bonus
      var centerDist = Math.abs(unit.col - AI_GRID_SIZE / 2) + Math.abs(unit.row - AI_GRID_SIZE / 2);
      score += isAI ? (8 - centerDist) : -(8 - centerDist);

      // Threat exposure
      var threats = self._countAdjacentEnemies(unit.row, unit.col, unit.player);
      score += isAI ? -threats * 7 : threats * 7;
    });
  });

  // Territory (cell ownership tracked by game.cellOwnership)
  if (game.cellOwnership) {
    game.cellOwnership.forEach(function(owner) {
      if (owner === self.aiPlayer) aiTerritory++;
      else                          enemyTerritory++;
    });
    score += (aiTerritory - enemyTerritory) * 12;
  }

  score = Math.max(-9999, Math.min(9999, score));
  if (this.evalCache.size < AI_CONFIG.EVAL_CACHE_MAX) {
    this.evalCache.set(hash, score);
  }
  return score;
};

/* ─── Simulate move (for tree search) ────────────────────── */
/**
 * Applies a move in-place on the live game board (no copy).
 * cloneGameState() / restoreGameState() are called by the caller.
 *
 * outcome: 'win'  → attacker eliminates defender and occupies the cell
 *          'loss' → attack fails; attacker stays and is marked hasMoved
 */
ProAIEngine.prototype._applyMove = function(move, outcome) {
  var unit = move.unit;
  var dest = move.dest;

  var fromSq = game.board.sq(unit.row, unit.col);
  var toSq   = game.board.sq(dest.r, dest.c);

  fromSq.removeUnit(unit.id);

  if (dest.isAttack) {
    var enemies = toSq.enemiesOf(unit.player);
    if (!enemies.length) {
      // No target found — put attacker back and mark moved
      // FIX (bug 3): use addUnit consistently instead of bare array push
      fromSq.addUnit(unit);
      unit.hasMoved = true;
      return false;
    }

    var defender = enemies[0];

    if (outcome === 'win') {
      toSq.removeUnit(defender.id);
      // Remove defender from its player's unit list
      var defPlayer = game.player(defender.player);
      defPlayer.units = defPlayer.units.filter(function(u) { return u.id !== defender.id; });
      // Move attacker into the cell
      toSq.addUnit(unit);
      // FIX (bug 2): update attacker's logical position after a winning attack
      unit.row = dest.r;
      unit.col = dest.c;
    } else {
      // Attack failed — put attacker back, mark spent
      // FIX (bug 3): use addUnit consistently instead of bare array push
      fromSq.addUnit(unit);
      // unit.row / unit.col are already correct (unit didn't move)
    }

  } else {
    toSq.addUnit(unit);
    // FIX (bug 2): update unit's logical position after a normal move
    unit.row = dest.r;
    unit.col = dest.c;
  }

  unit.hasMoved = true;
  return true;
};

/* ─── Internal helpers ────────────────────────────────────── */
ProAIEngine.prototype._countAdjacentEnemies = function(row, col, playerNum) {
  var count = 0;
  var dirs  = [[-1,0],[1,0],[0,-1],[0,1]];
  for (var i = 0; i < dirs.length; i++) {
    var nr = row + dirs[i][0];
    var nc = col + dirs[i][1];
    if (nr < 0 || nr >= AI_GRID_SIZE || nc < 0 || nc >= AI_GRID_SIZE) continue;
    if (game.board.sq(nr, nc).hasEnemy(playerNum)) count++;
  }
  return count;
};

ProAIEngine.prototype._recordKiller = function(depth, move) {
  // FIX (bug 5): removed the `isAttack` guard — quiet moves that cause beta
  // cutoffs are just as valuable for the killer heuristic as attack moves.
  if (!move || !move.dest) return;
  var slot = this.killers[depth] || [];
  if (!slot.some(function(m) { return this._sameMove(m, move); }.bind(this))) {
    slot.unshift(move);
    if (slot.length > 2) slot.pop();
  }
  this.killers[depth] = slot;
};

ProAIEngine.prototype._isKiller = function(unit, dest) {
  return this.killers.some(function(slot) {
    return slot.some(function(m) {
      return m && m.unit && m.unit.id === unit.id &&
             m.dest.r === dest.r && m.dest.c === dest.c;
    });
  });
};

ProAIEngine.prototype._sameMove = function(a, b) {
  return a && b && a.unit && b.unit &&
         a.unit.id === b.unit.id &&
         a.dest.r  === b.dest.r  &&
         a.dest.c  === b.dest.c;
};

ProAIEngine.prototype._updateHistory = function(move, bonus) {
  var key = move.unit.type + ':' + move.dest.r + ',' + move.dest.c;
  this.history.set(key, (this.history.get(key) || 0) + bonus);
};

ProAIEngine.prototype._getHistory = function(unit, dest) {
  return this.history.get(unit.type + ':' + dest.r + ',' + dest.c) || 0;
};

ProAIEngine.prototype._nextPlayer = function(player) {
  return player === 1 ? 2 : 1;
};

ProAIEngine.prototype._hasTime = function() {
  return performance.now() - this.startTime < AI_CONFIG.TIME_LIMIT_MS - AI_CONFIG.SAFETY_MARGIN_MS;
};

ProAIEngine.prototype._isTerminal = function() {
  return game.player(1).units.length === 0 || game.player(2).units.length === 0;
};

/* ═══════════════════════════════════════════════════════════
   SINGLETON + PUBLIC API
═══════════════════════════════════════════════════════════ */
var _aiEngineInstance = new ProAIEngine();

/**
 * Public entry point — called by index.js's maybeRunAI().
 * @param  {Array} units  - AI unit objects (player 2, not yet moved)
 * @returns {Array}       - Array with one best move: [{ unit, dest }]
 *                          dest = { r, c, isAttack, ranged }
 */
function getBestMove(units) {
  return _aiEngineInstance.decide(units);
}