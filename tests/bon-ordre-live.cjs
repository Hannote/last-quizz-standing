"use strict";

const assert = require("node:assert/strict");
const bank = require("../public_2/le_bon_ordre/le_bon_ordre.json");
const { gradeBonOrdre } = require("../le-bon-ordre");
process.env.LQS_TEST_URL ||= "ws://127.0.0.1:3000/socket.io/?EIO=4&transport=websocket";
const { connect } = require("./penave-live.cjs");

async function play(mode) {
  const clients = await Promise.all([connect(), connect(), connect()]);
  let observer;
  let returned;
  try {
    const ids = clients.map((_, index) => `bon_${mode}_${index}`);
    clients[0].emit("createRoom", { pseudo: "Hôte Bon Ordre", playerId: ids[0] });
    const room = await clients[0].wait("roomJoined");
    for (let index = 1; index < clients.length; index++) {
      clients[index].emit("joinRoom", { pseudo: `Joueur ${index}`, playerId: ids[index], roomCode: room.roomCode });
      await clients[index].wait("roomJoined");
    }
    const latestContext = (client) => client.events.map((entry) => entry.event === "listeContext" ? entry.payload :
      entry.event === "gameStateUpdate" ? entry.payload?.listeContext : null).filter(Boolean).at(-1);
    const emit = (client, event, payload) => client.emit(event, payload, mode === "liste" ? latestContext(client) : undefined);
    const reconnect = async playerIndex => {
      const oldClient = clients[playerIndex];
      const secret = oldClient.events.find(entry => entry.event === "reconnectCredential").payload.reconnectSecret;
      const newClient = await connect();
      newClient.emit("joinRoom", { roomCode: room.roomCode, playerId: ids[playerIndex],
        pseudo: `Joueur reconnecté ${playerIndex}`, reconnectSecret: secret });
      await newClient.wait("roomJoined");
      clients[playerIndex] = newClient;
      oldClient.close();
      return newClient;
    };
    if (mode === "liste") {
      emit(clients[0], "hostSetGameMode", { gameMode: "liste" });
      await clients[0].wait("roomUpdate", (r) => r.gameMode === "liste");
      emit(clients[0], "hostValidateListeConfig", { gameCount: 1, selectionMethod: "manual", selectedMiniGames: ["le_bon_ordre"] });
      assert.equal((await clients[0].wait("listeConfigResult")).ok, true);
    }
    emit(clients[0], "hostStartGame", mode === "liste" ? {} : { forcedMiniGame: "le_bon_ordre" });
    await clients[0].wait("gameStateUpdate", (s) => s.phase === "drawingGame", 40000);
    emit(clients[0], "drawingFinished", null);
    await Promise.all(clients.map((client) => client.wait("gameStateUpdate", (s) => s.phase === "rules")));
    for (const client of clients) emit(client, "playerSetReady", { isReady: true });
    const first = await clients[0].wait("leBonOrdreQuestion");
    observer = await connect();
    observer.emit("joinRoom", { roomCode: room.roomCode, playerId: `${ids[0]}_viewer`, pseudo: "Spectateur" });
    await observer.wait("roomJoined");
    const observed = await observer.wait("leBonOrdreQuestion");
    assert.deepEqual(observed.question.cards, first.question.cards);
    assert.equal(observed.hasAnswered, false);
    for (let index = 0; index < 7; index++) {
      const question = await clients[0].wait("leBonOrdreQuestion", (q) => q.questionIndex === index);
      const timer = await clients[0].wait("leBonOrdreTimerUpdate", (t) => t.questionIndex === index && t.active);
      assert(timer.remaining > 0);
      const source = bank.questions.find((q) => q.id === question.question.id);
      const values = new Map(source.pool.map((card) => [card.id, card.valeur]));
      const orderedIds = question.question.cards.map((card) => card.id).sort((a, b) => values.get(b) - values.get(a));
      const action = { instanceId: question.instanceId, questionId: question.questionId, questionIndex: index,
        orderedIds, pass: false };
      const bobOrder = [...orderedIds.slice(1), orderedIds[0]];
      const submissions = [action, { ...action, orderedIds: bobOrder }, { ...action, orderedIds: null, pass: true }];
      for (let playerIndex = 0; playerIndex < clients.length; playerIndex++) {
        const client = clients[playerIndex];
        await client.wait("leBonOrdreTimerUpdate", (t) => t.questionIndex === index && t.active);
        emit(client, "leBonOrdreAnswer", submissions[playerIndex]);
        await client.wait("leBonOrdreAnswerAck", (ack) => ack.questionIndex === index);
        if (index === 0 && client === clients[0]) {
          const secret = client.events.find((entry) => entry.event === "reconnectCredential").payload.reconnectSecret;
          returned = await connect();
          returned.emit("joinRoom", { roomCode: room.roomCode, playerId: ids[0], pseudo: "Hôte reconnecté", reconnectSecret: secret });
          const sync = await returned.wait("leBonOrdreQuestion");
          assert.equal(sync.hasAnswered, true);
          assert.deepEqual(sync.savedAnswer.orderedIds, orderedIds);
          assert.deepEqual(sync.question.cards, question.question.cards);
          client.close();
          clients[0] = returned;
        }
      }
      const corrections = await Promise.all([...clients, observer].map(client =>
        client.wait("leBonOrdreCorrection", (c) => c.questionIndex === index)));
      const alice = corrections[0];
      const bob = corrections[1];
      const spectator = corrections[3];
      assert.equal(alice.bonOrdreData.grade, 1);
      assert.deepEqual(alice.bonOrdreData.positions.map(card => card.id), orderedIds);
      assert.deepEqual(bob.bonOrdreData.positions.map(card => card.id), bobOrder);
      const bobResult = gradeBonOrdre({ cards: question.question.cards.map(card => ({ ...card, valeur: values.get(card.id) })) }, bobOrder);
      assert.equal(bob.bonOrdreData.grade, bobResult.grade);
      assert.equal(corrections[2].bonOrdreData.status, "pass");
      assert.equal(corrections[2].bonOrdreData.grade, 0);
      assert.equal(spectator.isParticipant, false);
      assert.equal(spectator.bonOrdreData.status, "spectator");
      assert.equal(spectator.bonOrdreData.positions.length, 0);
      assert(!spectator.playerPseudo);
      assert.equal(alice.correctionEndsAt - alice.correctionStartedAt, 15000);
      assert.equal(bob.correctionEndsAt, alice.correctionEndsAt);
      assert(alice.remainingMs > 14000 && alice.remainingMs <= 15000);
      for (const client of [...clients, observer]) for (const entry of client.events) {
        if (entry.event !== "leBonOrdreCorrection") {
          assert.doesNotMatch(JSON.stringify(entry.payload) || "", /"(?:valeur|expected|pool|correctRanks|correctCount|positions)"\s*:/);
        }
        assert.notEqual(entry.event, "correctionUpdate", "Ancien espace de correction débranché");
      }
      // Une nouvelle connexion pendant la correction restaure la phase et son échéance.
      if (index === 0) {
        const connected = await reconnect(0);
        const restored = await connected.wait("leBonOrdreCorrection", (c) => c.questionIndex === index, 5000);
        assert.equal(restored.correctionEndsAt, alice.correctionEndsAt);
        assert.deepEqual(restored.bonOrdreData.positions, alice.bonOrdreData.positions);
      }
      const leaderboard = await clients[0].wait("leBonOrdreLeaderboard", (c) => c.questionIndex === index, 20000);
      assert(leaderboard.startedAt >= alice.correctionEndsAt);
      assert.equal(leaderboard.durationMs, index === 6 ? 4500 : 3000);
      assert.equal(leaderboard.players.length, 3);
      assert.equal(leaderboard.previousPlayers.find(player => player.id === ids[0]).score, index);
      assert.equal(leaderboard.players.find(player => player.id === ids[0]).score, index + 1);
      if (index === 0) {
        const connected = await reconnect(1);
        const restored = await connected.wait("leBonOrdreLeaderboard", (c) => c.questionIndex === index, 2000);
        assert.equal(restored.endsAt, leaderboard.endsAt);
      }
      if (index < 6) {
        const next = await clients[0].wait("leBonOrdreQuestion", (q) => q.questionIndex === index + 1, 6000);
        assert.equal(next.timer.active, false, "Thème avant démarrage du chrono suivant");
      }
      console.log(`${mode}: Q${index + 1} correction privée 15 s puis classement OK`);
    }
    if (mode === "liste") {
      const summary = await clients[0].wait("gameStateUpdate", (s) => s.phase === "listeLeaderboard");
      assert.equal(summary.listeLeaderboard.ranking.length, 3);
    } else {
      await clients[0].wait("leBonOrdreExit");
      await clients[0].wait("playFinaleAnimation", () => true, 12000);
    }
    console.log(`${mode}: 3 clients + spectateur, 7 corrections personnelles, classements et fin unique OK`);
  } catch (error) {
    console.error(mode, clients[0].events.slice(-4));
    throw error;
  } finally {
    for (const client of new Set([...clients, observer, returned].filter(Boolean))) client.close();
  }
}

async function main() {
  for (const suffix of ["/le_bon_ordre/le_bon_ordre.json", "/LE_BON_ORDRE/LE_BON_ORDRE.JSON", "/le_bon_ordre/%6ce_bon_ordre.json?x=1"]) {
    assert.equal((await fetch(`http://127.0.0.1:3000${suffix}`)).status, 404, suffix);
  }
  await Promise.all([play("battle_royale"), play("liste")]);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
