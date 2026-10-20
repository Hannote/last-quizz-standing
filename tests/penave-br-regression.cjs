"use strict";

const assert = require("node:assert/strict");
const { connect } = require("./penave-live.cjs");

async function main() {
  const players = [await connect(), await connect(), await connect()];
  try {
    players[0].emit("createRoom", { pseudo: "Hôte", playerId: "br_host" });
    const room = await players[0].wait("roomJoined");
    assert.equal(room.gameMode, "battle_royale");
    for (let index = 1; index < players.length; index++) {
      players[index].emit("joinRoom", { pseudo: `Joueur ${index}`, playerId: `br_${index}`,
        roomCode: room.roomCode });
      await players[index].wait("roomJoined");
    }
    const before = players[0].events.length;
    players[0].emit("hostStartGame", { forcedMiniGame: "penave_ou_nachave" });
    assert.equal(await players[0].wait("errorMessage", () => true, 2000, before), "Message invalide.");
    players[0].emit("requestRoomState", null);
    assert.equal((await players[0].wait("gameStateUpdate", (s) => s.phase === "idle", 2000,
      players[0].events.length - 1)).currentMiniGame, null);
    players[0].emit("hostStartGame", { forcedMiniGame: "qui_suis_je" });
    const draw = await players[0].wait("gameStateUpdate", (s) => s.phase === "drawingGame", 40000);
    assert.equal(draw.currentMiniGame, "qui_suis_je");
    players[0].emit("drawingFinished", null);
    const rules = await players[0].wait("gameStateUpdate", (s) => s.phase === "rules", 3000);
    assert.equal(rules.gameMode, "battle_royale");
    for (const player of players) player.emit("playerSetReady", { isReady: true });
    const playing = await players[0].wait("gameStateUpdate", (s) => s.phase === "playing", 5000);
    assert.equal(playing.currentMiniGame, "qui_suis_je");
    await players[0].wait("quiSuisJeQuestion", () => true, 3000);
    console.log("Battle Royale : Pénave forcé refusé, Qui suis-je lancé avec 3 joueurs OK");
  } finally { for (const player of players) player.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
