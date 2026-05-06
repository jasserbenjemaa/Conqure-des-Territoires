/* ── DOM refs ── */
const gameBoard = document.getElementById("gameboard");
const banner = document.getElementById("banner");
const playBtn = document.getElementById("playBtn");
const imgsBlue = document.querySelectorAll(".img-wrap-blue");
const imgsRed = document.querySelectorAll(".img-wrap-red");
const checkBtnBlue = document.getElementById("check-btn-blue");
const checkBtnRed = document.getElementById("check-btn-red");
const crossBtnBlue = document.getElementById("cross-btn-blue");
const crossBtnRed = document.getElementById("cross-btn-red");
const playBtnDiv = document.querySelector(".play-btn-div");

//change the units stats
function updateUnitStats(unit, atk, def) {
    document.querySelectorAll(`.${unit}-atk-stats`).forEach(el => el.textContent = `${atk} ATK`);
    document.querySelectorAll(`.${unit}-def-stats`).forEach(el => el.textContent = `${def} DEF`);
}

// Read directly from the classes — no hardcoding
const units = [new Soldat(), new Cavalier(), new Tank()];
units.forEach(u => updateUnitStats(u.type, u.atk, u.def));

/* ── Panel animations ── */
function showImgs(imgs) {
  imgs.forEach((img, i) => {
    img.style.transitionDelay = `${i * 100}ms`;
    img.classList.add("visible");
  });
}

function hideImgs(imgs) {
  imgs.forEach((img, i) => {
    img.style.transitionDelay = `${i * 100}ms`;
    img.classList.remove("visible");
  });
}

function moveBoardRight() {
  gameBoard.style.transform = "translateX(350px)";
}
function moveBoardLeft() {
  gameBoard.style.transform = "translateX(-350px)";
}
function moveBoardCenter() {
  gameBoard.style.transform = "translateX(0)";
}

/* ── Game instance ── */
const game = new Game();
let combatQueue = [];
let combatIdx = 0;

/* ─────────────────────────────────────────
   AI MODE
───────────────────────────────────────── */
let vsAI      = false;   // true when playing against the AI
let aiThinking = false;  // prevents re-entrant AI calls

/**
 * Auto-place 5 units for the AI (player 2) in its deploy rows.
 * Called once, right after the human confirms his own placement.
 */
function autoPlaceAI() {
  // Temporarily switch to PLACE_2 so tryPlace() targets player 2
  game.state = "PLACE_2";

  const typesList  = ["cavalier", "tank", "soldat", "soldat", "soldat"];
  const deployRows = game.player(2).deployRows();
  let placed = 0;

  outer:
  for (const r of deployRows) {
    for (let c = 0; c < 8; c++) {
      if (placed >= 5) break outer;
      const sq = game.board.sq(r, c);
      if (sq.units.length > 0) continue; // cell already occupied
      game.chosenType = typesList[placed];
      if (game.tryPlace(r, c)) placed++;
    }
  }
}

/**
 * Called after every renderAll() when vsAI is active.
 * Triggers the AI's turn if the current state is BATTLE_2.
 */
function maybeRunAI() {
  if (!vsAI || aiThinking || game.state !== "BATTLE_2") return;

  aiThinking = true;

  // Small delay so the board visually updates before AI "thinks"
  setTimeout(() => {
    const aiUnits = game.player(2).units;
    const plans   = getBestMove(aiUnits); // from hard.js

    if (!plans || plans.length === 0) {
      // AI has no moves — end its turn (fallback)
      aiThinking = false;
      if (typeof game.endTurn === "function") {
        game.endTurn();
        renderAll();
      }
      return;
    }

    const plan = plans[0]; // getBestMove returns an array with one best plan

    // Visually select the AI unit so the player can follow the move
    game.selectUnit(plan.unit);
    renderAll();

    setTimeout(() => {
      const result = game.tryMove(plan.dest.r, plan.dest.c);
      aiThinking = false;

      if (!result) {
        // Move was rejected — clear selection and let turn pass
        game.clearSel();
        renderAll();
        return;
      }

      if (result.kind === "combat") {
        // Reuse the exact same combat overlay the human player sees
        launchCombat(
          result.attacker,
          result.sq,
          result.toR,
          result.toC,
          result.ranged || false,
        );
      } else {
        renderAll();
      }
    }, 600); // brief pause so the selection is visible
  }, 500);
}

