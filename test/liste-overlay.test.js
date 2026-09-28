"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../public_2/client.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../public_2/index.html"), "utf8");

function block(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}
function element() {
  const classes = new Set();
  return { style: {}, classList: {
    add: (c) => classes.add(c), remove: (c) => classes.delete(c),
    contains: (c) => classes.has(c),
    toggle: (c, on) => on ? classes.add(c) : classes.delete(c)
  } };
}

test("classement terminé → Quitter → salle Battle Royale → nouveau lobby Liste", () => {
  const overlay = element();
  overlay.classList.add("active");
  let quit;
  let joined;
  const c = {
    document: { getElementById: (id) => id === "liste-leaderboard-overlay" ? overlay : null },
    confirmQuitBtn: { addEventListener: (_, fn) => { quit = fn; } },
    currentRoom: { gameMode: "liste", listeTournament: { started: true } },
    currentGameState: { phase: "listeFinished" }, playerId: "p", body: element(),
    screenLobby: element(), screenRoom: element(), globalControls: element(),
    gameModeButtons: [], gameModeHint: null, sandboxControls: null,
    quitConfirmOverlay: null, petitBacContainer: null, pbLetterDisplay: null, pbFormZone: null,
    socket: { emit() {}, disconnect() {}, connect() {}, on: (_, fn) => { joined = fn; } },
    localStorage: { removeItem() {}, setItem() {} }, console: { log() {} },
    setTimeout: (fn) => fn(), hideAllMiniGames() {}, stopDrawAnimation() {},
    updateListeConfigUI() {},
    // Seul le rafraîchissement général est remplacé : vérifier le nettoyage
    // explicite même sans gameStateUpdate reçu ou rendu après le départ.
    updateGameStateUI() {}
  };
  vm.createContext(c);
  for (const name of ["hideListeLeaderboard", "showScreen", "updateGameModeUI"]) {
    vm.runInContext(block(`function ${name}(`, "\n}") + "\n}", c);
  }
  c.updateRoomUI = (room) => { c.currentRoom = room; c.updateGameModeUI(); };
  vm.runInContext(block("if (confirmQuitBtn) {", "// clic sur"), c);
  vm.runInContext(block('socket.on("roomJoined",', 'socket.on("roomUpdate",'), c);
  quit();
  assert.equal(overlay.classList.contains("active"), false);
  assert.equal(c.screenLobby.classList.contains("active"), true);
  c.currentGameState = { phase: "idle" };
  joined({ roomCode: "BR01", gameMode: "battle_royale", listeTournament: { started: false } });
  assert.equal(overlay.classList.contains("active"), false);
  assert.equal(c.body.classList.contains("mode-liste"), false);
  joined({ roomCode: "LI02", gameMode: "liste", listeTournament: { started: false } });
  assert.equal(overlay.classList.contains("active"), false);
  assert.equal(c.body.classList.contains("mode-liste"), true);

  // Un changement direct de partie doit aussi nettoyer un ancien état actif.
  overlay.classList.add("active");
  joined({ roomCode: "LI03", gameMode: "liste", listeTournament: { started: true } });
  assert.equal(overlay.classList.contains("active"), false);
  overlay.classList.add("active");
  c.updateRoomUI({ gameMode: "battle_royale" });
  assert.equal(overlay.classList.contains("active"), false);
});

test("overlay masqué par défaut hors Liste, visible seulement avec mode-liste et active", () => {
  assert.match(html, /(?:^|\n)\s*#liste-leaderboard-overlay\s*\{\s*display:\s*none;\s*\}/);
  assert.match(html, /body\.mode-liste #liste-leaderboard-overlay\.active\s*\{\s*display:\s*flex;/);
});
