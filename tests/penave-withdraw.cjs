"use strict";

const assert = require("node:assert/strict");
const { connect } = require("./penave-live.cjs");

async function main() {
  const clients = { a: await connect(), b: await connect(), c: await connect() };
  try {
    clients.a.emit("createRoom", { pseudo: "A", playerId: "a" });
    const room = await clients.a.wait("roomJoined");
    for (const id of ["b", "c"]) {
      clients[id].emit("joinRoom", { pseudo: id.toUpperCase(), playerId: id, roomCode: room.roomCode });
      await clients[id].wait("roomJoined");
    }
    clients.a.emit("hostSetGameMode", { gameMode: "liste" });
    await clients.a.wait("roomUpdate", (r) => r.gameMode === "liste");
    clients.a.emit("hostValidateListeConfig", { gameCount: 1,
      selectionMethod: "manual", selectedMiniGames: ["penave_ou_nachave"] });
    assert.equal((await clients.a.wait("listeConfigResult")).ok, true);
    clients.a.emit("hostStartGame", {});
    const rules = await clients.a.wait("gameStateUpdate", (s) => s.phase === "rules", 40000);
    for (const client of Object.values(clients)) client.emit("playerSetReady", { isReady: true }, rules.listeContext);
    const first = await clients.a.wait("gameStateUpdate", (s) => s.penaveState?.subPhase === "answer", 10000);
    const withdrawnId = first.penaveState.activePlayerId;
    const observer = withdrawnId === "a" ? clients.b : clients.a;
    clients[withdrawnId].emit("leaveRoom", null);
    const changed = await observer.wait("roomUpdate", (r) =>
      r.players.find((p) => p.playerId === withdrawnId)?.withdrawn, 3000);
    assert.equal(changed.players.find((p) => p.playerId === withdrawnId).eliminated, false);
    let previous = first.penaveState.passageId;
    for (let index = 0; index < 2; index++) {
      const next = await observer.wait("gameStateUpdate", (s) => s.penaveState?.subPhase === "answer" &&
        s.penaveState.passageId > previous, 4000);
      previous = next.penaveState.passageId;
      const state = next.penaveState;
      assert.notEqual(state.activePlayerId, withdrawnId);
      clients[state.activePlayerId].emit("penaveAnswer", {
        answer: "", pass: true, instanceId: state.instanceId,
        turnNumber: state.turnNumber, passageId: state.passageId
      }, next.listeContext);
    }
    const ranking = await observer.wait("gameStateUpdate", (s) => s.penaveState?.subPhase === "final_ranking", 15000);
    assert.equal(ranking.penaveState.ranking.length, 2);
    assert(ranking.penaveState.ranking.every((entry) => entry.playerId !== withdrawnId));
    assert.deepEqual(ranking.penaveState.ranking.map((entry) => entry.points), [3, 2]);
    const settled = await observer.wait("roomUpdate", (r) => r.listeTournament.roundResults.length === 1, 15000);
    assert.equal(settled.listeTournament.roundResults[0].placements.length, 2);
    assert.equal(settled.players.find((p) => p.playerId === withdrawnId).tournamentPoints, 0);
    console.log("Abandon explicite : passage débloqué, aucun eliminated, aucun point pour le retiré OK");
  } finally { for (const client of Object.values(clients)) client.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
