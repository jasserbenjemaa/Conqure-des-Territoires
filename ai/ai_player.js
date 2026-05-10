// Configuration du niveau Hard
const CONFIG = {
  MAX_DEPTH: 10,
  TIME_LIMIT_MS: 300,
  BRANCH_LIMIT: 5,
  TRANSPOSITION_CACHE_SIZE: 3000,
  MOVE_ORDERING_BONUS: 1.2,
  EVALUATION_CACHE: true
};

/**
 * Classe Minimax avec optimisations professionnelles
 */
class MinimaxEngine {
  constructor(playerId = 2) {
    this.pid   = playerId;
    this.enemy = playerId === 2 ? 1 : 2;

    this.transpositionTable = new Map();
    this.evalCache          = new Map();
    this.nodesEvaluated     = 0;
    this.startTime          = 0;
    this.bestMoveFound      = null;
  }


  decide(units) {
    if (!Array.isArray(units) || units.length === 0) return null;

    this.startTime = performance.now();
    this.transpositionTable.clear();
    if (CONFIG.EVALUATION_CACHE) this.evalCache.clear();
    this.nodesEvaluated = 0;
    this.bestMoveFound  = null;

    let bestScore = -Infinity;
    let bestPlan  = null;
    let depth     = 1;

    // 🔄 Iterative Deepening avec cutoff temporel
    while (depth <= CONFIG.MAX_DEPTH) {
      const timeElapsed = performance.now() - this.startTime;
      if (timeElapsed > CONFIG.TIME_LIMIT_MS) break;

      const result = this._alphaBeta(depth, -Infinity, Infinity, true, this.pid);

      // Always trust the deepest completed iteration — cross-depth scores
      // are not comparable so we never let a shallower result override a deeper one.
      if (result.move) {
        bestPlan  = result.move;
        bestScore = result.score;
        this.bestMoveFound = bestPlan;
      }

      if (bestScore > 1000 || bestScore < -1000) break;
      depth++;
    }

    return bestPlan;
  }


  _alphaBeta(depth, alpha, beta, isMaximizing, currentPlayer) {
    // ⏱️ Time cutoff — always score from AI's fixed perspective
    if (performance.now() - this.startTime > CONFIG.TIME_LIMIT_MS) {
      return { score: this._evaluate(this.pid), move: this.bestMoveFound };
    }

    // 🎯 Terminal ou profondeur max — same fixed perspective
    if (depth === 0 || this._isTerminal()) {
      return { score: this._evaluate(this.pid), move: null };
    }

    // ♻️ Table de transposition
    const stateHash = this._hashGameState();
    const cached    = this.transpositionTable.get(stateHash);
    if (cached && cached.depth >= depth) {
      return { score: cached.score, move: cached.bestMove };
    }

    this.nodesEvaluated++;

    const availableUnits = game.player(currentPlayer).units;
    if (!availableUnits?.length) {
      return { score: this._evaluate(this.pid), move: null };
    }

    // 🎯 Génération et TRI des coups (Move Ordering)
    const candidates        = this._generateCandidates(availableUnits, currentPlayer, isMaximizing);
    const limitedCandidates = candidates.slice(0, CONFIG.BRANCH_LIMIT);

    if (limitedCandidates.length === 0) {
      return { score: this._evaluate(this.pid), move: null };
    }

    let bestMove = null;
    let value    = isMaximizing ? -Infinity : Infinity;

    for (const plan of limitedCandidates) {
      const snapshot = this._cloneGameState();
      if (!snapshot) continue;

      const applied = this._applyPlan(plan.unit, plan.dest);
      if (!applied) {
        this._restoreGameState(snapshot);
        continue;
      }

      const nextPlayer = currentPlayer === this.pid ? this.enemy : this.pid;
      const result     = this._alphaBeta(depth - 1, alpha, beta, !isMaximizing, nextPlayer);

      this._restoreGameState(snapshot);

      if (isMaximizing) {
        if (result.score > value) { value = result.score; bestMove = plan; }
        alpha = Math.max(alpha, value);
      } else {
        if (result.score < value) { value = result.score; bestMove = plan; }
        beta = Math.min(beta, value);
      }

      // ✂️ Élagage α-β
      if (beta <= alpha) break;
    }

    // 💾 Cache résultat
    if (this.transpositionTable.size < CONFIG.TRANSPOSITION_CACHE_SIZE) {
      this.transpositionTable.set(stateHash, {
        depth,
        score: value,
        bestMove,
        flag: value <= alpha ? 'upper' : value >= beta ? 'lower' : 'exact'
      });
    }

    return { score: value, move: bestMove };
  }

