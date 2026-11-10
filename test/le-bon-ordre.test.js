"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  GROUP_IDS, validateBonOrdreBank, createBonOrdreStore,
  safeBonOrdreQuestion, isValidBonOrdreAnswer, bonOrdreGrade, gradeBonOrdre
} = require("../le-bon-ordre");
const { memoryFs } = require("./helpers/bon-ordre-memory.cjs");
const QUESTION_IDS = GROUP_IDS.map((group) => `variante-${group}`);

// Ces données fictives restent exclusivement dans les tests.
function fixture(size = 12) {
  return { questions: QUESTION_IDS.map((id, index) => ({
    id, groupe: index + 1, nom: `Thème ${id}`, question: `Classer le pool ${id}`,
    pool: Array.from({ length: typeof size === "number" ? size : size[id] }, (_, index) => ({
      id: `${id}-${index}`, nom: `Élément ${index}`, image: index % 2 ? null : `le_bon_ordre/images/test-${index}.png`,
      valeur: index - 3
    }))
  })) };
}

function temporaryStore(t, options) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lqs-bon-ordre-"));
  const file = path.join(directory, "bon_ordre_elements_v1.json");
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, file, store: createBonOrdreStore(file, options) };
}

function byId(questions) {
  return Object.fromEntries(questions.map((question) => [question.id, question]));
}

function addVariant(bank, group, id, size = 12) {
  const source = fixture(size).questions[group - 1];
  const variant = { ...source, id, pool: source.pool.map((card, index) => ({ ...card, id: `${id}-${index}` })) };
  bank.questions.push(variant);
  return variant;
}

function assertDraw(questions) {
  assert.deepEqual(questions.map((question) => question.groupe).sort(), GROUP_IDS);
  for (const question of questions) {
    assert.equal(question.cards.length, 5);
    assert.equal(new Set(question.cards.map((card) => card.valeur)).size, 5);
  }
}

test("banque fournie : 14 variantes, sept groupes, données et identifiants conservés", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../public_2/le_bon_ordre/le_bon_ordre.json"), "utf8"));
  assert.equal(raw.questions.length, 14);
  assert.deepEqual(validateBonOrdreBank(raw), raw);
  const storage = memoryFs();
  const store = createBonOrdreStore(path.join(__dirname, "real-bank-memory.json"), { fs: storage, random: () => 0.999 });
  const initial = JSON.stringify(raw);
  // Traverse aussi les pools contenant de nombreuses cartes de même valeur.
  for (let index = 0; index < 100; index++) assertDraw(store.consume(raw, `real-${index}`));
  assert.equal(JSON.stringify(raw), initial);
});

test("mélange : les 5040 permutations placent chaque groupe 720 fois à chaque position", () => {
  const bank = fixture(5);
  const storage = memoryFs();
  let tail = [];
  let calls = 0;
  const store = createBonOrdreStore(path.join(__dirname, "permutations-memory.json"), {
    fs: storage,
    random: () => ++calls <= 56 ? 0.999 : tail.shift()
  });
  const counts = GROUP_IDS.map(() => Array(7).fill(0));
  const permutations = new Set();
  function visit(choices = []) {
    if (choices.length < 6) {
      const upper = 7 - choices.length;
      for (let index = 0; index < upper; index++) visit([...choices, (index + 0.5) / upper]);
      return;
    }
    tail = [...choices];
    calls = 0;
    const questions = store.consume(bank, `permutation-${permutations.size}`);
    assertDraw(questions);
    assert.equal(tail.length, 0);
    assert.equal(calls, 62);
    permutations.add(questions.map((question) => question.groupe).join(","));
    questions.forEach((question, index) => counts[question.groupe - 1][index]++);
  }
  visit();
  assert.equal(permutations.size, 5040);
  assert.deepEqual(counts, GROUP_IDS.map(() => Array(7).fill(720)));
});