/* ─────────────────────────────────────────
   RENDER
───────────────────────────────────────── */
function renderBoard() {
  const boardEl = document.getElementById("gameboard");
  boardEl.innerHTML = "";

  const pid = game.currentPlayerId();
  const selUnit = game.selectedUnit;
  const moveSet = new Set(game.validMoves.map(([r, c]) => `${r},${c}`));
  const rangedSet = new Set(
    (game.validRangedAttacks || []).map(([r, c]) => `${r},${c}`),
  );

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const ownerKey = `${r},${c}`;
      const cell = document.createElement("div");
      cell.className = "cell";

      /* Territory ownership dot */
      const owner = game.cellOwnership.get(ownerKey);
      if (owner) {
        const dot = document.createElement("div");
        dot.className = `cell-owner owner-p${owner}`;
        cell.appendChild(dot);
      }

      /* Deployment zone highlight */
      if (game.isPlacing() && pid) {
        if (game.player(pid).deployRows().includes(r))
          cell.classList.add(pid === 1 ? "zone-p1" : "zone-p2");
      }

      /* Selected cell */
      if (selUnit && selUnit.row === r && selUnit.col === c)
        cell.classList.add("sel-cell");

      /* Valid moves / melee attacks */
      if (moveSet.has(ownerKey)) {
        const sq = game.board.sq(r, c);
        cell.classList.add(sq.hasEnemy(pid) ? "can-attack" : "can-move");
      }

      /* Ranged attacks (Tank) */
      if (rangedSet.has(ownerKey)) cell.classList.add("can-ranged");

      cell.addEventListener("click", () => onCellClick(r, c));

      /* Unit tokens */
      const sq = game.board.sq(r, c);
      for (const unit of sq.units) {
        const tok = document.createElement("div");
        tok.className = `unit-token p${unit.player}`;
        if (selUnit && selUnit.id === unit.id)
          tok.classList.add("selected-unit");
        tok.textContent = unit.getLabel();
        tok.title = `${unit.getName()} | ATK ${unit.atk} · DEF ${unit.def}`;

        // Buff / debuff emoji badge
        const mod = game.unitMods.get(unit.id);
        if (mod) {
          const badge = document.createElement("span");
          badge.className = "unit-badge";
          badge.textContent = mod.emoji;
          tok.appendChild(badge);
        }

        tok.addEventListener("click", (e) => {
          e.stopPropagation();
          onUnitClick(unit);
        });
        cell.appendChild(tok);
      }

      /* Power-up token */
      if (game.powerups.has(ownerKey)) {
        const pu = game.powerups.get(ownerKey);
        const puEl = document.createElement("div");
        puEl.className = `powerup-token ${pu.type}`;
        puEl.textContent = pu.emoji;
        puEl.title = pu.desc;
        cell.appendChild(puEl);
      }

      boardEl.appendChild(cell);
    }
  }
}

function renderAll() {
  renderBoard();
  renderTerritoryStats();

  // ← AI hook: fire after every board refresh
  maybeRunAI();
}

/* ─────────────────────────────────────────
   INPUT HANDLERS
   (blocked while it is the AI's turn)
───────────────────────────────────────── */
function onCellClick(r, c) {
  // Block human input when AI is thinking or when it is AI's turn
  if (game.state === "OVER" || combatQueue.length > 0) return;
  if (vsAI && game.state === "BATTLE_2") return; // AI's turn — ignore clicks

  if (game.isPlacing()) {
    if (game.tryPlace(r, c)) renderAll();
    return;
  }

  if (game.isBattling() && game.selectedUnit) {
    const result = game.tryMove(r, c);
    if (!result) return;
    if (result.kind === "combat") {
      launchCombat(
        result.attacker,
        result.sq,
        result.toR,
        result.toC,
        result.ranged || false,
      );
    } else {
      renderAll();
    }
    return;
  }

  renderAll();
}

