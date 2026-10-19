"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");

const serverSource = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const clientSource = fs.readFileSync(path.join(__dirname, "../public_2/client.js"), "utf8");
const matrix = { id: 1, question: "Test", columns: ["a", "b", "c"], rows: ["d", "e", "f"] };

function between(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Bloc introuvable : ${start}`);
  return source.slice(first, last);
}

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.classList = {
      values: new Set(),
      add: (name) => this.classList.values.add(name),
      remove: (name) => this.classList.values.delete(name),
      contains: (name) => this.classList.values.has(name)
    };
  }
  appendChild(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  setAttribute() {}
  addEventListener(name, callback) { this[name] = callback; }
  querySelectorAll(selector) {
    const found = [];
    const visit = (element) => {
      if (element.tagName === "input" && selector.startsWith("input")) found.push(element);
      element.children.forEach(visit);
    };
    visit(this);
    return found;
  }
}

function clientHarness(mode) {
  const ids = ["matriceFootballContainer", "matriceFootballCorrectionContainer", "mfPlayingGrid",
    "mfValidateBtn", "mfFeedback", "mfQuestion", "mfTimerNumber", "mfTimerFill"];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  elements.matriceFootballContainer.classList.add("hidden");
  elements.matriceFootballCorrectionContainer.classList.add("hidden");
  const handlers = {};
  const emitted = [];
  const room = { roomCode: "ABCD", gameMode: mode };
  const state = { phase: "playing", currentMiniGame: "matrice_football", roundNumber: 1,
    matriceFootballInstanceId: "first" };
  const ctx = vm.createContext({
    currentRoom: room, currentGameState: state,
    socket: { on: (name, callback) => { handlers[name] = callback; } },
    document: { createElement: (tag) => new Element(tag), getElementById: (id) => elements[id] },
    matriceFootballContainer: elements.matriceFootballContainer,
    mfPlayingGrid: elements.mfPlayingGrid, mfValidateBtn: elements.mfValidateBtn,
    mfFeedback: elements.mfFeedback,
    mainDefault: new Element(), mainDrawing: new Element(), mainRules: new Element(),
    mainPlaying: new Element(),
    showMainZone: () => {
      elements.matriceFootballContainer.classList.add("hidden");
      elements.matriceFootballCorrectionContainer.classList.add("hidden");
    },
    amISpectator: () => false,
    emitGameAction: (name, payload) => emitted.push({ name, payload }),
    sfxTheme: { play() {} }, sfx150s: { play() {}, stop() {} },
    sfxBubbleClick: { play() {} }
  });
  vm.runInContext(between(clientSource, "let currentMatriceFootball = null;", "const pbLetterDisplay"), ctx);
  vm.runInContext(between(clientSource, "function renderMatriceFootballGrid(",
    'socket.on("petitBacTimerUpdate"'), ctx);
  const branch = between(clientSource, 'if (gs.currentMiniGame === "matrice_football") {',
    "// --- Autres mini-jeux ---");
  vm.runInContext(`globalThis.applyMatrixState = function(gs) { ${branch} };`, ctx);
  return {
    handlers, elements, emitted, state, ctx,
    inputs: () => elements.mfPlayingGrid.querySelectorAll("input[data-mf-index]"),
    visible: (id) => !elements[id].classList.contains("hidden"),
    start: (instanceId, extra = {}) => handlers.matriceFootballStart({
      matrix, instanceId, roomCode: room.roomCode, roundNumber: 1, gameMode: mode,
      duration: 150, isReload: true, ...extra
    }),
    snapshot: () => vm.runInContext("({ submitted: matriceFootballSubmitted, correction: currentMatriceFootballCorrection })", ctx)
  };
}

for (const mode of ["battle_royale", "liste"]) {
  test(`${mode} : une nouvelle manche crée une autre identité, la reconnexion la conserve`, () => {
    const room = { roomCode: "ABCD", gameMode: mode,
      gameState: { phase: "playing", currentMiniGame: "matrice_football", roundNumber: 1 } };
    const events = [];
    const ctx = vm.createContext({
      rooms: { ABCD: room }, MATRICE_FOOTBALL_QUESTIONS: [matrix],
      MATRICE_FOOTBALL_DURATION_SECONDS: 150, randomUUID,
      getUnusedQuestions: () => [matrix], markQuestionsAsPlayed() {},
      resetGameHistory: () => assert.fail("L'historique ne doit pas être effacé"),
      publishListeContext() {}, roomTimeout() {},
      io: { to: () => ({ emit: (name, data) => events.push({ name, data }) }) }
    });
    vm.runInContext(between(serverSource, "function startMatriceFootball(roomCode)",
      "function endMatriceFootballRound(roomCode)"), ctx);
    vm.runInContext("startMatriceFootball('ABCD')", ctx);
    const first = room.gameState.currentMiniGameState.instanceId;
    assert.equal(events.at(-1).data.instanceId, first);

    const syncEvents = [];
    const sync = between(serverSource, 'else if (mini.type === "matrice_football") {',
      "// 8. LES ENCHERES");
    vm.runInContext(`globalThis.syncMatrix = function(socket, room, mini, gs) {
      if (false) {} ${sync} }`, ctx);
    const firstMini = room.gameState.currentMiniGameState;
    firstMini.playerAnswers.p1 = { 0: "Réponse" };
    ctx.syncMatrix({ playerId: "p1", emit: (name, data) => syncEvents.push({ name, data }) },
      room, firstMini, room.gameState);
    assert.equal(syncEvents[0].data.instanceId, first);
    assert.equal(syncEvents[0].data.savedAnswers[0], "Réponse");
    assert.equal(syncEvents[1].data.instanceId, first);

    room.gameState.currentMiniGameState = null;
    vm.runInContext("startMatriceFootball('ABCD')", ctx);
    const second = room.gameState.currentMiniGameState.instanceId;
    assert.notEqual(second, first);
    assert.equal(events.at(-1).data.instanceId, second);
  });

  test(`${mode} : saisie locale, validation, correction et nouvelle partie`, () => {
    const app = clientHarness(mode);
    app.start("first");
    const firstInput = app.inputs()[0];
    firstInput.value = "Essai";
    app.start("first");
    assert.strictEqual(app.inputs()[0], firstInput);
    assert.equal(firstInput.value, "Essai");
    app.ctx.applyMatrixState(app.state);
    assert.equal(app.visible("matriceFootballContainer"), true);

    app.elements.mfValidateBtn.click();
    assert.equal(app.emitted.at(-1).payload.instanceId, "first");
    app.handlers.matriceFootballAnswerAck({ roundNumber: 1, matrixId: 1, instanceId: "first" });
    assert.equal(firstInput.disabled, true);
    app.start("first", { hasAnswered: true, savedAnswers: { 0: "Enregistrée" } });
    assert.strictEqual(app.inputs()[0], firstInput);
    assert.equal(firstInput.value, "Enregistrée");
    assert.equal(firstInput.disabled, true);

    vm.runInContext('currentMatriceFootballCorrection = { instanceId: "first", roomCode: "ABCD" }', app.ctx);
    app.elements.matriceFootballCorrectionContainer.classList.remove("hidden");
    app.ctx.applyMatrixState(app.state);
    assert.equal(app.visible("matriceFootballCorrectionContainer"), true);
    assert.equal(app.visible("matriceFootballContainer"), false);

    app.state.matriceFootballInstanceId = "second";
    app.ctx.applyMatrixState(app.state);
    assert.equal(app.visible("matriceFootballCorrectionContainer"), false);
    assert.equal(app.visible("matriceFootballContainer"), false);
    app.start("second");
    assert.equal(app.inputs()[0].value, "");
    assert.equal(app.inputs()[0].disabled, false);
    assert.equal(app.elements.mfValidateBtn.disabled, false);
    assert.equal(app.elements.mfFeedback.textContent, "");
    assert.equal(app.snapshot().submitted, false);
    assert.equal(app.snapshot().correction, null);
    assert.equal(app.visible("matriceFootballCorrectionContainer"), false);
    app.handlers.matriceFootballAnswerAck({ roundNumber: 1, matrixId: 1, instanceId: "first" });
    app.handlers.matriceFootballEnd({ roundNumber: 1, instanceId: "first" });
    assert.equal(app.inputs()[0].disabled, false);
    app.ctx.applyMatrixState(app.state);
    assert.equal(app.visible("matriceFootballContainer"), true);

    const reconnected = clientHarness(mode);
    reconnected.start("first", { hasAnswered: true, savedAnswers: { 0: "Serveur" } });
    assert.equal(reconnected.inputs()[0].value, "Serveur");
    assert.equal(reconnected.inputs()[0].disabled, true);
    assert.equal(reconnected.elements.mfValidateBtn.disabled, true);
  });
}
