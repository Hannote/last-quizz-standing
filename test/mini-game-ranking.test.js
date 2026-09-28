"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../public_2/client.js"), "utf8");
const serverSource = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const { rankMiniGameResults } = require("../liste-tournament");

function server() {
  const start = serverSource.indexOf("function isListeParticipant(");
  const end = serverSource.indexOf("function createListeTournamentState(", start);
  assert.ok(start >= 0 && end > start);
  const context = { rankMiniGameResults };
  vm.runInNewContext(serverSource.slice(start, end), context);
  return context;
}

function client(gameMode) {
  const elements = Object.fromEntries(["leaderboard-overlay", "leaderboard-content", "leaderboardTitle"].map((id) => {
    const classes = new Set();
    return [id, { innerHTML: "", textContent: "", classList: {
      add: (name) => classes.add(name), remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    } }];
  }));
  const timers = [];
  const scoreboard = { innerHTML: "", lines: [], appendChild(line) { this.lines.push(line.textContent); } };
  const context = {
    currentRoom: { roomCode: "TEST", gameMode, listeTournament: { tournamentId: "tour" } },
    currentGameState: { phase: "playing", roundNumber: 1, currentMiniGame: "le_faux_du_vrai" },
    listeActionContext: { tournamentId: "tour", phase: "playing", question: 0 },
    currentPlayersData: [], scoreboard,
    document: { getElementById: (id) => elements[id], createElement: () => ({ textContent: "" }) },
    setTimeout: (fn, delay) => timers.push({ fn, delay }),
    socket: { on: (_, handler) => { context.scoreUpdate = handler; } }
  };
  const start = source.indexOf("let miniGameLeaderboardVersion =");
  const end = source.indexOf("// Le mode Liste ne trie", start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(source.slice(start, end), context);
  const eventStart = source.indexOf('socket.on("scoreUpdate",');
  const eventEnd = source.indexOf('socket.on("leugtasReveal",', eventStart);
  assert.ok(eventStart >= 0 && eventEnd > eventStart);
  vm.runInNewContext(source.slice(eventStart, eventEnd), context);
  return {
    context, elements, timers, scoreboard,
    render(players, title = "CLASSEMENT FINAL") {
      context.handleInterimLeaderboard(players, () => {}, 5000, title);
      const html = elements["leaderboard-content"].innerHTML;
      return {
        html,
        places: [...html.matchAll(/class="rank-num"[^>]*>#(\d+)<\/div>/g)].map((match) => Number(match[1])),
        names: [...html.matchAll(/class="p-name">([^<]+)<\/div>/g)].map((match) => match[1])
      };
    }
  };
}

function player(nickname, score, time, place) {
  return Object.freeze({ id: nickname, nickname, score, time, place });
}

for (const [stats, expectedIds, expectedPlaces] of [
  [[[2, 5], [2, 5], [1, 2]], ["p0", "p1", "p2"], [1, 1, 3]],
  [[[2, 5], [1, 2], [1, 2], [0, 1]], ["p0", "p1", "p2", "p3"], [1, 2, 2, 4]],
  [[[2, 20], [2, 5], [2, 10]], ["p1", "p2", "p0"], [1, 2, 3]]
]) {
  test(`serveur Liste : ordre score/temps et places ${expectedPlaces.join(", ")} sans attribution de points`, () => {
    const c = server();
    const players = stats.map(([roundScore, roundTime], i) => ({
      playerId: `p${i}`, pseudo: `J${i}`, roundScore, roundTime,
      tournamentPoints: 12, tournamentTime: 30, tournamentPlacements: [{ place: 1 }]
    }));
    players.push({ playerId: "retire", roundScore: 99, roundTime: 0, withdrawn: true });
    players.push({ playerId: "spectateur", roundScore: 99, roundTime: 0, isSpectator: true });
    const room = {
      gameMode: "liste", players: [...players].reverse(),
      listeTournament: { started: true, initialParticipantCount: players.length - 1,
        initialParticipantIds: players.filter((p) => !p.isSpectator).map((p) => p.playerId), roundResults: [] }
    };
    const before = JSON.stringify(room);
    for (let i = 0; i < 3; i++) {
      const data = c.getMiniGameScoreUpdate(room);
      assert.equal(data.gameMode, "liste");
      assert.deepEqual(Array.from(data.players, (p) => p.id), expectedIds);
      assert.deepEqual(Array.from(data.players, (p) => p.place), expectedPlaces);
      assert.ok(data.players.every((p) => !Object.hasOwn(p, "points")));
    }
    assert.equal(JSON.stringify(room), before);
  });
}

test("serveur Battle Royale : scoreUpdate garde son format et l'ordre historique", () => {
  const c = server();
  const room = { gameMode: "battle_royale", players: [
    { playerId: "b", pseudo: "B", roundScore: 1, roundTime: 20 },
    { playerId: "a", pseudo: "A", roundScore: 3, roundTime: 5 },
    { playerId: "elim", eliminated: true }, { playerId: "spect", isSpectator: true }
  ] };
  assert.deepEqual(JSON.parse(JSON.stringify(c.getMiniGameScoreUpdate(room))), { players: [
    { id: "b", nickname: "B", score: 1, time: 20 },
    { id: "a", nickname: "A", score: 3, time: 5 }
  ] });
});

for (const places of [[1, 1, 3], [1, 2, 2, 4]]) {
  test(`Liste : le rendu conserve les places serveur ${places.join(", ")}`, () => {
    const c = client("liste");
    const players = Object.freeze(places.map((place, index) => player(`J${index}`, 10 - place, place, place)));
    assert.deepEqual(c.render(players).places, places);
    assert.equal(c.timers[0].delay, 5000);
  });
}

test("Liste : aucun tri local du snapshot, y compris dans scoreUpdate", () => {
  const c = client("liste");
  // Ordre et places volontairement distincts d'un recalcul : le serveur fait autorité.
  const players = Object.freeze([player("B", 1, 20, 2), player("A", 9, 1, 1)]);
  c.context.scoreUpdate({ gameMode: "liste", players });
  const rendered = c.render(c.context.currentPlayersData);
  assert.deepEqual(rendered.names, ["B", "A"]);
  assert.deepEqual(rendered.places, [2, 1]);
  assert.deepEqual(c.scoreboard.lines, ["B : 1 point(s)", "A : 9 point(s)"]);
  assert.ok(!rendered.html.includes("💀") && !rendered.html.includes("✅"));
});

test("Liste : un snapshot après abandon rafraîchit l'écran sans relancer son délai", () => {
  const c = client("liste");
  c.render([player("A", 2, 5, 1), player("B", 2, 5, 1), player("C", 1, 2, 3)]);
  c.context.scoreUpdate({ gameMode: "liste", refreshLeaderboard: true,
    players: Object.freeze([player("A", 2, 5, 1), player("C", 1, 2, 2)]) });
  assert.ok(!c.elements["leaderboard-content"].innerHTML.includes('class="p-name">B</div>'));
  assert.equal(c.timers.length, 1);
  assert.equal(c.timers[0].delay, 5000);
  c.timers[0].fn();
  assert.equal(c.elements["leaderboard-overlay"].classList.contains("active"), false);
});

test("Liste : un scoreUpdate ordinaire attend le reveal et conserve le délai de l'écran", () => {
  const c = client("liste");
  c.render([player("A", 2, 5, 1)]);
  const html = c.elements["leaderboard-content"].innerHTML;
  c.context.scoreUpdate({ gameMode: "liste", players: Object.freeze([player("B", 3, 5, 1)]) });
  assert.equal(c.elements["leaderboard-content"].innerHTML, html);
  assert.equal(c.context.currentPlayersData[0].nickname, "B");
  assert.equal(c.timers.length, 1);
});

test("Battle Royale : tri historique, places séquentielles, icônes et délai conservés", () => {
  const c = client("battle_royale");
  const rendered = c.render([player("C", 1, 2, 1), player("B", 2, 5, 1), player("A", 2, 5, 3)]);
  assert.deepEqual(rendered.names, ["B", "A", "C"]);
  assert.deepEqual(rendered.places, [1, 2, 3]);
  assert.equal((rendered.html.match(/✅/g) || []).length, 2);
  assert.equal((rendered.html.match(/💀/g) || []).length, 1);
  const players = [player("lent", 3, 20, 1), player("rapide", 3, 10, 2)];
  c.context.scoreUpdate({ players });
  assert.deepEqual(players.map((entry) => entry.nickname), ["rapide", "lent"]);
  assert.equal(c.timers[0].delay, 5000);
});