function onUnitClick(unit) {
  if (game.state === "OVER" || combatQueue.length || !game.isBattling()) return;
  if (vsAI && game.state === "BATTLE_2") return; // AI's turn — ignore clicks
  if (unit.player === game.currentPlayerId()) {
    if (game.selectedUnit && game.selectedUnit.id === unit.id) game.clearSel();
    else game.selectUnit(unit);
    renderAll();
  }
}

/* Unit-type selector buttons */
document.querySelectorAll(".unit-type-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".unit-type-btn")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    game.chosenType = btn.dataset.type;
  });
});

/* ─────────────────────────────────────────
   UI FLOW — one-time event listeners
───────────────────────────────────────── */

/* Play button → 2-player mode: Player 1 placement */
playBtn.addEventListener("click", () => {
  vsAI = false;
  banner.classList.remove("visible");
  playBtnDiv.classList.add("hidden");
  moveBoardRight();
  setTimeout(() => showImgs(imgsBlue), 1000);
  game.state = "PLACE_1";
  renderAll();
});

/* AI Play button → vs-AI mode: Player 1 placement only */
aiPlayBtn.addEventListener("click", () => {
  vsAI = true;
  banner.classList.remove("visible");
  playBtnDiv.classList.add("hidden");
  moveBoardRight();
  setTimeout(() => showImgs(imgsBlue), 1000);
  game.state = "PLACE_1";
  renderAll();
});

/* Blue check → in 2-player mode advance to P2 placement;
                in AI mode auto-place P2 and start battle */
checkBtnBlue.addEventListener("click", () => {
  if (game.state !== "PLACE_1") return;
  if (!game.hasPlaced5(1)) {
    alert("Le Joueur 1 doit placer exactement 5 unités avant de continuer !");
    return;
  }

  hideImgs(imgsBlue);

  if (vsAI) {
    // Auto-place AI units, then go straight to battle
    setTimeout(() => {
      autoPlaceAI();
      moveBoardCenter();
      game.state = "BATTLE_1";
      game.spawnPowerups(5);
      renderAll();
    }, 1000);
  } else {
    // Normal 2-player flow
    setTimeout(() => moveBoardLeft(), 1000);
    setTimeout(() => showImgs(imgsRed), 2000);
    game.state = "PLACE_2";
    renderAll();
  }
});

/* Blue cross → reset Player 1's units */
crossBtnBlue.addEventListener("click", () => {
  if (game.state !== "PLACE_1") return;
  game.resetPlacement(1);
  renderAll();
});

/* Red check → start battle (2-player only; hidden in AI mode) */
checkBtnRed.addEventListener("click", () => {
  if (game.state !== "PLACE_2") return;
  if (!game.hasPlaced5(2)) {
    alert("Le Joueur 2 doit placer exactement 5 unités avant de continuer !");
    return;
  }
  hideImgs(imgsRed);
  setTimeout(() => {
    moveBoardCenter();
    game.state = "BATTLE_1";
    game.spawnPowerups(5);
    renderAll();
  }, 1000);
});

/* Red cross → reset Player 2's units (2-player only) */
crossBtnRed.addEventListener("click", () => {
  if (game.state !== "PLACE_2") return;
  game.resetPlacement(2);
  renderAll();
});

/* ─────────────────────────────────────────
   DICE COMBAT FLOW
───────────────────────────────────────── */
function launchCombat(attacker, sq, toR, toC, ranged = false) {
  const enemies = sq.enemiesOf(attacker.player);

  // Tank distance penalty: −1 ATK per step beyond adjacency
  let effectiveAtk = attacker.atk;
  let distPenalty = 0;
  if (ranged && attacker.type === "tank") {
    const dist = manhattan(attacker.row, attacker.col, toR, toC);
    distPenalty = Math.max(0, dist - 1);
    effectiveAtk = Math.max(0, attacker.atk - distPenalty);
  }

  const aMods = game.getMod(attacker.id);

  combatQueue = enemies.map((defender) => {
    const dMods = game.getMod(defender.id);
    const baseA = d6();
    const baseD = d6();
    const aTotal = baseA + effectiveAtk + aMods.atkMod;
    const dTotal = baseD + defender.def + dMods.defMod;
    return {
      attacker,
      defender,
      sq,
      toR,
      toC,
      baseA,
      baseD,
      effectiveAtk,
      defenderDef: defender.def,
      aMod: aMods.atkMod,
      dMod: dMods.defMod,
      aTotal,
      dTotal,
      atkWins: aTotal > dTotal,
      ranged,
      distPenalty,
    };
  });
  combatIdx = 0;
  showCombat();
}

