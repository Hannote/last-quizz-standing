"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const file = path.join(__dirname, "../liste-flow.test.js");
const setup = fs.readFileSync(file, "utf8").split("function startPenaveRound()")[0]
  .replace("roomCreationQuota, startCorrectionPhase", "roomCreationQuota, startCorrectionPhase, getMiniGameScoreUpdate, performElimination");
const context = { require: createRequire(file), __dirname: path.dirname(file), Buffer, process };
vm.runInNewContext(setup + "\nglobalThis.makeHarness = harness;", context);

function start(mode, game, count = 3) {
  const h = context.makeHarness();
  const { room, clients } = h.create(count);
  if (mode === "liste") h.configure(room, clients[0], "manual", [game]);
  clients[0].send("hostStartGame", mode === "liste" ? {} : { forcedMiniGame: game });
  if (mode === "battle_royale") h.advance(32500);
  clients[0].send("drawingFinished");
  h.advance(9300);
  clients.forEach(client => client.send("playerSetReady", { isReady: true }));
  return { h, room, clients, mini: room.gameState.currentMiniGameState || room.mini };
}

const last = (h, name, client) => h.events.filter(e => e.name === name && (!client || e.target === client.id)).at(-1)?.data;
module.exports = { makeHarness: context.makeHarness, start, last };
