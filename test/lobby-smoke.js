"use strict";

const assert = require("node:assert/strict");

const socketUrl = process.env.TEST_SERVER_URL || "ws://127.0.0.1:3000/socket.io/?EIO=4&transport=websocket";
const socket = new WebSocket(socketUrl);
const waiters = [];

function waitForEvent(eventName, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Délai dépassé pour ${eventName}.`)), 3000);
    waiters.push({
      eventName,
      predicate,
      resolve: (payload) => {
        clearTimeout(timer);
        resolve(payload);
      }
    });
  });
}

function emit(eventName, payload) {
  socket.send(`42${JSON.stringify([eventName, payload])}`);
}

socket.addEventListener("message", (message) => {
  const frame = String(message.data);
  if (frame === "2") return socket.send("3");
  if (!frame.startsWith("42")) return;
  const [eventName, payload] = JSON.parse(frame.slice(2));
  const index = waiters.findIndex((waiter) =>
    waiter.eventName === eventName && waiter.predicate(payload));
  if (index >= 0) waiters.splice(index, 1)[0].resolve(payload);
});

async function run() {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Connexion Socket.IO impossible.")), 3000);
    socket.addEventListener("message", function onHandshake(message) {
      if (!String(message.data).startsWith("0")) return;
      socket.removeEventListener("message", onHandshake);
      socket.send("40");
    });
    socket.addEventListener("message", function onConnected(message) {
      if (!String(message.data).startsWith("40")) return;
      socket.removeEventListener("message", onConnected);
      clearTimeout(timer);
      resolve();
    });
    socket.addEventListener("error", reject, { once: true });
  });

  const playerId = `smoke-${Date.now()}`;
  const joinedPromise = waitForEvent("roomJoined");
  emit("createRoom", { pseudo: "Smoke Test", playerId });
  const initialRoom = await joinedPromise;
  assert.equal(initialRoom.gameMode, "battle_royale");
  assert.deepEqual(initialRoom.listeTournament.roundResults, []);
  assert.deepEqual(initialRoom.listeTournament.generalRanking, []);

  const listeRoomPromise = waitForEvent("roomUpdate", (room) => room.gameMode === "liste");
  emit("hostSetGameMode", { gameMode: "liste" });
  const listeRoom = await listeRoomPromise;
  assert.equal(listeRoom.roomCode, initialRoom.roomCode);

  const configPromise = waitForEvent("listeConfigResult", (result) => result.ok === true);
  emit("hostValidateListeConfig", {
    gameCount: 1,
    selectionMethod: "random",
    selectedMiniGames: []
  });
  await configPromise;

  const startedPromise = waitForEvent("gameStateUpdate", (state) =>
    state.gameMode === "liste" && state.phase === "drawingGame");
  emit("hostStartGame", {});
  const started = await startedPromise;
  assert.equal(started.roundNumber, 1);
  assert.ok(started.listeContext.tournamentId);
  assert.notEqual(started.currentMiniGame, "les_encheres");
  const rulesPromise = waitForEvent("gameStateUpdate", (state) => state.phase === "rules");
  socket.send(`42${JSON.stringify(["drawingFinished", null, started.listeContext])}`);
  await rulesPromise;
  emit("leaveRoom");

  const newRoomPromise = waitForEvent("roomJoined", (room) => room.gameMode === "battle_royale");
  emit("createRoom", { pseudo: "Smoke BR", playerId });
  await newRoomPromise;
  const introPromise = waitForEvent("gameStateUpdate", (state) =>
    state.gameMode === "battle_royale" && state.phase === "intro");
  emit("hostStartGame", { forcedMiniGame: "qui_suis_je" });
  await introPromise;

  socket.close();
  console.log("Smoke Socket.IO réussi : lancement Liste, contexte de manche, règles, abandon et nouvelle partie Battle Royale.");
}

run().catch((error) => {
  socket.close();
  console.error(error);
  process.exitCode = 1;
});
