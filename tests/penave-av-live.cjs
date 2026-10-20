"use strict";

const assert = require("node:assert/strict");
const { connect } = require("./penave-live.cjs");

async function main() {
  const clients = [await connect(), await connect(), await connect()];
  const [host, second, third] = clients;
  const ids = ["penave-host", "penave-second", "penave-third"];
  const byId = Object.fromEntries(ids.map((id, index) => [id, clients[index]]));
  const action = (client, event, state, extra = {}) => client.emit(event, {
    ...extra, instanceId: state.penaveState.instanceId,
    turnNumber: state.penaveState.turnNumber, passageId: state.penaveState.passageId
  }, state.listeContext);
  try {
    host.emit("createRoom", { pseudo: "Hôte", playerId: ids[0] });
    const room = await host.wait("roomJoined");
    for (let index = 1; index < clients.length; index++) {
      clients[index].emit("joinRoom", { pseudo: `Joueur ${index}`, playerId: ids[index], roomCode: room.roomCode });
      await clients[index].wait("roomJoined");
    }
    host.emit("hostSetGameMode", { gameMode: "liste" });
    await host.wait("roomUpdate", (value) => value.gameMode === "liste");
    host.emit("hostValidateListeConfig", { gameCount: 1, selectionMethod: "manual",
      selectedMiniGames: ["penave_ou_nachave"] });
    assert.equal((await host.wait("listeConfigResult")).ok, true);
    host.emit("hostStartGame", {});
    const rules = await host.wait("gameStateUpdate", (value) => value.phase === "rules", 40000);
    for (const client of clients) client.emit("playerSetReady", { isReady: true }, rules.listeContext);
    await host.wait("gameStateUpdate", (value) => value.penaveState?.subPhase === "theme");
    const cue = await host.wait("gameStateUpdate", (value) => value.penaveState?.subPhase === "cue");
    assert.equal(cue.penaveState.deadline, null);
    assert.equal(cue.penaveState.remainingMs, 0);
    const firstActor = byId[cue.penaveState.activePlayerId];
    const early = host.events.length;
    action(clients.find((client) => client !== firstActor), "penaveCueFinished", cue);
    action(firstActor, "penaveAnswer", cue, { answer: "trop tôt", pass: false });
    await new Promise((resolve) => setTimeout(resolve, 950));
    assert(!host.events.slice(early).some((entry) => entry.payload?.penaveState?.subPhase === "answer"));
    assert(!host.events.slice(early).some((entry) => entry.payload?.penaveState?.subPhase === "correction"));
    action(firstActor, "penaveCueFinished", cue);
    const answer = await host.wait("gameStateUpdate", (value) => value.penaveState?.subPhase === "answer" &&
      value.penaveState.passageId === cue.penaveState.passageId, 3000, early);
    assert(answer.penaveState.remainingMs > 19000);
    assert(answer.penaveState.deadline > Date.now());
    action(firstActor, "penaveAnswer", answer, { answer: "Réponse acceptée", pass: false });
    const correction = await host.wait("gameStateUpdate", (value) => value.penaveState?.subPhase === "correction");
    action(host, "penaveGrade", correction, { accepted: false });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(host.events.filter((entry) => entry.payload?.penaveState).at(-1).payload.penaveState.entries.at(-1).status, "pending");
    await new Promise((resolve) => setTimeout(resolve, 750));
    action(host, "penaveGrade", correction, { accepted: true });
    const accepted = await host.wait("gameStateUpdate", (value) =>
      value.penaveState?.entries.at(-1)?.status === "accepted");
    assert.equal(accepted.penaveState.entries.at(-1).gradedAt > 0, true);
    assert.equal(accepted.penaveState.subPhase, "between");

    const cueTwo = await host.wait("gameStateUpdate", (value) => value.penaveState?.subPhase === "cue" &&
      value.penaveState.passageId > cue.penaveState.passageId);
    const answerTwo = await host.wait("gameStateUpdate", (value) => value.penaveState?.subPhase === "answer" &&
      value.penaveState.passageId === cueTwo.penaveState.passageId);
    action(byId[answerTwo.penaveState.activePlayerId], "penaveAnswer", answerTwo,
      { answer: "Réponse refusée", pass: false });
    const correctionTwo = await host.wait("gameStateUpdate", (value) => value.penaveState?.subPhase === "correction" &&
      value.penaveState.passageId === cueTwo.penaveState.passageId);
    await new Promise((resolve) => setTimeout(resolve, 900));
    action(host, "penaveGrade", correctionTwo, { accepted: false });
    const refused = await host.wait("gameStateUpdate", (value) =>
      value.penaveState?.entries.at(-1)?.status === "refused" && value.penaveState.passageId === cueTwo.penaveState.passageId);
    assert.equal(refused.penaveState.entries.at(-1).elapsedMs <= 20000, true);

    const cueThree = await host.wait("gameStateUpdate", (value) => value.penaveState?.subPhase === "cue" &&
      value.penaveState.passageId > cueTwo.penaveState.passageId);
    const answerThree = await host.wait("gameStateUpdate", (value) => value.penaveState?.subPhase === "answer" &&
      value.penaveState.passageId === cueThree.penaveState.passageId);
    action(byId[answerThree.penaveState.activePlayerId], "penaveAnswer", answerThree,
      { answer: "Deuxième réponse acceptée", pass: false });
    const correctionThree = await host.wait("gameStateUpdate", (value) => value.penaveState?.subPhase === "correction" &&
      value.penaveState.passageId === cueThree.penaveState.passageId);
    await new Promise((resolve) => setTimeout(resolve, 900));
    action(host, "penaveGrade", correctionThree, { accepted: true });
    const summary = await host.wait("gameStateUpdate", (value) => value.penaveState?.subPhase === "round_summary");
    assert.deepEqual(summary.penaveState.roundEliminatedIds, [answerTwo.penaveState.activePlayerId]);
    assert.equal(summary.penaveState.survivorIds.length, 2);
    for (const client of clients) {
      const seen = await client.wait("gameStateUpdate", (value) => value.penaveState?.subPhase === "round_summary");
      assert.deepEqual(seen.penaveState.roundEliminatedIds, summary.penaveState.roundEliminatedIds);
    }
    let previousPassage = answerThree.penaveState.passageId;
    for (let index = 0; index < 2; index++) {
      const nextAnswer = await host.wait("gameStateUpdate", (value) => value.penaveState?.subPhase === "answer" &&
        value.penaveState.turnNumber === 2 && value.penaveState.passageId > previousPassage, 10000);
      previousPassage = nextAnswer.penaveState.passageId;
      assert(summary.penaveState.survivorIds.includes(nextAnswer.penaveState.activePlayerId));
      for (const client of clients) {
        const shared = await client.wait("gameStateUpdate", (value) => value.penaveState?.subPhase === "answer" &&
          value.penaveState.passageId === previousPassage);
        assert.equal(shared.penaveState.deadline, nextAnswer.penaveState.deadline);
      }
      action(byId[nextAnswer.penaveState.activePlayerId], "penaveAnswer", nextAnswer, { answer: "", pass: true });
      for (const client of clients) {
        const closed = await client.wait("gameStateUpdate", (value) => value.penaveState?.subPhase === "between" &&
          value.penaveState.passageId === previousPassage);
        assert.equal(closed.penaveState.deadline, null);
      }
    }
    const victory = await host.wait("gameStateUpdate", (value) => value.penaveState?.subPhase === "victory", 10000);
    assert(victory.penaveState.announcement.includes("gagne la partie"));
    const ranking = await host.wait("gameStateUpdate", (value) => value.penaveState?.subPhase === "final_ranking", 15000);
    assert.deepEqual(ranking.penaveState.ranking.map((entry) => entry.points), [3, 2, 1]);
    await host.wait("gameStateUpdate", (value) => value.penaveState?.subPhase === "end_logo", 10000);
    await host.wait("gameStateUpdate", (value) => value.phase === "listeLeaderboard", 10000);
    console.log("Pénave AV : 3 clients dont un éliminé recevant la réponse suivante, cue, correction, classement et fin OK");
  } finally {
    for (const client of clients) client.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
