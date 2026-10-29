"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { shuffleCopy } = require("../question-shuffle");

const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const bank = require("../public_2/blind_test/blind_test.json");
const quotas = { dessin_anime: 3, television: 1, musique: 5 };
const historyCode = source.slice(source.indexOf("function getPlayedHistory()"), source.indexOf("const blindTestData"));
const pickerCode = source.slice(source.indexOf("function pickBlindTestQuestions()"), source.indexOf("function sendBlindTestQuestion("));
const quotaCode = source.match(/const BLIND_TEST_QUOTAS = [^\n]+/)[0];
const ids = (questions) => Array.from(questions, q => q.id);

function fixture(t, initial = {}, questions = bank.questions, shuffle = shuffleCopy) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lqs-blind-"));
  const file = path.join(dir, "history.json");
  fs.writeFileSync(file, JSON.stringify(initial));
  t.after(() => {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  function reload(storage = fs) {
    const context = { fs: storage, HISTORY_FILE: file, shuffleCopy: shuffle,
      BLIND_TEST_QUESTIONS: questions, BLIND_TEST_THEMES: bank.themes,
      console: { log() {}, error() {} } };
    vm.runInNewContext(historyCode + quotaCode + pickerCode +
      "\nglobalThis.pick = pickBlindTestQuestions;", context);
    return context.pick;
  }
  return { file, reload, pick: reload(), history: () => JSON.parse(fs.readFileSync(file, "utf8")) };
}

function assertRound(questions) {
  assert.equal(questions.length, 9);
  assert.equal(new Set(ids(questions)).size, 9);
  for (const [theme, quota] of Object.entries(quotas)) {
    assert.equal(questions.filter(q => q.theme_id === theme).length, quota, theme);
  }
}

test("Blind Test : neuf questions 3/1/5, champs client et banque inchangée", (t) => {
  const frozen = Object.freeze(bank.questions.map(q => Object.freeze({ ...q })));
  const snapshot = JSON.stringify(frozen);
  const f = fixture(t, {}, frozen);
  for (let i = 0; i < 20; i++) {
    const questions = f.pick();
    assertRound(questions);
    for (const q of questions) {
      assert.equal(q.themeName, bank.themes.find(th => th.id === q.theme_id).name);
      assert.equal(q.text, q.question);
      assert.equal(q.audio, q.audio_question);
      assert.equal(q.reponse, q.reponse_texte);
      assert.equal(q.answer, q.reponse_texte);
      assert.equal(q.image, q.image_reponse);
    }
  }
  assert.equal(JSON.stringify(frozen), snapshot);
});

test("Blind Test : shuffleCopy reçoit chaque pool inédit puis les neuf questions", (t) => {
  const calls = [];
  const excluded = bank.questions.filter(q => q.theme_id === "musique").slice(0, 2);
  const f = fixture(t, { blind_test: ids(excluded) }, bank.questions, (items) => {
    calls.push(ids(items));
    return shuffleCopy(items, () => 0);
  });
  const questions = f.pick();
  assertRound(questions);
  assert.equal(calls.length, 4);
  Object.keys(quotas).forEach((theme, i) => assert.deepEqual(calls[i], ids(bank.questions
    .filter(q => q.theme_id === theme && !ids(excluded).includes(q.id)))));
  assert.equal(calls[3].length, 9);
  assert.deepEqual(ids(questions), shuffleCopy(calls[3], () => 0));
  assert.ok(questions.every(q => !ids(excluded).includes(q.id)));
  assert.doesNotMatch(pickerCode, /\.sort\s*\(/);
});

test("Blind Test : les émissions et séries partagent le pool theme_id télévision", (t) => {
  const calls = [];
  const television = bank.questions.filter(q => q.theme_id === "television");
  assert.ok(television.some(q => q.audio_question.includes("/emission/")));
  assert.ok(television.some(q => q.audio_question.includes("/serie/")));
  const f = fixture(t, {}, bank.questions, (items) => { calls.push(ids(items)); return shuffleCopy(items); });
  f.pick();
  assert.deepEqual(calls[1], ids(television));
});

test("Blind Test : sauvegarde dès le tirage, rechargement et autres historiques préservés", (t) => {
  const others = { petit_bac: ["A", "Z"], qui_suis_je: [7], le_tour_du_monde: [3] };
  const f = fixture(t, others);
  const first = f.pick();
  assert.deepEqual(new Set(f.history().blind_test), new Set(ids(first)));
  const second = f.reload()();
  assertRound(second);
  assert.ok(second.every(q => !ids(first).includes(q.id)));
  const { blind_test, ...savedOthers } = f.history();
  assert.equal(blind_test.length, 18);
  assert.deepEqual(savedOthers, others);
});

for (const [theme, quota] of Object.entries(quotas)) {
  for (let remainingCount = 0; remainingCount < quota; remainingCount++) {
    test(`Blind Test : cycle ${theme}, ${remainingCount} inédites avant renouvellement indépendant`, (t) => {
      const pool = bank.questions.filter(q => q.theme_id === theme);
      const remaining = pool.slice(0, remainingCount);
      const others = bank.questions.filter(q => q.theme_id !== theme)
        .filter((q, i, list) => list.findIndex(other => other.theme_id === q.theme_id) === i);
      const f = fixture(t, { blind_test: ids([...pool.slice(remainingCount), ...others]), petit_bac: ["T"] });
      const questions = f.pick();
      assertRound(questions);
      const picked = questions.filter(q => q.theme_id === theme);
      assert.ok(remaining.every(q => ids(picked).includes(q.id)));
      const saved = f.history().blind_test;
      const newCyclePicks = picked.filter(q => !ids(remaining).includes(q.id));
      assert.deepEqual(new Set(saved.filter(id => ids(pool).includes(id))), new Set(ids(newCyclePicks)));
      assert.ok(others.every(q => saved.includes(q.id)));
      assert.ok(questions.every(q => q.theme_id === theme || !ids(others).includes(q.id)));
      for (const [otherTheme, otherQuota] of Object.entries(quotas).filter(([id]) => id !== theme)) {
        const otherIds = ids(bank.questions.filter(q => q.theme_id === otherTheme));
        assert.equal(saved.filter(id => otherIds.includes(id)).length, otherQuota + 1);
      }
      const next = f.reload()();
      assertRound(next);
      assert.ok(next.every(q => !ids(newCyclePicks).includes(q.id)));
      assert.deepEqual(f.history().petit_bac, ["T"]);
    });
  }

  test(`Blind Test : épuisement exact de ${theme}, renouvellement au tirage suivant`, (t) => {
    const pool = bank.questions.filter(q => q.theme_id === theme);
    const remaining = pool.slice(0, quota);
    const f = fixture(t, { blind_test: ids(pool.slice(quota)) });
    const first = f.pick();
    assert.deepEqual(new Set(ids(first.filter(q => q.theme_id === theme))), new Set(ids(remaining)));
    assert.ok(pool.every(q => f.history().blind_test.includes(q.id)));
    const second = f.pick();
    assertRound(second);
    assert.equal(f.history().blind_test.filter(id => ids(pool).includes(id)).length, quota);
  });

  test(`Blind Test : banque ${theme} insuffisante, aucune consommation partielle`, (t) => {
    const short = bank.questions.filter(q => q.theme_id === theme).slice(0, quota - 1);
    // Répéter un ID ne doit pas masquer le manque de questions distinctes.
    const questions = [...bank.questions.filter(q => q.theme_id !== theme), ...short, ...short];
    const f = fixture(t, { blind_test: [999], petit_bac: ["B"] }, questions);
    const before = fs.readFileSync(f.file, "utf8");
    assert.throws(() => f.pick(), new RegExp(`${theme}.*${quota} requises`));
    assert.equal(fs.readFileSync(f.file, "utf8"), before);
  });
}

test("Blind Test : petite banque, passage de cycle sans doublon même au quota minimal", (t) => {
  const questions = Object.entries(quotas).flatMap(([theme, quota]) =>
    bank.questions.filter(q => q.theme_id === theme).slice(0, quota));
  const f = fixture(t, { blind_test: ids(questions.filter(q => q.theme_id !== "television").slice(1)) }, questions);
  for (let i = 0; i < 15; i++) assertRound(f.pick());
});

test("Blind Test : échec de sauvegarde remonté au lieu de lancer sans mémoire", (t) => {
  const f = fixture(t, { petit_bac: ["C"] });
  const before = fs.readFileSync(f.file, "utf8");
  const pick = f.reload({ ...fs, writeFileSync() { throw new Error("stockage indisponible"); } });
  assert.throws(() => pick(), /stockage indisponible/);
  assert.equal(fs.readFileSync(f.file, "utf8"), before);
});