test("variantes : sélection uniforme parmi les variantes disponibles du groupe", () => {
  const bank = fixture();
  addVariant(bank, 1, "alternative-a");
  addVariant(bank, 1, "alternative-b");
  const candidates = bank.questions.filter((question) => question.groupe === 1);
  for (let index = 0; index < 3; index++) {
    const store = createBonOrdreStore(path.join(__dirname, `uniform-${index}.json`), {
      fs: memoryFs(), random: () => (index + 0.5) / 3
    });
    const draw = store.consume(bank, "uniform");
    assertDraw(draw);
    assert.equal(draw.find((question) => question.groupe === 1).id, candidates[index].id);
  }
});

test("groupe multiple : exclusion persistante puis reset collectif limité à ce groupe", (t) => {
  const { store, file } = temporaryStore(t, { random: () => 0.999 });
  const bank = fixture(50);
  const firstVariant = bank.questions[0];
  firstVariant.pool.length = 6;
  const secondVariant = addVariant(bank, 1, "nouvelle-variante", 12);
  // Cette ancienne variante n'a pas cinq valeurs inédites : elle reste exclue.
  fs.writeFileSync(file, JSON.stringify({ version: 1, pools: { [firstVariant.id]: [firstVariant.pool[0].id, firstVariant.pool[1].id] } }));
  const initial = store.read().pools[firstVariant.id];
  for (let index = 0; index < 2; index++) {
    const draw = store.consume(bank, `other-${index}`);
    assertDraw(draw);
    assert.equal(draw.find((question) => question.groupe === 1).id, secondVariant.id);
    assert.deepEqual(store.read().pools[firstVariant.id], initial);
  }
  assert.equal(store.read().pools[secondVariant.id].length, 10);
  const draw = store.consume(bank, "group-reset");
  assertDraw(draw);
  assert.equal(draw.find((question) => question.groupe === 1).id, secondVariant.id);
  assert.deepEqual(store.read().pools[firstVariant.id], []);
  assert.equal(store.read().pools[secondVariant.id].length, 5);
  for (const id of QUESTION_IDS.slice(1)) assert.equal(store.read().pools[id].length, 15);
  // Après relecture du fichier, la première variante est à nouveau disponible.
  const restarted = createBonOrdreStore(file, { random: () => 0 });
  assert.equal(restarted.consume(bank, "after-reset").find((question) => question.groupe === 1).id, firstVariant.id);
});

for (const multiple of [false, true]) {
  test(`cinq cartes inédites mais quatre valeurs : ${multiple ? "variante exclue" : "complément du nouveau cycle"}`, (t) => {
    const { store, file } = temporaryStore(t, { random: () => 0.999 });
    const bank = fixture(8);
    const question = bank.questions[0];
    question.pool.forEach((card, index) => { card.valeur = [10, 10, 20, 30, 40, 50, 60, 70][index]; });
    const used = question.pool.slice(5).map((card) => card.id);
    if (multiple) addVariant(bank, 1, "alternative");
    fs.writeFileSync(file, JSON.stringify({ version: 1, pools: { [question.id]: used } }));
    const draw = store.consume(bank, "four-values");
    assertDraw(draw);
    const selected = draw.find((entry) => entry.groupe === 1);
    if (multiple) {
      assert.equal(selected.id, "alternative");
      assert.deepEqual(store.read().pools[question.id], used);
    } else {
      assert.equal(selected.cards.filter((card) => !used.includes(card.id)).length, 4);
      const remembered = store.read().pools[question.id];
      assert.equal(remembered.length, 1);
      assert.ok(used.includes(remembered[0]));
      assert.ok(selected.cards.some((card) => card.id === remembered[0]));
    }
  });
}

test("mémoire : anciens identifiants conservés et nouveaux identifiants relus", (t) => {
  const { store, file } = temporaryStore(t);
  const bank = fixture();
  bank.questions[0].id = "population";
  const variant = addVariant(bank, 2, "nouveau_theme");
  const existing = { population: [bank.questions[0].pool[0].id], nouveau_theme: [variant.pool[0].id], ancien_theme: ["ancienne-carte"] };
  fs.writeFileSync(file, JSON.stringify({ version: 1, pools: existing }));
  assert.deepEqual(store.read().pools, existing);
  store.consume(bank, "migration");
  for (const [id, ids] of Object.entries(existing)) assert.ok(ids.every((cardId) => store.read().pools[id].includes(cardId)));
  assert.equal(store.consume(bank, "relecture").length, 7);
});

