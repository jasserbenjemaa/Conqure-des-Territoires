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
let vsAI       = false;
let aiThinking = false;

function autoPlaceAI() {
  game.state = "PLACE_2";
  const typesList  = ["cavalier", "tank", "soldat", "soldat", "cavalier"];
  const deployRows = game.player(2).deployRows();
  let placed = 0;
  outer:
  for (const r of deployRows) {
    for (let c = 0; c < 8; c++) {
      if (placed >= 5) break outer;
      const sq = game.board.sq(r, c);
      if (sq.units.length > 0) continue;
      game.chosenType = typesList[placed];
      if (game.tryPlace(r, c)) placed++;
    }
  }
}

function maybeRunAI() {
  if (!vsAI || aiThinking || game.state !== "BATTLE_2") return;
  aiThinking = true;
  setTimeout(() => {
    const plans = getBestMove(game.player(2).units);

    const plan = plans[0];
    game.selectUnit(plan.unit);
    renderAll();
    setTimeout(() => {
      const result = game.tryMove(plan.dest.r, plan.dest.c);
      aiThinking = false;
      if (!result) { game.clearSel(); renderAll(); return; }
      if (result.kind === "combat") {
        launchCombat(result.attacker, result.sq, result.toR, result.toC, result.ranged || false);
      } else {
        renderAll();
      }
    }, 600);
  }, 500);
}

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

  if (game.isBattling() && game.selectedUnit) { //moch attack battling ya3ni bda tor7
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
    if (game.selectedUnit && game.selectedUnit.id === unit.id) game.clearSel();//toggle unit selection
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

/* ── Exit button ── */
const exitBtn        = document.getElementById("exit-btn");
const exitModal      = document.getElementById("exit-modal");
const exitConfirmBtn = document.getElementById("exit-confirm-btn");
const exitCancelBtn  = document.getElementById("exit-cancel-btn");

function showExitBtn() 
{ exitBtn.classList.remove("hidden"); 
  helpBtn.classList.remove("hidden"); 
}
function hideExitBtn() 
{ exitBtn.classList.add("hidden");
  helpBtn.classList.add("hidden");
}

exitBtn.addEventListener("click", () => {
  exitModal.classList.add("show");
});
exitCancelBtn.addEventListener("click", () => {
  exitModal.classList.remove("show");
});
exitConfirmBtn.addEventListener("click", () => {
  exitModal.classList.remove("show");
  doRestart();
});
/* ── Help / Guide modal ── */
const helpBtn   = document.getElementById("help-btn");
const helpModal = document.getElementById("help-modal");

helpBtn.addEventListener("click", () => {
  helpModal.style.display = "flex";
});
document.getElementById("help-close-btn").addEventListener("click", () => {
  helpModal.style.display = "none";
});
helpModal.addEventListener("click", e => {
  if (e.target === helpModal) helpModal.style.display = "none";
});
/* ── Initiative dice (qui commence ?) ── */
const initiativeOverlay  = document.getElementById("initiative-overlay");
const initFace1          = document.getElementById("init-face-1");
const initFace2          = document.getElementById("init-face-2");
const initiativeVerdict  = document.getElementById("initiative-verdict");
const initiativeRollBtn  = document.getElementById("initiative-roll-btn");
const initiativeStartBtn = document.getElementById("initiative-start-btn");
const initiativeSub      = document.getElementById("initiative-sub");
const initLabel1         = document.getElementById("init-label-1");
const initLabel2         = document.getElementById("init-label-2");

let initiativeWinner = 1; // joueur qui commencera la bataille

function showInitiativeOverlay(isVsAI) {
  initLabel1.textContent = "Joueur 1";
  initLabel2.textContent = isVsAI ? "IA" : "Joueur 2";
  initFace1.textContent  = "?";
  initFace2.textContent  = "?";
  initFace1.className    = "dice-face";
  initFace2.className    = "dice-face";
  initiativeVerdict.textContent  = "";
  initiativeSub.textContent      = "Lancez les dés pour déterminer qui commence !";
  initiativeRollBtn.style.display  = "inline-block";
  initiativeStartBtn.style.display = "none";
  initiativeOverlay.classList.add("show");
}

initiativeRollBtn.addEventListener("click", () => {
  initiativeRollBtn.disabled = true;

  // Animation de "rolling" sur les deux dés
  initFace1.className = "dice-face rolling";
  initFace2.className = "dice-face rolling";
  initFace1.textContent = "?";
  initFace2.textContent = "?";

  setTimeout(() => {
    let roll1 = d6();
    let roll2 = d6();

    // Relance automatique en cas d'égalité jusqu'à départage
    while (roll1 === roll2) {
      roll1 = d6();
      roll2 = d6();
    }

    initFace1.className    = "dice-face rolling p1";
    initFace2.className    = "dice-face rolling p2";
    initFace1.textContent  = roll1;
    initFace2.textContent  = roll2;

    initiativeWinner = roll1 > roll2 ? 1 : 2;

    const name1 = initLabel1.textContent;
    const name2 = initLabel2.textContent;

    if (roll1 > roll2) {
      initiativeVerdict.innerHTML = `<span style="color:#3498db">🎲 ${name1} commence ! (${roll1} vs ${roll2})</span>`;
    } else {
      initiativeVerdict.innerHTML = `<span style="color:#e74c3c">🎲 ${name2} commence ! (${roll2} vs ${roll1})</span>`;
    }

    initiativeSub.textContent        = "Le dé le plus élevé remporte l'initiative.";
    initiativeRollBtn.style.display  = "none";
    initiativeStartBtn.style.display = "inline-block";
    initiativeRollBtn.disabled       = false;
  }, 600);
});

initiativeStartBtn.addEventListener("click", () => {
  initiativeOverlay.classList.remove("show");
  // Démarre la bataille avec le bon joueur
  game.state = initiativeWinner === 1 ? "BATTLE_1" : "BATTLE_2";
  game.spawnPowerups(5);
  renderAll();
});

/* ── UI flow ── */
playBtn.addEventListener("click", () => {
  vsAI = false;
  banner.classList.remove("visible");
  playBtnDiv.classList.add("hidden");
  moveBoard(350);
  setTimeout(() => toggleImgs(imgsBlue, true), 1000);
  game.state = "PLACE_1";
  showExitBtn();
  renderAll();
});

aiPlayBtn.addEventListener("click", () => {
  vsAI = true;
  banner.classList.remove("visible");
  playBtnDiv.classList.add("hidden");
  moveBoard(350);
  setTimeout(() => toggleImgs(imgsBlue, true), 1000);
  game.state = "PLACE_1";
  showExitBtn();
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
      // Lance le dé d'initiative avant la bataille
      showInitiativeOverlay(true);
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
    // Lance le dé d'initiative avant la bataille
    showInitiativeOverlay(false);
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

  el("dice-p1-label").textContent = `${res.attacker.player === 1 ? "Joueur 1" : "Joueur 2"} — ${res.attacker.getName()}`;
  el("dice-p2-label").textContent = `${res.defender.player === 1 ? "Joueur 1" : "Joueur 2"} — ${res.defender.getName()}`;

  info.textContent = res.ranged
    ? `${res.attacker.getName()} attaque à distance ${res.defender.getName()}${res.distPenalty ? ` (−${res.distPenalty} ATQ dist)` : ""}`
    : `${res.attacker.getName()} affronte ${res.defender.getName()}`;

  face1.textContent = res.baseA;
  face2.textContent = res.baseD;

  stat1.textContent = res.distPenalty > 0
    ? `+ ⚔ ATQ: ${res.effectiveAtk} (${res.attacker.atk}−${res.distPenalty} dist)`
    : `+ ⚔ ATQ: ${res.effectiveAtk}`;
  stat2.textContent = `+ 🛡 DÉF: ${res.defenderDef}`;

  mod1.className = mod2.className = "dice-modifier";
  mod1.textContent = mod2.textContent = "";
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
  toggleOverlay("dice-overlay", true);
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
  initiativeOverlay.classList.remove("show");
  exitModal.classList.remove("show");
  document.querySelectorAll(".unit-type-btn").forEach(b => b.classList.remove("active"));
  banner.classList.add("visible");
  playBtnDiv.classList.remove("hidden");
  moveBoard(0);
  toggleImgs(imgsBlue, false);
  toggleImgs(imgsRed,  false);
  hideExitBtn();
  renderAll();
}

document.getElementById("restart-btn-win").addEventListener("click", doRestart);

/* ── Boot ── */
banner.classList.add("visible");
renderAll();