function showCombat() {
  const res = combatQueue[combatIdx];
  const face1 = document.getElementById("dice-face-1");
  const face2 = document.getElementById("dice-face-2");
  const info = document.getElementById("dice-info");
  const verd = document.getElementById("dice-verdict");
  const btn = document.getElementById("dice-continue");
  const mod1 = document.getElementById("dice-mod-1");
  const mod2 = document.getElementById("dice-mod-2");
  const stat1 = document.getElementById("dice-stat-1");
  const stat2 = document.getElementById("dice-stat-2");
  const tot1 = document.getElementById("dice-total-1");
  const tot2 = document.getElementById("dice-total-2");

  face1.className = `dice-face p${res.attacker.player}`;
  face2.className = `dice-face p${res.defender.player}`;

  document.getElementById("dice-p1-label").textContent = `${
    res.attacker.player === 1 ? "Joueur 1" : "IA"
  } — ${res.attacker.getName()}`;
  document.getElementById("dice-p2-label").textContent = `${
    res.defender.player === 1 ? "Joueur 1" : "IA"
  } — ${res.defender.getName()}`;

  info.textContent = res.ranged
    ? `${res.attacker.getName()} attaque à distance ${res.defender.getName()}${
        res.distPenalty ? ` (−${res.distPenalty} ATQ dist)` : ""
      }`
    : `${res.attacker.getName()} affronte ${res.defender.getName()}`;

  // Reset
  face1.textContent = "?";
  face2.textContent = "?";
  verd.textContent = "";
  stat1.textContent = "";
  stat2.textContent = "";
  mod1.textContent = "";
  mod2.textContent = "";
  tot1.textContent = "";
  tot2.textContent = "";
  btn.disabled = true;

  document.getElementById("dice-overlay").classList.add("show");

  // Animate attacker die
  setTimeout(() => {
    face1.textContent = res.baseA;
    face1.classList.remove("rolling");
    void face1.offsetWidth;
    face1.classList.add("rolling");
  }, 150);

  // Animate defender die
  setTimeout(() => {
    face2.textContent = res.baseD;
    face2.classList.remove("rolling");
    void face2.offsetWidth;
    face2.classList.add("rolling");
  }, 400);

  // Reveal breakdown & verdict
  setTimeout(() => {
    stat1.textContent =
      res.distPenalty > 0
        ? `+ ⚔ ATQ: ${res.effectiveAtk} (${res.attacker.atk}−${res.distPenalty} dist)`
        : `+ ⚔ ATQ: ${res.effectiveAtk}`;
    stat2.textContent = `+ 🛡 DÉF: ${res.defenderDef}`;

    if (res.aMod !== 0) {
      const mu = game.unitMods.get(res.attacker.id);
      mod1.textContent =
        res.aMod > 0
          ? `${mu ? mu.emoji : "⚡"} ATQ +${res.aMod} bonus`
          : `${mu ? mu.emoji : "💀"} ATQ ${res.aMod} malédiction`;
      mod1.className = `dice-modifier ${res.aMod > 0 ? "buff" : "debuff"}`;
    } else {
      mod1.className = "dice-modifier";
    }

    if (res.dMod !== 0) {
      const mu = game.unitMods.get(res.defender.id);
      mod2.textContent =
        res.dMod > 0
          ? `${mu ? mu.emoji : "✨"} DÉF +${res.dMod} bonus`
          : `${mu ? mu.emoji : "🌑"} DÉF ${res.dMod} malédiction`;
      mod2.className = `dice-modifier ${res.dMod > 0 ? "buff" : "debuff"}`;
    } else {
      mod2.className = "dice-modifier";
    }

    tot1.textContent = `= ${res.aTotal}`;
    tot2.textContent = `= ${res.dTotal}`;
    tot1.style.color = res.atkWins ? "#32dc78" : "#e74c3c";
    tot2.style.color = res.atkWins ? "#e74c3c" : "#32dc78";

    if (res.atkWins) {
      const col = res.attacker.player === 1 ? "#3498db" : "#e74c3c";
      verd.innerHTML = `<span style="color:${col}">⚔ L'attaquant gagne ! (${res.aTotal} vs ${res.dTotal})</span>`;
    } else {
      const col = res.defender.player === 1 ? "#3498db" : "#e74c3c";
      verd.innerHTML = `<span style="color:${col}">🛡 Le défenseur tient ! (${res.dTotal} vs ${res.aTotal})</span>`;
    }

    btn.disabled = false;
    btn.textContent =
      combatIdx + 1 < combatQueue.length ? "Combat suivant" : "Terminer";
  }, 800);
}