test("validation : contrat des sept pools, valeurs négatives et données non mutées", () => {
  const raw = fixture();
  const initial = JSON.stringify(raw);
  const validated = validateBonOrdreBank(raw);
  assert.deepEqual(validated, raw);
  assert.notStrictEqual(validated.questions[0].pool[0], raw.questions[0].pool[0]);
  assert.equal(JSON.stringify(raw), initial);
  assert.throws(() => validateBonOrdreBank({ themes: [], questions: [] }), /sept|7/);
  assert.throws(() => validateBonOrdreBank(undefined), /JSON restructuré/);
});

test("validation : chaque erreur de contrat empêche un lancement incomplet", () => {
  const changes = [
    (bank) => bank.questions.pop(),
    (bank) => { bank.questions[0].id = " "; },
    (bank) => { bank.questions[0].id = " id "; },
    (bank) => { delete bank.questions[0].groupe; },
    ...[0, 8, 1.5, "1", null].map((groupe) => (bank) => { bank.questions[0].groupe = groupe; }),
    (bank) => { bank.questions[0].groupe = 2; },
    (bank) => { bank.questions[1].id = bank.questions[0].id; },
    (bank) => { bank.questions[0].nom = " "; },
    (bank) => { bank.questions[0].question = ""; },
    (bank) => { bank.questions[0].pool.length = 4; },
    (bank) => { bank.questions[0].pool[1].id = bank.questions[0].pool[0].id; },
    (bank) => { bank.questions[0].pool[0].id = " "; },
    (bank) => { bank.questions[0].pool[0].nom = null; },
    (bank) => { bank.questions[0].pool[0].valeur = Infinity; },
    (bank) => { bank.questions[0].pool[0].valeur = "10"; },
    (bank) => { bank.questions[0].pool.forEach((card, index) => { card.valeur = index % 4; }); },
    (bank) => { delete bank.questions[0].pool[0].image; }
  ];
  for (const change of changes) {
    const bank = fixture();
    change(bank);
    assert.throws(() => validateBonOrdreBank(bank), /Le Bon Ordre/);
  }
  for (const image of ["https://example.test/a.png", "//example.test/a.png", "/a.png", "../a.png",
    "le_bon_ordre/../a.png", "le_bon_ordre/%2e%2e/a.png", "le_bon_ordre\\a.png", "public_2/le_bon_ordre/a.png",
    "javascript:alert(1)", "a.png#x", "a.png?x", 12, ""]) {
    const bank = fixture();
    bank.questions[0].pool[0].image = image;
    assert.throws(() => validateBonOrdreBank(bank), /image/);
  }
});

test("tirages : sept instantanés sans doublon, disposition commune et banque intacte", (t) => {
  const { store } = temporaryStore(t);
  const bank = fixture();
  const before = JSON.stringify(bank);
  const questions = store.consume(bank, "partie-a");
  assert.equal(questions.length, 7);
  assert.deepEqual(new Set(questions.map((question) => question.id)), new Set(QUESTION_IDS));
  assert.deepEqual(questions.map((question) => question.groupe).sort(), GROUP_IDS);
  for (const question of questions) {
    assert.equal(question.cards.length, 5);
    assert.equal(new Set(question.cards.map((card) => card.id)).size, 5);
    assert.equal(new Set(question.cards.map((card) => card.valeur)).size, 5);
    assert.ok(question.cards.every((card) => typeof card.valeur === "number"));
    assert.equal(question.pool, undefined);
  }
  assert.equal(JSON.stringify(bank), before);
  assert.deepEqual(store.consume(bank, "partie-a"), questions);
});