  _generateCandidates(units, player, isMaximizing) {
    const candidates = [];

    for (const unit of units) {
      const moves  = unit.getValidMoves();
      const ranged = unit.getRangedAttacks ? unit.getRangedAttacks(game.board) : [];

      const allDests = [
        ...moves .map(([r, c]) => ({ r, c, isAttack: game.board.sq(r, c).hasEnemy(unit.player), isRanged: false })),
        ...ranged.map(([r, c]) => ({ r, c, isAttack: true,                                       isRanged: true  })),
      ].slice(0, 8);

      for (const dest of allDests) {
        const cell = game.board.sq(dest.r, dest.c);

        let score = this._quickScore(unit, dest, cell, player, isMaximizing);

        if (dest.isAttack) score *= CONFIG.MOVE_ORDERING_BONUS;
        const cellOwner = game.cellOwnership.get(`${dest.r},${dest.c}`);
        if (!cellOwner || cellOwner !== player) score *= CONFIG.MOVE_ORDERING_BONUS;

        candidates.push({ unit, dest, score });
      }
    }

    return candidates.sort((a, b) =>
      isMaximizing ? b.score - a.score : a.score - b.score
    );
  }


  _quickScore(unit, dest, cell, player) {
    let score = 0;

    if (dest.isAttack) {
      const aMod = game.getMod(unit.id).atkMod;
      for (const def of cell.enemiesOf(unit.player)) {
        const dMod = game.getMod(def.id).defMod;
        const prob = this._winProbability(unit.atk + aMod, def.def + dMod);
        score += prob > 0.5 ? 10 : -5;
      }
    }

    const cellOwner = game.cellOwnership.get(`${dest.r},${dest.c}`);
    if (!cellOwner || cellOwner !== player) score += 5;

    const key = `${dest.r},${dest.c}`;
    if (game.powerups.has(key)) {
      const pu = game.powerups.get(key);
      if (pu.type === 'boost') score += 8;
      else                     score -= 3;
    }

    return score;
  }


  _evaluate(player) {
    if (CONFIG.EVALUATION_CACHE) {
      const evalHash = `${player}:${this._hashGameState()}`;
      if (this.evalCache.has(evalHash)) return this.evalCache.get(evalHash);
    }

    const score = this._evaluatePosition(player);

    if (CONFIG.EVALUATION_CACHE && this.evalCache.size < 5000) {
      const evalHash = `${player}:${this._hashGameState()}`;
      this.evalCache.set(evalHash, score);
    }

    return score;
  }


  _evaluatePosition(player) {
    const enemy = player === this.pid ? this.enemy : this.pid;
    let score   = 0;

    const counts = game.getCellCounts();
    score += (counts[player] - counts[enemy]) * 3;

    const myUnits = game.player(player).units;
    const enUnits = game.player(enemy).units;
    score += (myUnits.length - enUnits.length) * 20;

    for (const u of myUnits) score += u.atk + u.def;
    for (const u of enUnits) score -= u.atk + u.def;

    for (const u of myUnits) {
      score += (player === 2 ? u.row : 7 - u.row) * 2;
    }

    return score;
  }


  _isTerminal() {
    const counts = game.getCellCounts();
    if (counts[1] > 32 || counts[2] > 32) return true;
    // Use .units.length — unitCount may be stale during simulation
    if (game.player(1).units.length === 0 || game.player(2).units.length === 0) return true;
    return false;
  }