function advanceCombat() {
  combatIdx++;
  if (combatIdx < combatQueue.length) {
    showCombat();
  } else {
    closeDiceOverlay();
    const { attacker, sq, toR, toC, ranged } = combatQueue[0];
    game.applyResults(attacker, sq, toR, toC, combatQueue, ranged || false);
    combatQueue = [];
    combatIdx = 0;
    renderAll(); // ← maybeRunAI() is called here if it's now BATTLE_2
  }
}

function closeDiceOverlay() {
  document.getElementById("dice-overlay").classList.remove("show");
}

/* ─────────────────────────────────────────
   WIN OVERLAY
───────────────────────────────────────── */
function showWinOverlay(playerName, reason) {
  document.getElementById("win-sub-text").textContent =
    `${playerName} — ${reason}`;
  document.getElementById("win-overlay").classList.add("show");
}

function closeWinOverlay() {
  document.getElementById("win-overlay").classList.remove("show");
}

/* ─────────────────────────────────────────
   RESTART
───────────────────────────────────────── */
function doRestart() {
  vsAI       = false;
  aiThinking = false;
  game.reset();
  combatQueue = [];
  combatIdx = 0;
  closeDiceOverlay();
  closeWinOverlay();
  document
    .querySelectorAll(".unit-type-btn")
    .forEach((b) => b.classList.remove("active"));
  // Reset UI to start screen
  banner.classList.add("visible");

  playBtnDiv.classList.remove("hidden");
  moveBoardCenter();
  hideImgs(imgsBlue);
  hideImgs(imgsRed);
  renderAll();
}

document.getElementById("restart-btn-win").addEventListener("click", doRestart);

/* ─────────────────────────────────────────
   TERRITORY STATS
───────────────────────────────────────── */
function renderTerritoryStats() {
  const TOTAL = 64;
  let p1 = 0,
    p2 = 0;
  game.cellOwnership.forEach((owner) => {
    if (owner === 1) p1++;
    else if (owner === 2) p2++;
  });

  const pct1 = Math.round((p1 / TOTAL) * 100);
  const pct2 = Math.round((p2 / TOTAL) * 100);

  document.getElementById("ts-pct-blue").textContent = `${pct1}%`;
  document.getElementById("ts-bar-blue").style.width = `${pct1}%`;
  document.getElementById("ts-count-blue").textContent = `${p1} / ${TOTAL}`;

  document.getElementById("ts-pct-red").textContent = `${pct2}%`;
  document.getElementById("ts-bar-red").style.width = `${pct2}%`;
  document.getElementById("ts-count-red").textContent = `${p2} / ${TOTAL}`;

  // Only show panels during and after battle
  const visible = game.isBattling() || game.state === "OVER";
  document
    .getElementById("territory-blue")
    .classList.toggle("visible", visible);
  document.getElementById("territory-red").classList.toggle("visible", visible);
}

/* ─────────────────────────────────────────
   BOOT
───────────────────────────────────────── */
banner.classList.add("visible"); // show banner on load
renderAll();