test("cycle de 12 : dix exclusions, deux restes puis seuls trois compléments mémorisés", (t) => {
  const { store } = temporaryStore(t, { random: () => 0 });
  const bank = fixture();
  const first = byId(store.consume(bank, "cycle-1"));
  const second = byId(store.consume(bank, "cycle-2"));
  const beforeThird = store.read();
  const third = byId(store.consume(bank, "cycle-3"));
  const afterThird = store.read();
  for (const id of QUESTION_IDS) {
    const firstIds = new Set(first[id].cards.map((card) => card.id));
    assert.ok(second[id].cards.every((card) => !firstIds.has(card.id)));
    assert.equal(beforeThird.pools[id].length, 10);
    const oldUsed = new Set(beforeThird.pools[id]);
    const rest = bank.questions.find((question) => question.id === id).pool.filter((card) => !oldUsed.has(card.id));
    const thirdIds = new Set(third[id].cards.map((card) => card.id));
    assert.ok(rest.every((card) => thirdIds.has(card.id)));
    assert.equal(afterThird.pools[id].length, 3);
    assert.ok(afterThird.pools[id].every((cardId) => oldUsed.has(cardId) && thirdIds.has(cardId)));
    assert.ok(rest.every((card) => !afterThird.pools[id].includes(card.id)));
  }
});

test("cycles exacts et mémoires indépendantes selon la taille de chaque pool", (t) => {
  const sizes = Object.fromEntries(QUESTION_IDS.map((id, index) => [id, index % 2 ? 12 : 10]));
  const { store } = temporaryStore(t);
  const bank = fixture(sizes);
  store.consume(bank, "independent-1");
  store.consume(bank, "independent-2");
  for (const id of QUESTION_IDS) assert.equal(store.read().pools[id].length, 10);
  store.consume(bank, "independent-3");
  for (const id of QUESTION_IDS) assert.equal(store.read().pools[id].length, sizes[id] === 10 ? 5 : 3);
});

test("pool minimal de cinq cartes : chaque lancement ouvre correctement le cycle suivant", (t) => {
  const { store } = temporaryStore(t);
  const bank = fixture(5);
  for (let index = 0; index < 4; index++) {
    const questions = store.consume(bank, `five-${index}`);
    for (const question of questions) assert.equal(new Set(question.cards.map((card) => card.id)).size, 5);
    for (const ids of Object.values(store.read().pools)) assert.equal(ids.length, 5);
  }
});

test("consultation et validation ne consomment rien ; lancement idempotent et instantané isolé", (t) => {
  const { store, file } = temporaryStore(t);
  const bank = fixture();
  validateBonOrdreBank(bank);
  assert.deepEqual(store.read(), { version: 1, pools: {} });
  assert.equal(fs.existsSync(file), false);
  const first = store.consume(bank, "once");
  const initialSnapshot = JSON.stringify(first);
  const initialMemory = fs.readFileSync(file, "utf8");
  first[0].cards[0].valeur = 99999;
  first[0].cards.reverse();
  assert.equal(JSON.stringify(store.consume(bank, "once")), initialSnapshot);
  assert.equal(fs.readFileSync(file, "utf8"), initialMemory);
  assert.deepEqual(createBonOrdreStore(file).consume(bank, "once"), JSON.parse(initialSnapshot));
  assert.equal(fs.readFileSync(file, "utf8"), initialMemory);
});

test("mémoire persistante conservée après réinitialisation du module serveur", (t) => {
  const { store, file } = temporaryStore(t);
  const bank = fixture(10);
  const first = byId(store.consume(bank, "avant-restart"));
  const modulePath = require.resolve("../le-bon-ordre");
  delete require.cache[modulePath];
  const restartedStore = require("../le-bon-ordre").createBonOrdreStore(file);
  const second = byId(restartedStore.consume(bank, "apres-restart"));
  for (const id of QUESTION_IDS) {
    const oldIds = new Set(first[id].cards.map((card) => card.id));
    assert.ok(second[id].cards.every((card) => !oldIds.has(card.id)));
    assert.equal(store.read().pools[id].length, 10);
  }
});

test("plusieurs salons/instances relisent la mémoire avant de consommer", (t) => {
  const { store, file } = temporaryStore(t);
  const other = createBonOrdreStore(file);
  const bank = fixture(10);
  const first = byId(store.consume(bank, "salon-a"));
  const second = byId(other.consume(bank, "salon-b"));
  for (const id of QUESTION_IDS) {
    const ids = new Set(first[id].cards.map((card) => card.id));
    assert.ok(second[id].cards.every((card) => !ids.has(card.id)));
  }
});

