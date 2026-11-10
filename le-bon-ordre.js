"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { shuffleCopy } = require("./question-shuffle");

const GROUP_IDS = Object.freeze([1, 2, 3, 4, 5, 6, 7]);
const MEMORY_VERSION = 1;
// Les salons d'un même processus partagent aussi la protection contre un double lancement.
const launchCaches = new WeakMap();

function invalid(message) {
  return new Error(`Le Bon Ordre : ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isText(value) {
  return typeof value === "string" && value.trim().length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

function validRelativeImage(value) {
  if (value === null) return true;
  if (!isText(value) || value !== value.trim()) return false;
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { return false; }
  if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || /^[\/\\]/.test(decoded) || /[\\?#\u0000-\u0020]/.test(decoded)) return false;
  const parts = decoded.split("/");
  return parts.every((part) => part && part !== "." && part !== "..") && parts[0] !== "public_2";
}

function copyCard(card) {
  return { id: card.id, nom: card.nom, image: card.image, valeur: card.valeur };
}

function validateBonOrdreBank(raw) {
  if (!isRecord(raw) || !Array.isArray(raw.questions)) {
    throw invalid("format de données invalide. Installez le JSON restructuré contenant questions et leurs pools.");
  }
  const seen = new Set();
  const groups = new Set();
  const questions = raw.questions.map((question, questionIndex) => {
    const label = `question ${questionIndex + 1}`;
    if (!isRecord(question) || !isText(question.id) || question.id !== question.id.trim()) {
      throw invalid(`${label} : identifiant stable non vide attendu.`);
    }
    if (seen.has(question.id)) throw invalid(`identifiant de question dupliqué : ${question.id}.`);
    seen.add(question.id);
    if (!Number.isInteger(question.groupe) || !GROUP_IDS.includes(question.groupe)) {
      throw invalid(`${question.id} : groupe entier de 1 à 7 attendu.`);
    }
    groups.add(question.groupe);
    if (!isText(question.nom) || !isText(question.question)) {
      throw invalid(`${question.id} : nom et consigne doivent être des textes non vides.`);
    }
    if (!Array.isArray(question.pool) || question.pool.length < 5) {
      throw invalid(`${question.id} : le pool doit contenir au moins cinq éléments.`);
    }
    const cardIds = new Set();
    const pool = question.pool.map((card, cardIndex) => {
      const cardLabel = `${question.id}, élément ${cardIndex + 1}`;
      if (!isRecord(card) || !isText(card.id) || card.id !== card.id.trim()) {
        throw invalid(`${cardLabel} : identifiant stable non vide attendu.`);
      }
      if (cardIds.has(card.id)) throw invalid(`${question.id} : identifiant d'élément dupliqué : ${card.id}.`);
      cardIds.add(card.id);
      if (!isText(card.nom)) throw invalid(`${cardLabel} : nom non vide attendu.`);
      if (typeof card.valeur !== "number" || !Number.isFinite(card.valeur)) {
        throw invalid(`${cardLabel} : valeur numérique finie attendue.`);
      }
      if (!validRelativeImage(card.image)) {
        throw invalid(`${cardLabel} : image doit être null ou un chemin URL relatif sûr sans préfixe public_2/.`);
      }
      return copyCard(card);
    });
    if (new Set(pool.map((card) => card.valeur)).size < 5) {
      throw invalid(`${question.id} : le pool doit contenir au moins cinq valeurs numériques distinctes.`);
    }
    return { id: question.id, groupe: question.groupe, nom: question.nom, question: question.question, pool };
  });
  if (groups.size !== GROUP_IDS.length) {
    throw invalid("le fichier doit contenir les sept groupes numérotés de 1 à 7, chacun avec au moins une variante.");
  }
  return { questions };
}

function emptyMemory() {
  return { version: MEMORY_VERSION, pools: {} };
}

function validateMemory(raw) {
  if (!isRecord(raw) || raw.version !== MEMORY_VERSION || !isRecord(raw.pools)) {
    throw invalid("mémoire d'éléments incompatible ou corrompue (version 1 attendue). Aucun historique n'a été réinitialisé.");
  }
  for (const [id, ids] of Object.entries(raw.pools)) {
    if (!isText(id) || !Array.isArray(ids) ||
        ids.some((item) => !isText(item)) || new Set(ids).size !== ids.length) {
      throw invalid(`mémoire du pool ${id} corrompue. Aucun historique n'a été réinitialisé.`);
    }
  }
  return { version: MEMORY_VERSION, pools: Object.fromEntries(Object.entries(raw.pools).map(([id, ids]) => [id, [...ids]])) };
}