  _applyPlan(unit, dest) {
    const oldSq = game.board.sq(unit.row, unit.col);
    const newSq = game.board.sq(dest.r, dest.c);

    if (dest.isAttack) {
      const aMod = game.getMod(unit.id).atkMod;
      for (const def of [...newSq.enemiesOf(unit.player)]) {
        const dMod = game.getMod(def.id).defMod;
        if (this._winProbability(unit.atk + aMod, def.def + dMod) > 0.5) {
          newSq.removeUnit(def.id);
          // Remove from player's units array directly — avoids side-effects of
          // killUnit() that we can't snapshot (like animating UI or emitting events)
          const enemyPlayer = game.player(def.player);
          enemyPlayer.units = enemyPlayer.units.filter(u => u.id !== def.id);
        }
      }
      if (!newSq.hasEnemy(unit.player) && !dest.isRanged) {
        oldSq.removeUnit(unit.id);
        newSq.addUnit(unit);
        unit.row = dest.r;
        unit.col = dest.c;
        game.cellOwnership.set(`${dest.r},${dest.c}`, unit.player);
      }
    } else {
      oldSq.removeUnit(unit.id);
      newSq.addUnit(unit);
      unit.row = dest.r;
      unit.col = dest.c;
      game.cellOwnership.set(`${dest.r},${dest.c}`, unit.player);
    }

    return true;
  }


  _hashGameState() {
    let hash = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq    = game.board.sq(r, c);
        const owner = game.cellOwnership.get(`${r},${c}`) ?? 0;
        hash += owner;
        for (const u of sq.units) hash += `${u.id}${u.player}`;
      }
    }
    return hash;
  }


  /**
   * Snapshot the game state without cloning unit objects.
   *
   * The previous approach used `{ ...u }` which creates plain objects that
   * lose all prototype methods (getValidMoves, getRangedAttacks, etc.).
   * As soon as the search restored state and tried to call those methods on
   * depth > 1, it crashed or silently returned nothing.
   *
   * Instead we store:
   *   - live unit references + their mutable scalar fields (row, col)
   *   - shallow copies of each player's units array (to restore after kills)
   *   - shallow copies of each board cell's units array
   *   - a copy of cellOwnership
   *
   * Restoration patches row/col back onto the live objects and swaps the
   * array references — so every unit retains its prototype chain throughout.
   */
  _cloneGameState() {
    try {
      // 1. Board cells — store the current unit-reference arrays
      const boardSnapshot = [];
      for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++)
          boardSnapshot.push({ r, c, units: [...game.board.sq(r, c).units] });

      // 2. Per-unit position snapshot: id → { live ref, row, col }
      const unitPositions = new Map();
      for (const pl of game.p)
        for (const u of pl.units)
          unitPositions.set(u.id, { unit: u, row: u.row, col: u.col });

      // 3. Player unit lists (live refs — lets us restore killed units)
      return {
        boardSnapshot,
        unitPositions,
        cellOwnership : new Map(game.cellOwnership),
        p1Units       : [...game.p[0].units],
        p2Units       : [...game.p[1].units],
      };
    } catch {
      return null;
    }
  }


  /**
   * Restore state by patching live unit objects in-place.
   * Never replaces unit objects — only mutates their scalar fields.
   */
  _restoreGameState(snapshot) {
    // 1. Restore board cell unit arrays
    for (const { r, c, units } of snapshot.boardSnapshot)
      game.board.sq(r, c).units = units;

    // 2. Restore row/col on the actual live unit objects
    for (const [, { unit, row, col }] of snapshot.unitPositions) {
      unit.row = row;
      unit.col = col;
    }

    // 3. Restore player unit lists (brings back any units killed during simulation)
    game.p[0].units = snapshot.p1Units;
    game.p[1].units = snapshot.p2Units;

    // 4. Restore territory
    game.cellOwnership = new Map(snapshot.cellOwnership);
  }


  _winProbability(atk, def) {
    let wins = 0;
    for (let a = 1; a <= 6; a++)
      for (let d = 1; d <= 6; d++)
        if (a + atk > d + def) wins++;
    return wins / 36;
  }
}

// Instance singleton
const minimax = new MinimaxEngine(2);

function getBestMove(units) {
  const best = minimax.decide(units);
  if (!best) return [];

  // The search may have swapped game.p[1].units several times during
  // simulation. Re-resolve the unit by id so we always hand index.js
  // a reference that actually lives in the current player array —
  // otherwise game.selectUnit() won't find it.
  const liveUnit = game.player(2).units.find(u => u.id === best.unit.id);
  if (!liveUnit) return [];

  return [{ unit: liveUnit, dest: best.dest }];
}