test("mémoire corrompue/ancienne rejetée sans remise à zéro", (t) => {
  const { store, file } = temporaryStore(t);
  for (const contents of ["{cassé", JSON.stringify({ le_bon_ordre: ["ancienne-question"] }),
    JSON.stringify({ version: 2, pools: {} }), JSON.stringify({ version: 1, pools: { population: ["x", "x"] } })]) {
    fs.writeFileSync(file, contents);
    assert.throws(() => store.consume(fixture(), `corrupt-${contents}`), /corrompue|incompatible/);
    assert.equal(fs.readFileSync(file, "utf8"), contents);
    assert.equal(fs.existsSync(`${file}.lock`), false);
  }
});

test("échec de commit : aucun pool partiellement consommé, nettoyage et relance possible", (t) => {
  let fail = false;
  const storageFs = Object.create(fs);
  storageFs.renameSync = (...args) => {
    if (fail) { const error = new Error("disque indisponible"); error.code = "EIO"; throw error; }
    return fs.renameSync(...args);
  };
  const { store, file, directory } = temporaryStore(t, { fs: storageFs });
  const bank = fixture();
  store.consume(bank, "commit-ok");
  const initial = fs.readFileSync(file, "utf8");
  fail = true;
  assert.throws(() => store.consume(bank, "commit-retry"), /enregistrement/);
  assert.equal(fs.readFileSync(file, "utf8"), initial);
  assert.deepEqual(fs.readdirSync(directory), [path.basename(file)]);
  fail = false;
  store.consume(bank, "commit-retry");
  for (const ids of Object.values(store.read().pools)) assert.equal(ids.length, 10);
});

test("verrou de lancement concurrent : refus explicite sans consommation", (t) => {
  const { store, file } = temporaryStore(t);
  fs.writeFileSync(`${file}.lock`, "autre processus");
  assert.throws(() => store.consume(fixture(), "locked"), /occupée/);
  assert.equal(fs.existsSync(file), false);
  fs.unlinkSync(`${file}.lock`);
  assert.equal(store.consume(fixture(), "locked").length, 7);
});

test("cleanup après commit : un verrou non supprimable ne provoque pas un second tirage", (t) => {
  let denyCleanup = false;
  const warnings = [];
  t.mock.method(console, "error", (message) => warnings.push(message));
  const storageFs = Object.create(fs);
  storageFs.unlinkSync = (file) => {
    if (denyCleanup && file.endsWith(".lock")) throw Object.assign(new Error("verrou protégé"), { code: "EACCES" });
    return fs.unlinkSync(file);
  };
  const { store, file } = temporaryStore(t, { fs: storageFs });
  denyCleanup = true;
  const snapshot = store.consume(fixture(), "committed-once");
  const persisted = fs.readFileSync(file, "utf8");
  assert.equal(snapshot.length, 7, "Le lancement déjà commité réussit");
  assert.ok(warnings.some((message) => message.includes("nettoyage à vérifier")));
  assert.deepEqual(store.consume(fixture(), "committed-once"), snapshot);
  assert.equal(fs.readFileSync(file, "utf8"), persisted);
  assert.throws(() => store.consume(fixture(), "different-launch"), /occupée/);
  denyCleanup = false;
  fs.unlinkSync(`${file}.lock`);
});

test("échec avant commit : le nettoyage ne masque pas l'erreur originale", (t) => {
  const warnings = [];
  t.mock.method(console, "error", (message) => warnings.push(message));
  const storageFs = Object.create(fs);
  storageFs.renameSync = () => { throw Object.assign(new Error("commit disque refusé"), { code: "EIO" }); };
  storageFs.unlinkSync = (file) => {
    if (file.endsWith(".tmp")) throw Object.assign(new Error("temp protégé"), { code: "EACCES" });
    return fs.unlinkSync(file);
  };
  const { store, file } = temporaryStore(t, { fs: storageFs });
  assert.throws(() => store.consume(fixture(), "before-commit"), /commit disque refusé/);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(`${file}.lock`), false);
  assert.ok(warnings.some((message) => message.includes("temp protégé")));
});

