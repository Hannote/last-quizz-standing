"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { start, last } = require("./helpers/socket-hardening-harness.cjs");
const games = [
  ["qui_veut_gagner_des_leugtas", "leugtasQuestion", ["question", "answers"]],
  ["le_faux_du_vrai", "fauxVraiQuestion", null],
  ["blind_test", "blindTestQuestion", ["text", "audio"]],
  ["le_tour_du_monde", "leTourDuMondeQuestion", ["text", "image"]],
  ["qui_suis_je", "quiSuisJeQuestion", ["question", "image_question"]]
];
function assertPublic(payload, fields) {
  const forbidden = new Set(["correct_answer_id", "correctAnswerId", "indexFausse", "answer", "reponse", "reponse_texte", "image_reponse", "expected", "private"]);
  function inspect(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert(!forbidden.has(key), `Champ privé : ${key}`);
      inspect(child);
    }
  }
  inspect(payload);
  assert(!JSON.stringify(payload).includes("PRIVATE_SENTINEL"));
  if (fields) assert.deepEqual(Object.keys(payload.question).sort(), [...fields].sort());
  if (payload.question?.answers) {
    assert.equal(payload.question.answers.length, 4);
    for (const choice of payload.question.answers) {
      assert.deepEqual(Object.keys(choice).sort(), ["id", "text"]);
      assert.equal(typeof choice.text, "string");
    }
  }
}
function sendAnswers(game, mini, clients) {
  for (const [index, client] of clients.entries()) {
    if (game === "le_faux_du_vrai") client.send("fauxVraiAnswer", index ? (mini.list[mini.index].indexFausse + 1) % 5 : mini.list[mini.index].indexFausse);
    else if (game === "qui_veut_gagner_des_leugtas") {
      const q = mini.questions[mini.questionIndex];
      client.send("leugtasAnswer", { answerId: index ? q.answers.find(choice => choice.id !== q.correct_answer_id).id : q.correct_answer_id });
    } else client.send({ blind_test: "blindTestAnswer", le_tour_du_monde: "leTourDuMondeAnswer", qui_suis_je: "quiSuisJeAnswer" }[game], { answer: "Proposition" });
  }
}

for (const mode of ["battle_royale", "liste"]) for (const [game, event, fields] of games) {
  test(`${mode} ${game} : messages initiaux, suivants et reconnectés publics ; correction et scores préservés`, async () => {
    const { h, room, clients, mini } = start(mode, game);
    assertPublic(last(h, event), fields);
    const questions = mini.questions || mini.list;
    const initial = questions[0];
    const sourceText = game === "blind_test" || game === "le_tour_du_monde" ? initial.text : initial.question;
    assert.equal(fields ? last(h, event).question[fields[0]] : last(h, event).question, sourceText);
    if (game === "blind_test") assert.equal(last(h, event).question.audio, initial.audio);
    if (game === "qui_suis_je") assert.equal(last(h, event).question.image_question, initial.image_question || initial.image);
    if (game === "le_tour_du_monde") assert.equal(last(h, event).question.image, initial.image || initial.image_question);
    for (const q of questions) {
      Object.assign(q, { answer: q.answer || "PRIVATE_SENTINEL", reponse_texte: q.reponse_texte || "PRIVATE_SENTINEL", private: { answer: "PRIVATE_SENTINEL" } });
      for (const choice of q.answers || []) choice.private = { answer: "PRIVATE_SENTINEL" };
    }
    const sourceBefore = JSON.stringify(questions);
    let returned = h.socket("p0");
    returned.send("joinRoom", { roomCode: room.roomCode, playerId: "p0", pseudo: "Retour" });
    clients[0] = returned;
    assertPublic(last(h, event, returned), fields);
    assert.equal(JSON.stringify(questions), sourceBefore, "La projection ne modifie pas les données de correction");
    h.advance(2500);
    sendAnswers(game, mini, clients);
    if (game === "le_faux_du_vrai" || game === "qui_veut_gagner_des_leugtas") {
      const revealName = game === "le_faux_du_vrai" ? "fauxVraiReveal" : "leugtasReveal";
      const reveal = last(h, revealName);
      assert(reveal);
      assert.equal(game === "le_faux_du_vrai" ? reveal.indexFausse : reveal.correctAnswerId,
        game === "le_faux_du_vrai" ? initial.indexFausse : initial.correct_answer_id);
      assert.equal(room.players[0].roundScore, 1);
      assert.equal(room.players[1].roundScore, 0);
      if (game === "qui_veut_gagner_des_leugtas") assert.equal(last(h, "leugtasFeedback", clients[0])?.status || last(h, "leugtasFeedback").status, "good");
      returned = h.socket("p0");
      returned.send("joinRoom", { roomCode: room.roomCode, playerId: "p0", pseudo: "Retour pendant révélation" });
      clients[0] = returned;
      assertPublic(last(h, event, returned), fields);
      assert(last(h, revealName, returned), "La reconnexion pendant la révélation retrouve la correction");
      h.advance(5500);
      await Promise.resolve();
    }
    assert.equal(last(h, event).index, 2);
    assertPublic(last(h, event), fields);
    returned = h.socket("p0");
    returned.send("joinRoom", { roomCode: room.roomCode, playerId: "p0", pseudo: "Retour question suivante" });
    clients[0] = returned;
    assertPublic(last(h, event, returned), fields);
    if (!["le_faux_du_vrai", "qui_veut_gagner_des_leugtas"].includes(game)) {
      while (!mini.finished) { h.advance(2500); sendAnswers(game, mini, clients); }
      h.advance(3000);
      const correction = last(h, "correctionUpdate");
      assert.equal(correction.answerText, initial.reponse || initial.answer || "");
      assert.equal(correction.answerImage, initial.image_reponse || null);
      assert.equal(correction.playerAnswer, "Proposition");
      clients[0].send("hostGradePlayer", { points: 1 });
      assert.equal(room.players[0].roundScore, 1);
    }
  });
}
