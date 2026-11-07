"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../public_2/client.js"), "utf8");

function harness() {
  let now = 0;
  const handlers = {}, sent = [], elements = new Map(), timers = [];
  function element() {
    const classes = new Set(["hidden"]);
    const listeners = {};
    return { style: {}, value: "", textContent: "", disabled: true,
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
        toggle(c, yes) { if (yes) classes.add(c); else classes.delete(c); } },
      removeAttribute(key) { delete this[key]; },
      addEventListener(name, fn) { listeners[name] = fn; },
      dispatchEvent(event) { listeners[event.type]?.({ target: this, ...event }); } };
  }
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const sound = duration => ({ plays: 0, stops: 0, seeks: [], duration: () => duration,
    play() { return ++this.plays; }, stop() { this.stops++; }, seek(value) { this.seeks.push(value); } });
  const context = {
    currentRoom: { roomCode: "TEST", gameMode: "liste" },
    currentGameState: { currentMiniGame: "logomania", logomaniaInstanceId: "mini-1", roundNumber: 1,
      logomaniaPhase: "theme", logomaniaQuestionIndex: 0, phase: "playing" }, playerId: "p0",
    performance: { now: () => now },
    document: { getElementById: get, body: element() },
    mainDefault: element(), mainDrawing: element(), mainRules: element(), mainPlaying: element(),
    palierOverlay: element(), palierOverlayText: element(), leugtasEndOverlay: element(),
    sfxTheme: sound(1.5), sfx40s: sound(40), sfxFinJeu: sound(3.5), sfxBubbleClick: sound(.2),
    socket: { on: (name, fn) => { handlers[name] = fn; } },
    emitGameAction: (name, data) => sent.push({ name, data }),
    amISpectator: () => false, hideAllMiniGames() { get("logomaniaContainer").classList.add("hidden"); },
    invalidateMiniGameLeaderboard() {}, handleInterimLeaderboard() {},
    runEliminationSequence: (_players, done) => timers.push(done),
    setTimeout: fn => timers.push(fn), setInterval: () => 1, clearInterval() {}
  };
  const block = source.slice(source.indexOf("// Logomania suit les phases serveur"), source.indexOf('socket.on("leTourDuMondeQuestion",'));
  vm.runInNewContext(block + "\nglobalThis.getLogomaniaState = () => logomaniaSnapshot;", context);
  const state = (subPhase, remainingMs = subPhase === "theme" ? 2500 : 40000) => ({
    roomCode: "TEST", gameMode: "liste", roundNumber: 1, instanceId: "mini-1", questionIndex: 0, questionId: 1,
    subPhase, remainingMs, durationMs: subPhase === "theme" ? 2500 : 40000,
    question: { question: "Quelle marque ?", image_question: "logomania/marque/question.jpg" },
    themeName: "Marque", participantIds: ["p0", "p1"], index: 1, total: 8, savedAnswer: null });
  return { context, get, handlers, sent, timers, state, advance: ms => { now += ms; } };
}

test("Logomania client : annonce verrouillée, ouverture serveur et sons sans doublon ni remise à zéro du délai", () => {
  const { context: c, state, get, advance } = harness();
  c.renderLogomaniaQuestion(state("theme"));
  assert.equal(get("logomaniaInput").disabled, true);
  assert.equal(c.palierOverlayText.textContent, "Marque");
  advance(500);
  c.renderLogomaniaQuestion(state("theme"));
  assert.equal(c.sfxTheme.plays, 1);
  assert.equal(c.getLogomaniaState().remainingMs, 2000);
  c.currentGameState.logomaniaPhase = "answering";
  c.renderLogomaniaQuestion(state("answering"));
  assert.equal(get("logomaniaInput").disabled, false);
  assert.equal(c.sfx40s.plays, 1);
  advance(3000);
  c.renderLogomaniaQuestion(state("answering"));
  assert.equal(c.getLogomaniaState().remainingMs, 37000);
  assert.equal(c.sfx40s.plays, 1);
});