function scoringQuestion(values = [50, 40, 30, 20, 10]) {
  return { id: "population", nom: "Population", question: "Classer",
    cards: values.map((valeur, index) => ({ id: `id-${index}`, nom: `Carte ${index}`, image: null, valeur })) };
}

test("notation centralisée : positions, valeurs et notes 1 / 0,5 / 0", () => {
  const question = scoringQuestion();
  const ids = question.cards.map((card) => card.id);
  assert.equal(gradeBonOrdre(question, ids).grade, 1);
  const partial = gradeBonOrdre(question, [ids[1], ids[0], ...ids.slice(2)]);
  assert.equal(partial.correctCount, 3);
  assert.equal(partial.grade, 0.5);
  assert.deepEqual(partial.positions[0], { ...question.cards[1], rank: 1, correct: false, correctRanks: [2] });
  assert.equal(gradeBonOrdre(question, [...ids].reverse()).grade, 0);
  assert.deepEqual(gradeBonOrdre(question, ids).expected.map((card) => card.rank), [1, 2, 3, 4, 5]);
  for (const [count, grade] of [[0, 0], [1, 0], [2, 0], [3, 0.5], [4, 0.5], [5, 1]]) assert.equal(bonOrdreGrade(count), grade);
});

test("égalité des valeurs : toutes leurs positions correspondantes sont acceptées", () => {
  const question = scoringQuestion([50, 50, 30, 20, 10]);
  const result = gradeBonOrdre(question, ["id-1", "id-0", "id-2", "id-3", "id-4"]);
  assert.equal(result.grade, 1);
  assert.equal(result.correctCount, 5);
  assert.deepEqual(result.positions[0].correctRanks, [1, 2]);
  const wrong = gradeBonOrdre(question, ["id-2", "id-1", "id-0", "id-3", "id-4"]);
  assert.equal(wrong.correctCount, 3);
  assert.equal(wrong.grade, 0.5);
  assert.deepEqual(wrong.positions[2].correctRanks, [1, 2]);
  assert.equal(gradeBonOrdre(scoringQuestion([-1, -2, -3, -4, -5]), ["id-0", "id-1", "id-2", "id-3", "id-4"]).grade, 1);
});

test("passage et absence restent explicites et valent zéro", () => {
  const question = scoringQuestion();
  for (const [answer, status] of [["pass", "pass"], [null, "missing"], [undefined, "missing"]]) {
    const result = gradeBonOrdre(question, answer);
    assert.equal(result.status, status);
    assert.equal(result.grade, 0);
    assert.equal(result.correctCount, 0);
    assert.deepEqual(result.positions, []);
    assert.equal(result.expected.length, 5);
  }
});

test("réponses : permutation exacte, sans doublon ni id étranger", () => {
  const question = scoringQuestion();
  const ids = question.cards.map((card) => card.id);
  assert.equal(isValidBonOrdreAnswer(question, ids), true);
  for (const invalid of [null, {}, "id-0", ids.slice(1), [...ids, "foreign"], [ids[0], ids[0], ...ids.slice(2)], [...ids.slice(0, 4), "foreign"]]) {
    assert.equal(isValidBonOrdreAnswer(question, invalid), false);
    if (invalid !== null) assert.throws(() => gradeBonOrdre(question, invalid), /réponse invalide/);
  }
});

test("confidentialité : le DTO est une whitelist indépendante des champs privés", () => {
  const question = scoringQuestion();
  question.pool = [{ valeur: 99999 }];
  question.expected = ["id-0"];
  question.secret = "secret serveur";
  question.cards[0].rank = 1;
  question.cards[0].correct = true;
  const safe = safeBonOrdreQuestion(question);
  assert.deepEqual(Object.keys(safe).sort(), ["cards", "id", "nom", "question"]);
  for (const card of safe.cards) assert.deepEqual(Object.keys(card).sort(), ["id", "image", "nom"]);
  assert.equal(/valeur|expected|pool|secret|correct|rank/.test(JSON.stringify(safe)), false);
  safe.cards[0].nom = "modification client";
  assert.equal(question.cards[0].nom, "Carte 0");
});
