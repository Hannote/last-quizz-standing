"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const file = path.join(__dirname, "../liste-flow.test.js");
const setup = fs.readFileSync(file, "utf8").split("function startPenaveRound()")[0]
  .replace("roomCreationTimes, startCorrectionPhase", "roomCreationTimes, startCorrectionPhase, logomaniaData, pickLogomaniaQuestions, getPlayedHistory, savePlayedHistory, destroyRoom")
  .replace("history = data;", 'if (env.TEST_FAIL_SAVE) throw new Error("écriture de test impossible"); history = data;')
  .replace("error: assert.fail", 'error: (...args) => events.push({ name: "serverError", data: String(args[0]) })');
const context = { require: createRequire(file), __dirname: path.dirname(file), Buffer, process };
vm.runInNewContext(setup + "\nglobalThis.makeHarness = harness;", context);
module.exports = { makeHarness: context.makeHarness };
