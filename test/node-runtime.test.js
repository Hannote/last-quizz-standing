"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exécuter le vrai préambule sans démarrer le jeu ni accéder aux historiques.
const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const preamble = source.slice(0, source.indexOf('const express = require("express");'));

function check(version) {
  const logs = [];
  vm.runInNewContext(preamble, {
    require(name) {
      assert.equal(name, "node:process", "aucune dépendance du jeu avant le contrôle");
      return { version };
    },
    console: { log: (message) => logs.push(message) }
  });
  return logs;
}

test("le contrôle accepte le correctif et les versions stables suivantes de Node 24", () => {
  for (const version of ["v24.22.1", "v24.22.2", "v24.23.0", process.version]) {
    assert.deepEqual(check(version), [`[RUNTIME] Node.js ${version}`]);
  }
});

test("le contrôle refuse les anciens moteurs, les autres branches et les préversions", () => {
  for (const version of ["v24.11.1", "v24.21.9", "v24.22.0", "v22.23.4", "v25.0.0", "v26.12.1", "v24.22.1-rc.1"]) {
    assert.throws(() => check(version), (error) =>
      error.message.includes(version) && error.message.includes(">=24.22.1 <25"));
  }
});

test("les métadonnées npm et le contrôle de démarrage annoncent la même contrainte", () => {
  const pkg = require("../package.json");
  const lock = require("../package-lock.json");
  assert.equal(pkg.engines.node, ">=24.22.1 <25");
  assert.equal(lock.packages[""].engines.node, pkg.engines.node);
  assert.ok(preamble.includes(pkg.engines.node));
});
