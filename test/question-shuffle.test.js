"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { shuffleCopy } = require("../question-shuffle");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "server.js"), "utf8");
const data = (game) => require(path.join(root, "public_2", game, `${game}.json`));

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\n}", start) + 2;
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end);
}

function selectors(mode) {
  const history = {};
  const resets = [];
  const rooms = { TEST: { roomCode: "TEST", gameMode: mode, gameState: {} } };
  const leBonOrdre = data("le_bon_ordre");
  const blindTest = data("blind_test");
  const tourDuMonde = data("le_tour_du_monde");
  const quiSuisJe = data("qui_suis_je");
  const fauxVrai = data("le_faux_du_vrai");
  const context = {
    shuffleCopy, rooms, io: { to: () => ({ emit() {} }) },
    LE_BON_ORDRE_QUESTIONS: leBonOrdre.questions,
    LE_BON_ORDRE_THEMES: leBonOrdre.themes,
    BLIND_TEST_QUESTIONS: blindTest.questions,
    BLIND_TEST_THEMES: blindTest.themes,
    TOUR_MONDE_QUESTIONS: tourDuMonde.questions,
    TOUR_MONDE_THEMES: tourDuMonde.themes,
    QUI_SUIS_JE_QUESTIONS: quiSuisJe.questions,
    fauxVraiQuestions: fauxVrai.questions,
    PETIT_BAC_CATEGORIES: Array.from({ length: 14 }, (_, i) => `cat-${i}`),
    getPlayedHistory: () => history,
    getUnusedQuestions: (questions, game) => questions.filter((q) => !(history[game] || []).includes(q.id)),
    markQuestionsAsPlayed: (questions, game) => {
      history[game] ||= [];
      for (const question of questions) {
        if (question.id && !history[game].includes(question.id)) history[game].push(question.id);
      }
    },
    resetGameHistory: (game) => { resets.push(game); history[game] = []; },
    sendFauxVraiQuestion() {}, publishListeContext() {}, roomTimeout() {},
    startPetitBacTimer() {}, clearInterval() {}
  };
  const names = ["pickLeBonOrdreQuestions", "pickBlindTestQuestions", "pickLeTourDuMondeQuestions",
    "pickQuiSuisJeQuestions", "startFauxVrai", "startPetitBac"];
  vm.runInNewContext(names.map(functionSource).join("\n") +
    `\nglobalThis.picks = { ${names.join(", ")} };`, context);
  return { ...context.picks, context, history, resets,
    banks: { leBonOrdre, blindTest, tourDuMonde, quiSuisJe, fauxVrai } };
}

test("Fisher–Yates conserve les éléments et la banque source", () => {
  const source = Object.freeze(Array.from({ length: 20 }, (_, id) => Object.freeze({ id })));
  for (let run = 0; run < 100; run++) {
    const result = shuffleCopy(source);
    assert.notStrictEqual(result, source);
    assert.equal(result.length, source.length);
    assert.deepEqual(new Set(result), new Set(source));
    assert.deepEqual(source.map((item) => item.id), Array.from({ length: 20 }, (_, id) => id));
  }
  assert.deepEqual(shuffleCopy([]), []);
  assert.deepEqual(shuffleCopy([1]), [1]);
});

test("Fisher–Yates peut produire les six permutations de trois éléments", () => {
  const outcomes = new Set();
  for (let first = 0; first < 3; first++) {
    for (let second = 0; second < 2; second++) {
      const choices = [first / 3, second / 2];
      outcomes.add(shuffleCopy([0, 1, 2], () => choices.shift()).join(""));
    }
  }
  assert.equal(outcomes.size, 6);
});

