"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const url = process.env.LQS_TEST_URL || "ws://127.0.0.1:3105/socket.io/?EIO=4&transport=websocket";

async function connect() {
  const ws = new WebSocket(url);
  const events = [];
  const listeners = new Set();
  let ready;
  const connected = new Promise((resolve) => { ready = resolve; });
  ws.onmessage = ({ data }) => {
    const packet = String(data);
    if (packet === "2") return ws.send("3");
    if (packet.startsWith("0")) return ws.send("40");
    if (packet.startsWith("40")) { ready(); return; }
    if (!packet.startsWith("42")) return;
    const [event, payload] = JSON.parse(packet.slice(2));
    events.push({ event, payload });
    for (const listener of listeners) listener();
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  await connected;
  return {
    events,
    emit(event, payload, context) {
      ws.send("42" + JSON.stringify(context === undefined ? [event, payload] : [event, payload, context]));
    },
    wait(event, predicate = () => true, timeoutMs = 45000, after = 0) {
      return new Promise((resolve, reject) => {
        const deadline = setTimeout(() => { listeners.delete(check); reject(new Error(`Timeout ${event}`)); }, timeoutMs);
        function check() {
          const found = events.slice(after).find((entry) => entry.event === event && predicate(entry.payload));
          if (!found) return;
          clearTimeout(deadline);
          listeners.delete(check);
          resolve(found.payload);
        }
        listeners.add(check);
        check();
      });
    },
    close() { ws.close(); }
  };
}

async function main() {
  const a = await connect();
  const b = await connect();
  try {
    a.emit("createRoom", { pseudo: "Alice", playerId: "alice" });
    const room = await a.wait("roomJoined");
    b.emit("joinRoom", { pseudo: "Bob", playerId: "bob", roomCode: room.roomCode });
    await b.wait("roomJoined");
    a.emit("hostSetGameMode", { gameMode: "liste" });
    const mode = await a.wait("roomUpdate", (r) => r.gameMode === "liste");
    assert(mode.listeOptions.miniGames.some((game) => game.id === "penave_ou_nachave"));
    assert.equal(mode.listeOptions.maxGames, mode.listeOptions.miniGames.length);
    a.emit("hostValidateListeConfig", { gameCount: 1, selectionMethod: "manual",
      selectedMiniGames: ["penave_ou_nachave"] });
    assert.equal((await a.wait("listeConfigResult")).ok, true);
    a.emit("hostStartGame", {});
    await a.wait("gameStateUpdate", (s) => s.phase === "rules", 40000);
    let state = a.events.filter((x) => x.event === "gameStateUpdate").at(-1).payload;
    a.emit("playerSetReady", { isReady: true }, state.listeContext);
    b.emit("playerSetReady", { isReady: true }, state.listeContext);
    const theme = await a.wait("gameStateUpdate", (s) => s.penaveState?.subPhase === "theme");
    assert.equal(theme.penaveState.turnNumber, 1);
    assert.equal(theme.penaveState.order.length, 2);
    const first = await a.wait("gameStateUpdate", (s) => s.penaveState?.subPhase === "answer");
    assert.equal(first.penaveState.remainingMs <= 20000, true);
    const active = first.penaveState.activePlayerId === "alice" ? a : b;
    const other = active === a ? b : a;
    const payload = (s, extra) => ({ ...extra, instanceId: s.penaveState.instanceId,
      turnNumber: s.penaveState.turnNumber, passageId: s.penaveState.passageId });
    const before = a.events.length;
    other.emit("penaveAnswer", payload(first, { answer: "hors tour", pass: false }), first.listeContext);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(a.events.slice(before).some((x) => x.payload?.penaveState?.subPhase === "correction"), false);
    active.emit("penaveAnswer", payload(first, { answer: "réponse à corriger", pass: false }), first.listeContext);
    const correction = await a.wait("gameStateUpdate", (s) => s.penaveState?.subPhase === "correction");
    assert.equal(correction.penaveState.entries.length, 1);
    const noHost = active === a ? b : a;
    if (noHost === b) {
      b.emit("penaveGrade", payload(correction, { accepted: false }), correction.listeContext);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(a.events.filter((x) => x.event === "gameStateUpdate").at(-1).payload.penaveState.subPhase, "correction");
    }
    a.emit("requestRoomState", null);
    const sync = await a.wait("gameStateUpdate", (s) => s.penaveState?.subPhase === "correction", 2000,
      a.events.length - 1);
    assert.equal(sync.penaveState.entries[0].status, "pending");
    // L'arrivée au tableau doit se terminer avant que l'hôte puisse corriger.
    await new Promise((resolve) => setTimeout(resolve, 900));
    a.emit("penaveGrade", payload(correction, { accepted: false }), correction.listeContext);
    a.emit("penaveGrade", payload(correction, { accepted: true }), correction.listeContext);
    const next = await a.wait("gameStateUpdate", (s) => s.penaveState?.subPhase === "answer" &&
      s.penaveState.passageId !== first.penaveState.passageId);
    const secondActive = next.penaveState.activePlayerId === "alice" ? a : b;
    secondActive.emit("penaveAnswer", payload(next, { answer: "", pass: true }), next.listeContext);
    const summary = await a.wait("gameStateUpdate", (s) => s.penaveState?.subPhase === "round_summary");
    assert.equal(summary.penaveState.entries.length, 2);
    assert.deepEqual(summary.penaveState.entries.map((x) => x.status), ["refused", "passed"]);
    const ranking = await a.wait("gameStateUpdate", (s) => s.penaveState?.subPhase === "final_ranking", 15000);
    assert.deepEqual(ranking.penaveState.ranking.map((x) => x.points), [2, 1]);
    assert.deepEqual(ranking.penaveState.ranking.map((x) => x.time), [20, 20]);
    const leaderboard = await a.wait("gameStateUpdate", (s) => s.phase === "listeLeaderboard", 15000);
    assert.deepEqual(leaderboard.listeLeaderboard.ranking.map((x) => x.tournamentPoints), [2, 1]);
    const historyFile = process.env.LQS_HISTORY_FILE;
    if (historyFile) {
      const ids = JSON.parse(fs.readFileSync(historyFile, "utf8")).penave_ou_nachave;
      assert.equal(ids.length, Number(process.env.LQS_EXPECT_HISTORY_COUNT || 1));
      assert.equal(new Set(ids).size, ids.length);
    }
    console.log("Pénave Liste : 2 clients, garde-fous, correction, classement, points, historique OK");
  } finally { a.close(); b.close(); }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { connect };
