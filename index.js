/* ── DOM refs ── */
const gameBoard    = document.getElementById("gameboard");
const banner       = document.getElementById("banner");
const playBtn      = document.getElementById("playBtn");
const imgsBlue     = document.querySelectorAll(".img-wrap-blue");
const imgsRed      = document.querySelectorAll(".img-wrap-red");
const checkBtnBlue = document.getElementById("check-btn-blue");
const checkBtnRed  = document.getElementById("check-btn-red");
const crossBtnBlue = document.getElementById("cross-btn-blue");
const crossBtnRed  = document.getElementById("cross-btn-red");
const playBtnDiv   = document.querySelector(".play-btn-div");
const aiPlayBtn    = document.getElementById("aiPlayBtn");

/* ── Unit stats ── */
function updateUnitStats(unit, atk, def) {
  document.querySelectorAll(`.${unit}-atk-stats`).forEach(el => el.textContent = `${atk} ATK`);
  document.querySelectorAll(`.${unit}-def-stats`).forEach(el => el.textContent = `${def} DEF`);
}
const units = [new Soldat(), new Cavalier(), new Tank()];
units.forEach(u => updateUnitStats(u.type, u.atk, u.def));

/* ── Helpers ── */
function toggleImgs(imgs, show) {
  imgs.forEach((img, i) => {
    img.style.transitionDelay = `${i * 100}ms`;
    img.classList.toggle("visible", show);
  });
}

function moveBoard(offset) {
  gameBoard.style.transform = offset === 0 ? "translateX(0)"
    : `translateX(${offset}px)`;
}

function toggleOverlay(id, show) {
  document.getElementById(id).classList.toggle("show", show);
}

/* ── Game instance ── */
const game = new Game();
let combatQueue = [];
let combatIdx   = 0;

/* ── AI ── */
// autoPlaceAI() and maybeRunAI() are defined in manager.js.
// This file only owns the runtime flags that both functions read.
let vsAI       = false;
let aiThinking = false;

/* ── Render ── */
function renderBoard() {
  const boardEl  = document.getElementById("gameboard");
  boardEl.innerHTML = "";
  const pid      = game.currentPlayerId();
  const selUnit  = game.selectedUnit;
  const moveSet  = new Set(game.validMoves.map(([r, c]) => `${r},${c}`));
  const rangedSet = new Set((game.validRangedAttacks || []).map(([r, c]) => `${r},${c}`));

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const key  = `${r},${c}`;
      const cell = document.createElement("div");
      cell.className = "cell";

      const owner = game.cellOwnership.get(key);
      if (owner) {
        const dot = document.createElement("div");
        dot.className = `cell-owner owner-p${owner}`;
        cell.appendChild(dot);
      }

      if (game.isPlacing() && pid && game.player(pid).deployRows().includes(r))
        cell.classList.add(pid === 1 ? "zone-p1" : "zone-p2");

      if (selUnit && selUnit.row === r && selUnit.col === c)
        cell.classList.add("sel-cell");

      if (moveSet.has(key)) {
        const sq = game.board.sq(r, c);
        cell.classList.add(sq.hasEnemy(pid) ? "can-attack" : "can-move");
      }

      if (rangedSet.has(key)) cell.classList.add("can-ranged");

      cell.addEventListener("click", () => onCellClick(r, c));

      const sq = game.board.sq(r, c);
      for (const unit of sq.units) {
        const tok = document.createElement("div");
        tok.className = `unit-token p${unit.player}`;
        if (selUnit && selUnit.id === unit.id) tok.classList.add("selected-unit");
        tok.textContent = unit.getLabel();
        tok.title = `${unit.getName()} | ATK ${unit.atk} · DEF ${unit.def}`;

        const mod = game.unitMods.get(unit.id);
        if (mod) {
          const badge = document.createElement("span");
          badge.className = "unit-badge";
          badge.textContent = mod.emoji;
          tok.appendChild(badge);
        }

        tok.addEventListener("click", e => { e.stopPropagation(); onUnitClick(unit); });
        cell.appendChild(tok);
      }

      if (game.powerups.has(key)) {
        const pu   = game.powerups.get(key);
        const puEl = document.createElement("div");
        puEl.className   = `powerup-token ${pu.type}`;
        puEl.textContent = pu.emoji;
        puEl.title       = pu.desc;
        cell.appendChild(puEl);
      }

      boardEl.appendChild(cell);
    }
  }
}

function renderTerritoryStats() {
  const TOTAL = 64;
  let p1 = 0, p2 = 0;
  game.cellOwnership.forEach(o => { if (o === 1) p1++; else if (o === 2) p2++; });

  for (const [n, count] of [[1, p1], [2, p2]]) {
    const color = n === 1 ? "blue" : "red";
    const pct   = Math.round((count / TOTAL) * 100);
    document.getElementById(`ts-pct-${color}`).textContent   = `${pct}%`;
    document.getElementById(`ts-bar-${color}`).style.width   = `${pct}%`;
    document.getElementById(`ts-count-${color}`).textContent = `${count} / ${TOTAL}`;
  }

  const visible = game.isBattling() || game.state === "OVER";
  document.getElementById("territory-blue").classList.toggle("visible", visible);
  document.getElementById("territory-red").classList.toggle("visible", visible);
}

