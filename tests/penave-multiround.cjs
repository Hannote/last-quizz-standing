"use strict";

const assert = require("node:assert/strict");
const { connect } = require("./penave-live.cjs");

async function main() {
  const clients = { alice: await connect(), bob: await connect(), clara: await connect() };
  const all = Object.values(clients);
  const payload = (s, extra) => ({ ...extra, instanceId: s.penaveState.instanceId,
    turnNumber: s.penaveState.turnNumber, passageId: s.penaveState.passageId });
  try {
    clients.alice.emit("createRoom", { pseudo: "Alice", playerId: "alice" });
    const room = await clients.alice.wait("roomJoined");
    const credential = await clients.alice.wait("reconnectCredential");
    for (const [id, name] of [["bob", "Bob"], ["clara", "Clara"]]) {
      clients[id].emit("joinRoom", { pseudo: name, playerId: id, roomCode: room.roomCode });
      await clients[id].wait("roomJoined");
    }
    clients.alice.emit("hostSetGameMode", { gameMode: "liste" });
    await clients.alice.wait("roomUpdate", (r) => r.gameMode === "liste");
    clients.alice.emit("hostValidateListeConfig", { gameCount: 1, selectionMethod: "manual",
      selectedMiniGames: ["penave_ou_nachave"] });
    assert.equal((await clients.alice.wait("listeConfigResult")).ok, true);
    clients.alice.emit("hostStartGame", {});
    const rules = await clients.alice.wait("gameStateUpdate", (s) => s.phase === "rules", 40000);
    for (const client of all) client.emit("playerSetReady", { isReady: true }, rules.listeContext);
    await clients.bob.wait("gameStateUpdate", (s) => s.penaveState?.subPhase === "answer", 10000);
    let host = clients.alice;
    const served = [];
    let previousPassage = 0;
    for (let index = 0; index < 3; index++) {
      const state = await clients.bob.wait("gameStateUpdate", (s) => s.penaveState?.subPhase === "answer" &&
        s.penaveState.turnNumber === 1 && s.penaveState.passageId > previousPassage, 6000);
      previousPassage = state.penaveState.passageId;
      const id = state.penaveState.activePlayerId;
      served.push(id);
      if (index === 2) {
        clients[id].emit("penaveAnswer", payload(state, { answer: "", pass: true }), state.listeContext);
      } else {
        if (index === 1) await new Promise((resolve) => setTimeout(resolve, 220));
        clients[id].emit("penaveAnswer", payload(state, { answer: `réponse ${index}`, pass: false }), state.listeContext);
        const correction = await clients.bob.wait("gameStateUpdate", (s) => s.penaveState?.subPhase === "correction" &&
          s.penaveState.passageId === previousPassage, 3000);
        if (index === 0) {
          clients.alice.close();
          const update = await clients.bob.wait("roomUpdate", (r) => r.hostId === "bob", 3000);
          assert.equal(update.hostId, "bob");
          const restoredCorrection = await clients.bob.wait("gameStateUpdate", (s) =>
            s.penaveState?.subPhase === "correction" &&
            s.penaveState.passageId === correction.penaveState.passageId, 3000,
            clients.bob.events.length - 1);
          assert.equal(restoredCorrection.penaveState.entries.at(-1).status, "pending");
          host = clients.bob;
        }
        host.emit("penaveGrade", payload(correction, { accepted: true }), correction.listeContext);
        if (index === 0) {
          clients.alice = await connect();
          clients.alice.emit("joinRoom", { pseudo: "Alice", playerId: "alice",
            roomCode: room.roomCode, reconnectSecret: credential.reconnectSecret });
          await clients.alice.wait("roomJoined");
          const resumed = await clients.alice.wait("gameStateUpdate", (s) => s.penaveState?.instanceId === state.penaveState.instanceId);
          assert.equal(resumed.penaveState.affirmation, state.penaveState.affirmation);
        }
      }
    }
    const summary = await clients.bob.wait("gameStateUpdate", (s) => s.penaveState?.subPhase === "round_summary" &&
      s.penaveState.turnNumber === 1, 4000);
    assert.deepEqual(summary.penaveState.roundEliminatedIds, [served[2]]);
    const remaining = served.slice(0, 2);
    assert.deepEqual(summary.penaveState.order.filter((id) => remaining.includes(id)), remaining);
    for (let index = 0; index < 2; index++) {
      const state = await clients.bob.wait("gameStateUpdate", (s) => s.penaveState?.subPhase === "answer" &&
        s.penaveState.turnNumber === 2 && s.penaveState.passageId > previousPassage, 8000);
      previousPassage = state.penaveState.passageId;
      assert.equal(state.penaveState.activePlayerId, remaining[index]);
      clients[remaining[index]].emit("penaveAnswer", payload(state, { answer: "", pass: true }), state.listeContext);
    }
    const ranking = await clients.bob.wait("gameStateUpdate", (s) => s.penaveState?.subPhase === "final_ranking", 15000);
    assert.equal(ranking.penaveState.ranking.length, 3);
    assert.equal(ranking.penaveState.ranking[0].playerId, remaining[0]);
    assert.deepEqual(ranking.penaveState.ranking.map((x) => x.points), [3, 2, 1]);
    const lobby = await clients.bob.wait("roomUpdate", (r) => r.listeTournament.roundResults.length === 1, 15000);
    assert(lobby.players.every((player) => !player.eliminated && !player.withdrawn));
    console.log("Pénave multi tours : ordre, transfert d'hôte, reconnexion, élimination interne et points OK");
  } finally { for (const client of Object.values(clients)) client.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