test("Logomania client : la fin d'annonce affiche immédiatement la question, encore verrouillée avant le signal serveur", () => {
  const { context: c, state, get, advance } = harness();
  c.renderLogomaniaQuestion(state("theme"));
  advance(1500);
  c.palierOverlayText.dispatchEvent({ type: "animationend", animationName: "palierZoomFade" });
  assert.equal(c.palierOverlay.classList.contains("hidden"), true);
  assert.equal(get("logomaniaContainer").classList.contains("hidden"), false);
  assert.equal(get("logomaniaInput").disabled, true);
  assert.equal(get("logomaniaPassBtn").disabled, true);
  assert.equal(c.sfx40s.plays, 0);
  c.currentGameState.logomaniaPhase = "answering";
  c.renderLogomaniaQuestion(state("answering"));
  assert.equal(get("logomaniaInput").disabled, false);
  assert.equal(c.sfx40s.plays, 1);
});

test("Logomania client : une ancienne fin d'animation ne rouvre pas la question après une transition", () => {
  const { context: c, state, get } = harness();
  c.renderLogomaniaQuestion(state("theme"));
  c.currentGameState.currentMiniGame = "blind_test";
  c.palierOverlayText.dispatchEvent({ type: "animationend", animationName: "palierZoomFade" });
  assert.equal(get("logomaniaContainer").classList.contains("hidden"), true);
});

test("Logomania client : validation unique, accusé et reconnexion conservent réponse et verrouillage", () => {
  const { context: c, state, get, handlers, sent } = harness();
  c.currentGameState.logomaniaPhase = "answering";
  c.renderLogomaniaQuestion(state("answering", 35000));
  get("logomaniaInput").value = "Marque proposée";
  c.submitLogomania(false);
  c.submitLogomania(false);
  assert.equal(sent.length, 1);
  assert.equal(get("logomaniaInput").disabled, true);
  const savedAnswer = { answer: "Marque proposée", pass: false };
  handlers.logomaniaAnswerAck({ ...state("answering"), savedAnswer });
  handlers.logomaniaTimerUpdate({ ...state("answering"), remainingMs: 30000 });
  assert.equal(get("logomaniaInput").disabled, true);
  assert.match(get("logomaniaFeedback").textContent, /enregistrée/);
  c.stopLogomaniaDisplay();
  c.renderLogomaniaQuestion({ ...state("answering", 29000), savedAnswer });
  assert.equal(get("logomaniaInput").value, savedAnswer.answer);
  assert.equal(get("logomaniaInput").disabled, true);
  assert.equal(c.sfx40s.plays, 1, "Pas de seconde musique après réponse restaurée");
});

test("Logomania client : Je passe, spectateur et expiration empêchent de nouvelles réponses", () => {
  const { context: c, state, get, sent, advance } = harness();
  c.currentGameState.logomaniaPhase = "answering";
  c.renderLogomaniaQuestion(state("answering", 1000));
  c.submitLogomania(true);
  assert.equal(sent[0].data.pass, true);
  assert.equal(sent[0].data.answer, "");
  c.stopLogomaniaDisplay();
  c.amISpectator = () => true;
  c.renderLogomaniaQuestion(state("answering", 1000));
  c.submitLogomania(false);
  assert.equal(sent.length, 1);
  assert.equal(get("logomaniaInput").disabled, true);
  c.amISpectator = () => false;
  advance(1001);
  c.renderLogomaniaClock();
  assert.equal(get("logomaniaPassBtn").disabled, true);
});

test("Logomania client : question, instance et rappels de fin obsolètes sont ignorés", () => {
  const { context: c, state, get, timers } = harness();
  c.renderLogomaniaQuestion(state("theme"));
  c.renderLogomaniaQuestion({ ...state("theme"), questionIndex: 1, questionId: 2 });
  assert.equal(c.getLogomaniaState().questionId, 1);
  c.renderLogomaniaQuestion({ ...state("theme"), instanceId: "ancienne" });
  assert.equal(c.getLogomaniaState().instanceId, "mini-1");
  c.currentGameState.logomaniaPhase = "ending";
  c.showLogomaniaEnding({ ...state("ending", 7000), durationMs: 7000, players: [] });
  c.stopLogomaniaDisplay();
  c.currentGameState.currentMiniGame = "blind_test";
  timers.forEach(fn => fn());
  assert.equal(c.leugtasEndOverlay.classList.contains("hidden"), true);
  assert.equal(get("logomaniaContainer").classList.contains("hidden"), true);
});
