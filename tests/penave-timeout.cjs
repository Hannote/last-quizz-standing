"use strict";

const assert = require("node:assert/strict");
const { connect } = require("./penave-live.cjs");

async function main() {
  const client = await connect();
  try {
    client.emit("createRoom", { pseudo: "Chrono", playerId: "chrono" });
    await client.wait("roomJoined");
    client.emit("hostSetGameMode", { gameMode: "liste" });
    await client.wait("roomUpdate", (r) => r.gameMode === "liste");
    client.emit("hostValidateListeConfig", { gameCount: 1, selectionMethod: "manual",
      selectedMiniGames: ["penave_ou_nachave"] });
    assert.equal((await client.wait("listeConfigResult")).ok, true);
    client.emit("hostStartGame", {});
    const rules = await client.wait("gameStateUpdate", (s) => s.phase === "rules", 40000);
    client.emit("playerSetReady", { isReady: true }, rules.listeContext);
    const active = await client.wait("gameStateUpdate", (s) => s.penaveState?.subPhase === "answer", 10000);
    const state = active.penaveState;
    const payload = (answer) => ({ answer, pass: false, instanceId: state.instanceId,
      turnNumber: state.turnNumber, passageId: state.passageId });
    client.emit("penaveAnswer", payload(""), active.listeContext);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(client.events.filter((entry) => entry.event === "gameStateUpdate").at(-1).payload.penaveState.subPhase,
      "answer");
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, state.deadline - Date.now() + 10)));
    client.emit("penaveAnswer", payload("trop tard"), active.listeContext);
    const summary = await client.wait("gameStateUpdate", (s) => s.penaveState?.subPhase === "round_summary", 5000);
    assert.equal(summary.penaveState.entries.length, 1);
    assert.equal(summary.penaveState.entries[0].status, "passed");
    assert.equal(summary.penaveState.entries[0].elapsedMs, 20000);
    const result = await client.wait("gameStateUpdate", (s) => s.penaveState?.subPhase === "final_ranking", 12000);
    assert.equal(result.penaveState.ranking[0].time, 20);
    console.log("Chronomètre : saisie vide ignorée, expiration et réponse tardive sans doublon OK");
  } finally { client.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
