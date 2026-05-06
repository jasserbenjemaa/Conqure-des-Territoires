/**
 * IA NIVEAU 3 — MINIMAX AVEC ÉLAGAGE α-β + OPTIMISATIONS
 * Comportement: stratégique, calcul profond, déterministe
 *
 * Adapté pour Board.js / Game.js :
 *   - les imports remplacés par des méthodes privées inline
 *   - la structure, les noms et l'algorithme sont intacts
 */

// Configuration du niveau Hard
const CONFIG = {
  MAX_DEPTH: 3,
  TIME_LIMIT_MS: 150,
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

  /**
   * Point d'entrée principal: décide du meilleur mouvement
   * @param {Array} units - Unités IA disponibles
   * @returns {Object|null} Meilleur mouvement ou null
   */
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
      if (timeElapsed > CONFIG.TIME_LIMIT_MS * 0.8) break;

      const result = this._alphaBeta(depth, -Infinity, Infinity, true, this.pid);

      if (result.score > bestScore && result.move) {
        bestScore = result.score;
        bestPlan  = result.move;
        this.bestMoveFound = bestPlan;
      }

      if (bestScore > 1000 || bestScore < -1000) break;
      depth++;
    }

    console.log(`[AI-Hard] Depth:${depth - 1}, Nodes:${this.nodesEvaluated}, Time:${(performance.now() - this.startTime).toFixed(0)}ms`);
    return bestPlan;
  }

  /**
   * Minimax avec élagage α-β
   * @private
   */
  _alphaBeta(depth, alpha, beta, isMaximizing, currentPlayer) {
    // ⏱️ Time cutoff
    if (performance.now() - this.startTime > CONFIG.TIME_LIMIT_MS) {
      return { score: this._evaluate(currentPlayer), move: this.bestMoveFound };
    }

    // 🎯 Terminal ou profondeur max
    if (depth === 0 || this._isTerminal()) {
      return { score: this._evaluate(currentPlayer), move: null };
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
      return { score: this._evaluate(currentPlayer), move: null };
    }

    // 🎯 Génération et TRI des coups (Move Ordering)
    const candidates        = this._generateCandidates(availableUnits, currentPlayer, isMaximizing);
    const limitedCandidates = candidates.slice(0, CONFIG.BRANCH_LIMIT);

    if (limitedCandidates.length === 0) {
      return { score: this._evaluate(currentPlayer), move: null };
    }

    let bestMove = null;
    let value    = isMaximizing ? -Infinity : Infinity;

    for (const plan of limitedCandidates) {
      const snapshot = this._cloneGameState();
      if (!snapshot) continue;

      // Applique le coup
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

  /**
   * Génère et trie les coups candidats (Move Ordering)
   * @private
   */
  _generateCandidates(units, player, isMaximizing) {
    const candidates = [];

    for (const unit of units) {
      // getAllReachableForUnit → getValidMoves() + getRangedAttacks()
      const moves  = unit.getValidMoves();
      const ranged = unit.getRangedAttacks ? unit.getRangedAttacks(game.board) : [];

      const allDests = [
        ...moves .map(([r, c]) => ({ r, c, isAttack: game.board.sq(r, c).hasEnemy(unit.player), isRanged: false })),
        ...ranged.map(([r, c]) => ({ r, c, isAttack: true,                                       isRanged: true  })),
      ].slice(0, 8); // limite comme dans l'original

      for (const dest of allDests) {
        const cell = game.board.sq(dest.r, dest.c);

        // Score rapide pour tri
        let score = this._quickScore(unit, dest, cell, player, isMaximizing);

        // Bonus move ordering: attaques et captures en premier
        if (dest.isAttack) score *= CONFIG.MOVE_ORDERING_BONUS;
        const cellOwner = game.cellOwnership.get(`${dest.r},${dest.c}`);
        if (!cellOwner || cellOwner !== player) score *= CONFIG.MOVE_ORDERING_BONUS;

        candidates.push({ unit, dest, score });
      }
    }

    // Tri pour Move Ordering
    return candidates.sort((a, b) =>
      isMaximizing ? b.score - a.score : a.score - b.score
    );
  }

  /**
   * Score rapide pour tri des coups (pas une évaluation complète)
   * @private
   */
  _quickScore(unit, dest, cell, player) {
    let score = 0;

    if (dest.isAttack) {
      const aMod = game.getMod(unit.id).atkMod;
      for (const def of cell.enemiesOf(unit.player)) {
        const dMod = game.getMod(def.id).defMod;
        // calculateWinProbability → _winProbability
        const prob = this._winProbability(unit.atk + aMod, def.def + dMod);
        score += prob > 0.5 ? 10 : -5;
      }
    }

    const cellOwner = game.cellOwnership.get(`${dest.r},${dest.c}`);
    if (!cellOwner || cellOwner !== player) score += 5;

    // Power-up awareness (remplace BONUS_ATK / BONUS_DEF / TRAP)
    const key = `${dest.r},${dest.c}`;
    if (game.powerups.has(key)) {
      const pu = game.powerups.get(key);
      if (pu.type === 'boost') score += 3;
      else                     score -= 8; // curse = TRAP équivalent
    }

    return score;
  }

  /**
   * Fonction d'évaluation heuristique (déterministe)
   * @private
   */
  _evaluate(player) {
    // ♻️ Cache évaluation
    if (CONFIG.EVALUATION_CACHE) {
      const evalHash = `${player}:${this._hashGameState()}`;
      if (this.evalCache.has(evalHash)) return this.evalCache.get(evalHash);
    }

    // evaluatePosition → _evaluatePosition
    const score = this._evaluatePosition(player);

    if (CONFIG.EVALUATION_CACHE && this.evalCache.size < 5000) {
      const evalHash = `${player}:${this._hashGameState()}`;
      this.evalCache.set(evalHash, score);
    }

    return score;
  }

  /**
   * Remplace evaluatePosition() de heuristics.js
   * @private
   */
  _evaluatePosition(player) {
    const enemy = player === this.pid ? this.enemy : this.pid;
    let score   = 0;

    // Territoire
    const counts = game.getCellCounts();
    score += (counts[player] - counts[enemy]) * 3;

    // Nombre d'unités
    const myUnits = game.player(player).units;
    const enUnits = game.player(enemy).units;
    score += (myUnits.length - enUnits.length) * 20;

    // Force de combat
    for (const u of myUnits) score += u.atk + u.def;
    for (const u of enUnits) score -= u.atk + u.def;

    // Avance vers l'ennemi
    for (const u of myUnits) {
      score += (player === 2 ? u.row : 7 - u.row) * 2;
    }

    return score;
  }

  /**
   * Vérifie conditions de victoire/défaite
   * @private
   */
  _isTerminal() {
    const counts = game.getCellCounts();
    if (counts[1] > 32 || counts[2] > 32) return true;
    if (game.player(1).unitCount === 0 || game.player(2).unitCount === 0) return true;
    return false;
  }

  /**
   * Applique un plan sur l'état courant (pour simulation)
   * Remplace la version originale qui utilisait getCell() et game.units (Map)
   * @private
   */
  _applyPlan(unit, dest) {
    const oldSq = game.board.sq(unit.row, unit.col);
    const newSq = game.board.sq(dest.r, dest.c);

    if (dest.isAttack) {
      const aMod = game.getMod(unit.id).atkMod;
      for (const def of [...newSq.enemiesOf(unit.player)]) {
        const dMod = game.getMod(def.id).defMod;
        // Résolution déterministe (prob > 0.5 → victoire)
        if (this._winProbability(unit.atk + aMod, def.def + dMod) > 0.5) {
          newSq.removeUnit(def.id);
          game.player(def.player).killUnit(def.id);
        }
      }
      // L'attaquant avance seulement si la case est libérée ET pas ranged
      if (!newSq.hasEnemy(unit.player) && !dest.isRanged) {
        oldSq.removeUnit(unit.id);
        newSq.addUnit(unit);
        game.cellOwnership.set(`${dest.r},${dest.c}`, unit.player);
      }
    } else {
      oldSq.removeUnit(unit.id);
      newSq.addUnit(unit);
      game.cellOwnership.set(`${dest.r},${dest.c}`, unit.player);
    }

    return true;
  }

  /* ──────────────────────────────────────────────────
     Remplaçants des helpers importés dans l'original
  ────────────────────────────────────────────────── */

  /** Remplace hashGameState() de base.js */
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

  /** Remplace cloneGameState() de base.js */
  _cloneGameState() {
    try {
      const boardSnapshot = [];
      for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++)
          boardSnapshot.push({ r, c, units: [...game.board.sq(r, c).units] });

      const unitPositions = [];
      for (const pl of game.p)
        for (const u of pl.units)
          unitPositions.push({ id: u.id, pid: pl.id, row: u.row, col: u.col });

      return {
        boardSnapshot,
        unitPositions,
        cellOwnership: new Map(game.cellOwnership),
        p1Units: [...game.player(1).units],
        p2Units: [...game.player(2).units],
      };
    } catch {
      return null;
    }
  }

  /** Remplace restoreGameState() de base.js */
  _restoreGameState(snapshot) {
    // Restaure les tableaux d'unités par cellule
    for (const { r, c, units } of snapshot.boardSnapshot)
      game.board.sq(r, c).units = units;

    // Restaure les positions (row/col) de chaque unité
    const allSaved = [...snapshot.p1Units, ...snapshot.p2Units];
    for (const { id, row, col } of snapshot.unitPositions) {
      const unit = allSaved.find(u => u.id === id);
      if (unit) { unit.row = row; unit.col = col; }
    }

    // Restaure les listes d'unités des joueurs
    game.p[0].units = snapshot.p1Units;
    game.p[1].units = snapshot.p2Units;

    // Restaure le territoire
    game.cellOwnership = new Map(snapshot.cellOwnership);
  }

  /**
   * Remplace calculateWinProbability() de base.js
   * P(d6 + atk > d6 + def) — calcul exact
   * @private
   */
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

/**
 * Point d'entrée public pour l'IA Hard
 * @param {Array} units - Unités disponibles
 * @returns {Array} Mouvement unique dans un tableau (compatibilité API)
 */
function getBestMove(units) {
  const best = minimax.decide(units);
  return best ? [best] : [];
}