function readMemory(file, storageFs) {
  let contents;
  try { contents = storageFs.readFileSync(file, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return emptyMemory();
    throw invalid(`lecture de la mémoire impossible : ${error.message}`);
  }
  let parsed;
  try { parsed = JSON.parse(contents); }
  catch (error) { throw invalid(`mémoire JSON corrompue : ${error.message}. Aucun historique n'a été réinitialisé.`); }
  return validateMemory(parsed);
}

function writeMemory(file, memory, storageFs) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  let committed = false;
  try {
    descriptor = storageFs.openSync(temporary, "wx", 0o600);
    storageFs.writeFileSync(descriptor, JSON.stringify(memory, null, 2) + "\n", "utf8");
    storageFs.fsyncSync(descriptor);
    storageFs.closeSync(descriptor);
    descriptor = undefined;
    // rename remplace atomiquement le fichier ; ne jamais supprimer d'abord la cible (Windows compris).
    storageFs.renameSync(temporary, file);
    committed = true;
  } catch (error) {
    throw invalid(`enregistrement de la mémoire impossible : ${error.message}`);
  } finally {
    if (descriptor !== undefined) {
      try { storageFs.closeSync(descriptor); }
      catch (error) { warnCleanup(temporary, error); }
    }
    if (!committed) {
      try { storageFs.unlinkSync(temporary); }
      catch (error) { if (error.code !== "ENOENT") warnCleanup(temporary, error); }
    }
  }
}

function warnCleanup(file, error) {
  // Un nettoyage raté après rename ne transforme pas un commit réussi en
  // lancement échoué, ce qui pourrait faire consommer les mêmes sept pools à nouveau.
  console.error(`Le Bon Ordre : nettoyage à vérifier pour ${file} : ${error.message}`);
}

function cloneQuestions(questions) {
  return questions.map((question) => ({
    id: question.id, groupe: question.groupe, nom: question.nom, question: question.question, cards: question.cards.map(copyCard)
  }));
}

// Les doublons de valeur restent dans la banque et dans la mémoire par id,
// mais ne peuvent jamais figurer ensemble dans une question affichée.
function distinctCards(cards, random, count = 5) {
  const values = new Set();
  return shuffleCopy(cards, random).filter((card) => {
    if (values.size >= count || values.has(card.valeur)) return false;
    values.add(card.valeur);
    return true;
  });
}

function consumeGroup(variants, pools, random) {
  const remainingFor = (question) => {
    const used = new Set(pools.get(question.id) || []);
    return question.pool.filter((card) => !used.has(card.id));
  };
  let available = variants;
  if (variants.length > 1) {
    available = variants.filter((question) =>
      new Set(remainingFor(question).map((card) => card.valeur)).size >= 5);
    if (!available.length) {
      // Toutes les variantes de ce groupe démarrent leur nouveau cycle ensemble.
      for (const question of variants) pools.set(question.id, []);
      available = variants;
    }
  }
  const question = available.length === 1 ? available[0] : available[Math.floor(random() * available.length)];
  const remaining = remainingFor(question);
  let selected = distinctCards(remaining, random);
  if (selected.length === 5) {
    pools.set(question.id, [...new Set([...(pools.get(question.id) || []), ...selected.map((card) => card.id)])]);
  } else {
    // Groupe à une variante : une carte par valeur inédite ferme l'ancien cycle.
    // Seul le complément, de valeurs différentes, est consommé dans le nouveau.
    const values = new Set(selected.map((card) => card.valeur));
    const complement = distinctCards(question.pool.filter((card) => !values.has(card.valeur)), random, 5 - selected.length);
    selected = [...selected, ...complement];
    pools.set(question.id, complement.map((card) => card.id));
  }
  return {
    id: question.id, groupe: question.groupe, nom: question.nom, question: question.question,
    cards: shuffleCopy(selected, random).map(copyCard)
  };
}