function renderAll() {
  renderBoard();
  renderTerritoryStats();
  maybeRunAI();
}

/* ── Input handlers ── */
function onCellClick(r, c) {
  if (game.state === "OVER" || combatQueue.length > 0) return;
  if (vsAI && game.state === "BATTLE_2") return;

  if (game.isPlacing()) {
    if (game.tryPlace(r, c)) renderAll();
    return;
  }

  if (game.isBattling() && game.selectedUnit) {
    const result = game.tryMove(r, c);
    if (!result) return;
    if (result.kind === "combat") {
      launchCombat(result.attacker, result.sq, result.toR, result.toC, result.ranged || false);
    } else {
      renderAll();
    }
    return;
  }

  renderAll();
}

function onUnitClick(unit) {
  if (game.state === "OVER" || combatQueue.length || !game.isBattling()) return;
  if (vsAI && game.state === "BATTLE_2") return;
  if (unit.player === game.currentPlayerId()) {
    if (game.selectedUnit && game.selectedUnit.id === unit.id) game.clearSel();
    else game.selectUnit(unit);
    renderAll();
  }
}

/* Unit-type selector buttons */
document.querySelectorAll(".unit-type-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".unit-type-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    game.chosenType = btn.dataset.type;
  });
});

/* ── UI flow ── */
playBtn.addEventListener("click", () => {
  vsAI = false;
  banner.classList.remove("visible");
  playBtnDiv.classList.add("hidden");
  moveBoard(350);
  setTimeout(() => toggleImgs(imgsBlue, true), 1000);
  game.state = "PLACE_1";
  renderAll();
});

aiPlayBtn.addEventListener("click", () => {
  vsAI = true;
  banner.classList.remove("visible");
  playBtnDiv.classList.add("hidden");
  moveBoard(350);
  setTimeout(() => toggleImgs(imgsBlue, true), 1000);
  game.state = "PLACE_1";
  renderAll();
});

checkBtnBlue.addEventListener("click", () => {
  if (game.state !== "PLACE_1") return;
  if (!game.hasPlaced5(1)) { alert("Le Joueur 1 doit placer exactement 5 unités avant de continuer !"); return; }
  toggleImgs(imgsBlue, false);
  if (vsAI) {
    setTimeout(() => {
      autoPlaceAI();
      moveBoard(0);
      game.state = "BATTLE_1";
      game.spawnPowerups(5);
      renderAll();
    }, 1000);
  } else {
    setTimeout(() => moveBoard(-350), 1000);
    setTimeout(() => toggleImgs(imgsRed, true), 2000);
    game.state = "PLACE_2";
    renderAll();
  }
});

crossBtnBlue.addEventListener("click", () => {
  if (game.state !== "PLACE_1") return;
  game.resetPlacement(1);
  renderAll();
});

checkBtnRed.addEventListener("click", () => {
  if (game.state !== "PLACE_2") return;
  if (!game.hasPlaced5(2)) { alert("Le Joueur 2 doit placer exactement 5 unités avant de continuer !"); return; }
  toggleImgs(imgsRed, false);
  setTimeout(() => {
    moveBoard(0);
    game.state = "BATTLE_1";
    game.spawnPowerups(5);
    renderAll();
  }, 1000);
});

crossBtnRed.addEventListener("click", () => {
  if (game.state !== "PLACE_2") return;
  game.resetPlacement(2);
  renderAll();
});

/* ── Dice combat ── */
function launchCombat(attacker, sq, toR, toC, ranged = false) {
  const enemies = sq.enemiesOf(attacker.player);
  let effectiveAtk = attacker.atk, distPenalty = 0;
  if (ranged && attacker.type === "tank") {
    distPenalty  = Math.max(0, manhattan(attacker.row, attacker.col, toR, toC) - 1);
    effectiveAtk = Math.max(0, attacker.atk - distPenalty);
  }
  const aMods = game.getMod(attacker.id);
  combatQueue = enemies.map(defender => {
    const dMods  = game.getMod(defender.id);
    const baseA  = d6(), baseD = d6();
    const aTotal = baseA + effectiveAtk + aMods.atkMod;
    const dTotal = baseD + defender.def + dMods.defMod;
    return { attacker, defender, sq, toR, toC, baseA, baseD, effectiveAtk,
             defenderDef: defender.def, aMod: aMods.atkMod, dMod: dMods.defMod,
             aTotal, dTotal, atkWins: aTotal > dTotal, ranged, distPenalty };
  });
  combatIdx = 0;
  showCombat();
}

