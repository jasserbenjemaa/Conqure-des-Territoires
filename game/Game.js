/* ── Utilities ── */
function d6() {
  return Math.floor(Math.random() * 6) + 1;
}
function manhattan(r1, c1, r2, c2) {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2);
}

class Game {
  constructor() {
    this._init();
  }

  _init() {
    this.board = new Board();
    this.p = [new Player(1), new Player(2)];
    this.state = "START"; // START → PLACE_1 → PLACE_2 → BATTLE_1 ↔ BATTLE_2 → OVER
    this.selectedUnit = null;
    this.validMoves = [];
    this.validRangedAttacks = [];
    this.uidSeq = 0;
    this.chosenType = "soldat";
    this.cellOwnership = new Map(); // "r,c" → player id
    this.powerups = new Map(); // "r,c" → powerup def
    this.unitMods = new Map(); // unit.id → { atkMod, defMod, emoji, turns }
  }

  reset() {
    this._init();
  }
  player(id) {
    return this.p[id - 1];
  }

  /* ── Power-up catalogue ── */
  static POWERUP_DEFS = [
    {
      type: "boost",
      emoji: "⚡",
      atkMod: +2,
      defMod: 0,
      turns: 2,
      desc: "ATK +2 for 2 turns",
    },
    {
      type: "boost",
      emoji: "🔥",
      atkMod: +1,
      defMod: +1,
      turns: 3,
      desc: "ATK & DEF +1 for 3 turns",
    },
    {
      type: "curse",
      emoji: "💀",
      atkMod: -1,
      defMod: -1,
      turns: 2,
      desc: "ATK & DEF −1 for 2 turns",
    },
    {
      type: "curse",
      emoji: "🌑",
      atkMod: 0,
      defMod: -2,
      turns: 2,
      desc: "DEF −2 for 2 turns",
    },
    {
      type: "boost",
      emoji: "✨",
      atkMod: 0,
      defMod: +2,
      turns: 2,
      desc: "DEF +2 for 2 turns",
    },
    {
      type: "curse",
      emoji: "🕸",
      atkMod: -1,
      defMod: 0,
      turns: 3,
      desc: "ATK −1 for 3 turns",
    },
    {
      type: "boost",
      emoji: "🌟",
      atkMod: +2,
      defMod: +1,
      turns: 2,
      desc: "ATK +2, DEF +1 for 2 turns",
    },
    {
      type: "curse",
      emoji: "🩸",
      atkMod: -2,
      defMod: 0,
      turns: 2,
      desc: "ATK −2 for 2 turns",
    },
  ];