function createBonOrdreStore(filename, { random = Math.random, fs: storageFs = fs } = {}) {
  if (!isText(filename)) throw invalid("chemin de mémoire absent.");
  const file = path.resolve(filename);
  let storageCaches = launchCaches.get(storageFs);
  if (!storageCaches) { storageCaches = new Map(); launchCaches.set(storageFs, storageCaches); }
  let cache = storageCaches.get(file);
  if (!cache) { cache = new Map(); storageCaches.set(file, cache); }

  function locked(operation) {
    storageFs.mkdirSync(path.dirname(file), { recursive: true });
    const lockFile = `${file}.lock`;
    let lock;
    try { lock = storageFs.openSync(lockFile, "wx", 0o600); }
    catch (error) {
      if (error.code === "EEXIST") {
        throw invalid(`mémoire occupée par un autre lancement (${lockFile}). Réessayez ; si le serveur a été arrêté brutalement, vérifiez ce verrou avant de le retirer.`);
      }
      throw invalid(`verrouillage de la mémoire impossible : ${error.message}`);
    }
    try {
      storageFs.writeFileSync(lock, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      return operation();
    } finally {
      try { storageFs.closeSync(lock); }
      catch (error) { warnCleanup(lockFile, error); }
      try { storageFs.unlinkSync(lockFile); }
      catch (error) { if (error.code !== "ENOENT") warnCleanup(lockFile, error); }
    }
  }

  return {
    consume(rawBank, launchId) {
      if (!isText(launchId)) throw invalid("identifiant de lancement absent.");
      if (cache.has(launchId)) return cloneQuestions(cache.get(launchId));
      const bank = validateBonOrdreBank(rawBank);
      return locked(() => {
        const memory = readMemory(file, storageFs);
        const pools = new Map(Object.entries(memory.pools));
        const questions = GROUP_IDS.map((group) => consumeGroup(
          bank.questions.filter((question) => question.groupe === group), pools, random));
        const snapshot = shuffleCopy(questions, random);
        memory.pools = Object.fromEntries(pools);
        // Un seul commit pour les sept pools : aucun instantané n'est publié si ce commit échoue.
        writeMemory(file, memory, storageFs);
        cache.set(launchId, snapshot);
        return cloneQuestions(snapshot);
      });
    },
    read() { return readMemory(file, storageFs); },
    reset() {
      return locked(() => {
        const memory = emptyMemory();
        writeMemory(file, memory, storageFs);
        return memory;
      });
    },
    release(launchId) { cache.delete(launchId); }
  };
}

function safeBonOrdreQuestion(question) {
  return {
    id: question.id, nom: question.nom, question: question.question,
    cards: question.cards.map((card) => ({ id: card.id, nom: card.nom, image: card.image }))
  };
}

function isValidBonOrdreAnswer(question, ids) {
  if (!question || !Array.isArray(question.cards) || question.cards.length !== 5 ||
      !Array.isArray(ids) || ids.length !== 5 || new Set(ids).size !== 5) return false;
  const expected = new Set(question.cards.map((card) => card.id));
  return expected.size === 5 && ids.every((id) => typeof id === "string" && expected.has(id));
}

function bonOrdreGrade(correctCount) {
  return correctCount === 5 ? 1 : correctCount >= 3 ? 0.5 : 0;
}

function gradeBonOrdre(question, orderedIds) {
  const expected = [...question.cards].sort((a, b) => b.valeur - a.valeur)
    .map((card, index) => ({ ...copyCard(card), rank: index + 1 }));
  const status = orderedIds === "pass" ? "pass" : orderedIds == null ? "missing" : "answered";
  if (status !== "answered") return { expected, positions: [], correctCount: 0, grade: 0, status };
  if (!isValidBonOrdreAnswer(question, orderedIds)) throw invalid("réponse invalide : permutation exacte des cinq cartes attendue.");
  const cards = new Map(question.cards.map((card) => [card.id, card]));
  const positions = orderedIds.map((id, index) => {
    const card = cards.get(id);
    return {
      ...copyCard(card), rank: index + 1,
      correct: card.valeur === expected[index].valeur,
      correctRanks: expected.filter((item) => item.valeur === card.valeur).map((item) => item.rank)
    };
  });
  const correctCount = positions.filter((card) => card.correct).length;
  return { expected, positions, correctCount, grade: bonOrdreGrade(correctCount), status };
}

module.exports = {
  GROUP_IDS, MEMORY_VERSION, validateBonOrdreBank, createBonOrdreStore,
  safeBonOrdreQuestion, isValidBonOrdreAnswer, bonOrdreGrade, gradeBonOrdre
};