function showCombat() {
  const res   = combatQueue[combatIdx];
  const el    = id => document.getElementById(id);
  const face1 = el("dice-face-1"), face2 = el("dice-face-2");
  const info  = el("dice-info"),   verd  = el("dice-verdict");
  const btn   = el("dice-continue");
  const mod1  = el("dice-mod-1"),  mod2  = el("dice-mod-2");
  const stat1 = el("dice-stat-1"), stat2 = el("dice-stat-2");
  const tot1  = el("dice-total-1"), tot2 = el("dice-total-2");

  face1.className = `dice-face p${res.attacker.player}`;
  face2.className = `dice-face p${res.defender.player}`;

  el("dice-p1-label").textContent = `${res.attacker.player === 1 ? "Joueur 1" : "IA"} — ${res.attacker.getName()}`;
  el("dice-p2-label").textContent = `${res.defender.player === 1 ? "Joueur 1" : "IA"} — ${res.defender.getName()}`;

  info.textContent = res.ranged
    ? `${res.attacker.getName()} attaque à distance ${res.defender.getName()}${res.distPenalty ? ` (−${res.distPenalty} ATQ dist)` : ""}`
    : `${res.attacker.getName()} affronte ${res.defender.getName()}`;

  [face1, face2].forEach(f => f.textContent = "?");
  [verd, stat1, stat2, mod1, mod2, tot1, tot2].forEach(e => e.textContent = "");
  mod1.className = mod2.className = "dice-modifier";
  btn.disabled = true;

  toggleOverlay("dice-overlay", true);

  setTimeout(() => { face1.textContent = res.baseA; face1.classList.remove("rolling"); void face1.offsetWidth; face1.classList.add("rolling"); }, 150);
  setTimeout(() => { face2.textContent = res.baseD; face2.classList.remove("rolling"); void face2.offsetWidth; face2.classList.add("rolling"); }, 400);

  setTimeout(() => {
    stat1.textContent = res.distPenalty > 0
      ? `+ ⚔ ATQ: ${res.effectiveAtk} (${res.attacker.atk}−${res.distPenalty} dist)`
      : `+ ⚔ ATQ: ${res.effectiveAtk}`;
    stat2.textContent = `+ 🛡 DÉF: ${res.defenderDef}`;

    if (res.aMod !== 0) {
      const mu = game.unitMods.get(res.attacker.id);
      mod1.textContent = res.aMod > 0 ? `${mu?.emoji ?? "⚡"} ATQ +${res.aMod} bonus` : `${mu?.emoji ?? "💀"} ATQ ${res.aMod} malédiction`;
      mod1.className = `dice-modifier ${res.aMod > 0 ? "buff" : "debuff"}`;
    }

    if (res.dMod !== 0) {
      const mu = game.unitMods.get(res.defender.id);
      mod2.textContent = res.dMod > 0 ? `${mu?.emoji ?? "✨"} DÉF +${res.dMod} bonus` : `${mu?.emoji ?? "🌑"} DÉF ${res.dMod} malédiction`;
      mod2.className = `dice-modifier ${res.dMod > 0 ? "buff" : "debuff"}`;
    }

    tot1.textContent = `= ${res.aTotal}`;
    tot2.textContent = `= ${res.dTotal}`;
    tot1.style.color = res.atkWins ? "#32dc78" : "#e74c3c";
    tot2.style.color = res.atkWins ? "#e74c3c" : "#32dc78";

    const winCol = res.atkWins ? res.attacker.player : res.defender.player;
    const col    = winCol === 1 ? "#3498db" : "#e74c3c";
    verd.innerHTML = res.atkWins
      ? `<span style="color:${col}">⚔ L'attaquant gagne ! (${res.aTotal} vs ${res.dTotal})</span>`
      : `<span style="color:${col}">🛡 Le défenseur tient ! (${res.dTotal} vs ${res.aTotal})</span>`;

    btn.disabled = false;
    btn.textContent = combatIdx + 1 < combatQueue.length ? "Combat suivant" : "Terminer";
  }, 800);
}

function advanceCombat() {
  combatIdx++;
  if (combatIdx < combatQueue.length) {
    showCombat();
  } else {
    toggleOverlay("dice-overlay", false);
    const { attacker, sq, toR, toC, ranged } = combatQueue[0];
    game.applyResults(attacker, sq, toR, toC, combatQueue, ranged || false);
    combatQueue = [];
    combatIdx   = 0;
    renderAll();
  }
}

/* ── Win overlay ── */
function showWinOverlay(playerName, reason) {
  document.getElementById("win-sub-text").textContent = `${playerName} — ${reason}`;
  toggleOverlay("win-overlay", true);
}

/* ── Restart ── */
function doRestart() {
  vsAI = false;
  aiThinking = false;
  game.reset();
  combatQueue = [];
  combatIdx   = 0;
  toggleOverlay("dice-overlay", false);
  toggleOverlay("win-overlay",  false);
  document.querySelectorAll(".unit-type-btn").forEach(b => b.classList.remove("active"));
  banner.classList.add("visible");
  playBtnDiv.classList.remove("hidden");
  moveBoard(0);
  toggleImgs(imgsBlue, false);
  toggleImgs(imgsRed,  false);
  renderAll();
}

document.getElementById("restart-btn-win").addEventListener("click", doRestart);

/* ── Boot ── */
banner.classList.add("visible");
renderAll();