  /* Scatter power-ups on empty cells */
  spawnPowerups(count = 4) {
    const empty = [];
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const key = `${r},${c}`;
        if (this.board.sq(r, c).units.length === 0 && !this.powerups.has(key))
          empty.push(key);
      }
    // Fisher-Yates shuffle
    for (let i = empty.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [empty[i], empty[j]] = [empty[j], empty[i]];
    }
    const defs = Game.POWERUP_DEFS;
    for (let i = 0; i < Math.min(count, empty.length); i++) {
      const def = defs[Math.floor(Math.random() * defs.length)];
      this.powerups.set(empty[i], {
        ...def,
        timeLeft: 7 + Math.floor(Math.random() * 7),
      });
    }
  }

  /* Apply power-up to unit stepping on it */
  checkPowerup(unit, r, c) {
    const key = `${r},${c}`;
    if (!this.powerups.has(key)) return;
    const pu = this.powerups.get(key);
    this.powerups.delete(key);
    this.unitMods.set(unit.id, {
      atkMod: pu.atkMod,
      defMod: pu.defMod,
      emoji: pu.emoji,
      turns: pu.turns,
    });
  }

  /* Decrement a unit's modifier after it acts */
  tickMod(unitId) {
    if (!this.unitMods.has(unitId)) return;
    const m = this.unitMods.get(unitId);
    m.turns--;
    if (m.turns <= 0) this.unitMods.delete(unitId);
  }

  /* Decrement every on-board power-up's timer and remove expired ones */
  _tickPowerups() {
    for (const [key, pu] of this.powerups) {
      pu.timeLeft--;
      if (pu.timeLeft <= 0) this.powerups.delete(key);
    }
  }

  getMod(unitId) {
    if (!this.unitMods.has(unitId)) return { atkMod: 0, defMod: 0 };
    return this.unitMods.get(unitId);
  }

  /* ── Territory ── */
  captureCell(r, c, playerId) {
    this.cellOwnership.set(`${r},${c}`, playerId);
  }

  getCellCounts() {
    const counts = { 1: 0, 2: 0 };
    for (const owner of this.cellOwnership.values())
      if (counts[owner] !== undefined) counts[owner]++;
    return counts;
  }

  /* ── State helpers ── */
  currentPlayerId() {
    if (this.state === "PLACE_1" || this.state === "BATTLE_1") return 1;
    if (this.state === "PLACE_2" || this.state === "BATTLE_2") return 2;
    return null;
  }
  isPlacing() {
    return this.state.startsWith("PLACE");
  }
  isBattling() {
    return this.state.startsWith("BATTLE");
  }

  _mkUnit(type, pid) {
    this.uidSeq++;
    if (type === "soldat") return new Soldat(pid, this.uidSeq);
    if (type === "cavalier") return new Cavalier(pid, this.uidSeq);
    if (type === "tank") return new Tank(pid, this.uidSeq);
  }

  /* ── Placement ── */
  static MAX_UNITS = 5;

  hasPlaced5(pid) {
    return this.player(pid).unitsPlaced >= Game.MAX_UNITS;
  }

  tryPlace(r, c) {
    const pid = this.currentPlayerId();
    const pl = this.player(pid);
    if (!pl.deployRows().includes(r) || !pl.canStillPlace) return false;
    if (pl.unitsPlaced >= Game.MAX_UNITS) return false;
    const unit = this._mkUnit(this.chosenType, pid);
    this.board.place(unit, r, c);
    pl.addUnit(unit);
    pl.unitsPlaced++;
    this.captureCell(r, c, pid);
    return true;
  }

  /* Clear a player's placed units (cross button) */
  resetPlacement(pid) {
    const pl = this.player(pid);
    const rows = pl.deployRows();
    for (const r of rows) {
      for (let c = 0; c < 8; c++) {
        const sq = this.board.sq(r, c);
        const mine = [...sq.unitsOf(pid)];
        mine.forEach((u) => sq.removeUnit(u.id));
        this.cellOwnership.delete(`${r},${c}`);
      }
    }
    pl.units = [];
    pl.unitsPlaced = 0;
  }

  /* ── Selection ── */
  selectUnit(unit) {
    if (unit.player !== this.currentPlayerId()) return false;
    this.selectedUnit = unit;
    this.validMoves = unit.getValidMoves();
    this.validRangedAttacks = unit.getRangedAttacks
      ? unit.getRangedAttacks(this.board)
      : [];
    return true;
  }

  clearSel() {
    this.selectedUnit = null;
    this.validMoves = [];
    this.validRangedAttacks = [];
  }

  /* ── Move / Attack — returns result object or null ── */
  tryMove(r, c) {
    if (!this.selectedUnit) return null;
    const ok = this.validMoves.some(([mr, mc]) => mr === r && mc === c);
    const rangedOk = this.validRangedAttacks.some(
      ([mr, mc]) => mr === r && mc === c,
    );
    if (!ok && !rangedOk) return null;

    const attacker = this.selectedUnit;
    const sq = this.board.sq(r, c);
    const isRanged = rangedOk && !ok;
    this.clearSel();

    if (sq.hasEnemy(attacker.player)) {
      // Caller must handle dice UI then call applyResults
      return { kind: "combat", attacker, sq, toR: r, toC: c, ranged: isRanged };
    }

    // Plain move
    this.board.move(attacker, r, c);
    this.captureCell(r, c, attacker.player);
    this.checkPowerup(attacker, r, c);
    this.tickMod(attacker.id);
    if (Math.random() < 0.3 && this.powerups.size < 4) this.spawnPowerups(1);
    if (!this._checkWin()) this._nextTurn();
    return { kind: "move" };
  }

  /* ── Combat resolution (called after dice animation) ── */
  applyResults(attacker, sq, toR, toC, results, ranged = false) {
    let allDead = true;
    for (const res of results) {
      if (res.atkWins) {
        sq.removeUnit(res.defender.id);
        this.player(res.defender.player).killUnit(res.defender.id);
        this.unitMods.delete(res.defender.id); // clean up dead defender's mod
      } else {
        allDead = false;
        this.tickMod(res.defender.id); // tick surviving defender's mod
      }
    }
    if (allDead) {
      this.board.move(attacker, toR, toC);
      this.captureCell(toR, toC, attacker.player);
      this.checkPowerup(attacker, toR, toC);
    }
    this.tickMod(attacker.id);
    if (Math.random() < 0.3 && this.powerups.size < 4) this.spawnPowerups(1);
    if (!this._checkWin()) this._nextTurn();
  }

  /* ── Win: elimination OR >50 % territory (>32 cells) ── */
  _checkWin() {
    for (const pl of this.p) {
      if (pl.unitCount === 0) {
        const winner = this.p.find((p) => p.id !== pl.id);
        this.state = "OVER";
        showWinOverlay(
          winner.name,
          "Toutes les unités ennemies ont été détruites !",
        );
        return true;
      }
    }
    const counts = this.getCellCounts();
    for (const pl of this.p) {
      if (counts[pl.id] > 32) {
        this.state = "OVER";
        showWinOverlay(pl.name, `Contrôle ${counts[pl.id]} / 64 cases !`);
        return true;
      }
    }
    return false;
  }

  _nextTurn() {
    this._tickPowerups();
    if (this.state === "BATTLE_1") this.state = "BATTLE_2";
    else if (this.state === "BATTLE_2") this.state = "BATTLE_1";
  }
}