for (const mode of ["battle_royale", "liste"]) {
  test(`${mode} : quantités, thèmes et exclusions conservés avec historique en mémoire`, () => {
    const h = selectors(mode);
    const excluded = {
      le_bon_ordre: h.banks.leBonOrdre.questions[0].id,
      blind_test: h.banks.blindTest.questions[0].id,
      le_tour_du_monde: h.banks.tourDuMonde.questions[0].id,
      qui_suis_je: h.banks.quiSuisJe.questions[0].id,
      faux_vrai: h.banks.fauxVrai.questions[0].id
    };
    for (const [game, id] of Object.entries(excluded)) h.history[game] = [id];
    h.history.petit_bac = ["A"];
    const bankSnapshots = Object.fromEntries(Object.entries(h.banks).map(([name, bank]) =>
      [name, JSON.stringify(bank)]));

    const bonOrdre = h.pickLeBonOrdreQuestions();
    assert.equal(bonOrdre.length, h.banks.leBonOrdre.themes.length);
    assert.deepEqual(new Set(bonOrdre.map((q) => q.theme_id)),
      new Set(h.banks.leBonOrdre.themes.map((theme) => theme.id)));

    const blind = h.pickBlindTestQuestions();
    assert.equal(blind.length, 8);
    assert.equal(blind.filter((q) => ["television", "television_g"].includes(q.theme_id)).length, 2);
    assert.equal(blind.filter((q) => ["musique", "music"].includes(q.theme_id)).length, 6);

    const tour = h.pickLeTourDuMondeQuestions();
    assert.equal(tour.length, h.banks.tourDuMonde.themes.length);
    assert.deepEqual(new Set(tour.map((q) => q.themeId)),
      new Set(h.banks.tourDuMonde.themes.map((theme) => theme.id)));

    const qui = h.pickQuiSuisJeQuestions();
    assert.equal(qui.length, 8);
    h.startFauxVrai("TEST");
    const faux = h.context.rooms.TEST.mini.list;
    assert.equal(faux.length, 7);
    const counts = new Map();
    for (const question of faux) counts.set(question.themeId, (counts.get(question.themeId) || 0) + 1);
    assert.equal(counts.get(1), 2);
    assert.equal(counts.get(4), 1);
    assert.equal(counts.get(6), 1);
    assert.equal(counts.get(8), 2);
    assert.equal([2, 5, 9].reduce((n, id) => n + (counts.get(id) || 0), 0), 1);

    h.startPetitBac("TEST");
    const bac = h.context.rooms.TEST.gameState.currentMiniGameState;
    assert.equal(bac.categories.length, 9);
    assert.equal(new Set(bac.categories).size, 9);
    assert.ok("ABCDEFGHIJLMNOPRSTUV".includes(bac.letter));
    assert.notEqual(bac.letter, "A");

    for (const [game, questions] of Object.entries({ le_bon_ordre: bonOrdre, blind_test: blind,
      le_tour_du_monde: tour, qui_suis_je: qui, faux_vrai: faux })) {
      assert.ok(questions.every((q) => q.id !== excluded[game]), game);
      assert.equal(new Set(questions.map((q) => q.id)).size, questions.length, game);
      assert.equal(h.history[game].length, questions.length + 1, game);
    }
    assert.deepEqual(h.resets, []);
    for (const [name, bank] of Object.entries(h.banks)) assert.equal(JSON.stringify(bank), bankSnapshots[name]);
  });
}

test("les conditions de remise à zéro et l'enregistrement restent en place", () => {
  const cases = [
    ["le_bon_ordre", "leBonOrdre", "pickLeBonOrdreQuestions"],
    ["blind_test", "blindTest", "pickBlindTestQuestions"],
    ["le_tour_du_monde", "tourDuMonde", "pickLeTourDuMondeQuestions"],
    ["qui_suis_je", "quiSuisJe", "pickQuiSuisJeQuestions"],
    ["faux_vrai", "fauxVrai", "startFauxVrai"]
  ];
  for (const [game, bankName, picker] of cases) {
    const h = selectors("battle_royale");
    h.history[game] = h.banks[bankName].questions.map((q) => q.id);
    h[picker]("TEST");
    assert.deepEqual(h.resets, [game], game);
    assert.ok(h.history[game].length > 0, game);
  }
  const h = selectors("liste");
  h.history.petit_bac = "ABCDEFGHIJLMNOPRSTUV".split("");
  h.startPetitBac("TEST");
  assert.deepEqual(h.resets, ["petit_bac"]);
  assert.equal(h.history.petit_bac.length, 1);
});
