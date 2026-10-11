"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { timingSafeEqual } = require("node:crypto");

const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const historyCode = source.slice(source.indexOf("function getPlayedHistory()"), source.indexOf("const leBonOrdreData"));
const gamesCode = source.slice(source.indexOf("const POSSIBLE_MINI_GAMES ="), source.indexOf("const LEUGTAS_TIMER_DURATION_SECONDS"));
const routesCode = source.slice(source.indexOf("const ADMIN_MEMORY_SECRET ="), source.indexOf("const PORT = process.env.PORT"));

function harness(file, env) {
  const routes = { GET: new Map(), POST: new Map() };
  let middleware;
  const app = {
    use(route, fn) { assert.equal(route, "/admin/memory"); middleware = fn; },
    get(route, fn) { for (const item of [].concat(route)) routes.GET.set(item, fn); },
    post(route, fn) { routes.POST.set(route, fn); }
  };
  vm.runInNewContext(historyCode + gamesCode + routesCode, {
    fs, HISTORY_FILE: file, app, process: { env }, Buffer, timingSafeEqual,
    console: { log() {}, error: assert.fail }
  });
  assert.ok(middleware);
  return (method, route, secret) => {
    const response = { statusCode: 200, headers: {}, body: undefined, status(code) { this.statusCode = code; return this; },
      set(key, value) { this.headers[key] = value; return this; }, json(value) { this.body = value; return this; } };
    const req = { params: {}, get(key) { assert.equal(key, "X-Admin-Secret"); return secret; } };
    let handler = routes[method]?.get(route);
    if (!handler && route.startsWith("/admin/memory/reset/")) {
      handler = routes[method]?.get("/admin/memory/reset/:game");
      req.params.game = decodeURIComponent(route.slice("/admin/memory/reset/".length));
    }
    assert.ok(handler, `Route absente : ${method} ${route}`);
    middleware(req, response, () => handler(req, response));
    return response;
  };
}

test("routes mémoire : désactivation, secret, méthode et liste autorisée", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lqs-admin-"));
  const file = path.join(temp, "played_questions_history.json");
  const initial = JSON.stringify({ petit_bac: ["marqueur-temporaire"], blind_test: ["autre"] });
  const secret = "secret-local-de-test-unique";
  const unchanged = () => assert.equal(fs.readFileSync(file, "utf8"), initial);
  fs.writeFileSync(file, initial);
  try {
    for (const env of [{}, { LQS_ADMIN_MEMORY_ENABLED: "1" }, { LQS_ADMIN_MEMORY_ENABLED: "0", LQS_ADMIN_MEMORY_SECRET: secret }]) {
      const request = harness(file, env);
      for (const [method, route] of [["GET", "/admin/memory/view"], ["GET", "/admin/memory/reset-all"],
        ["POST", "/admin/memory/reset-all"], ["POST", "/admin/memory/reset/petit_bac"]]) {
        assert.equal(request(method, route, secret).statusCode, 404);
        unchanged();
      }
    }
    const request = harness(file, { LQS_ADMIN_MEMORY_ENABLED: "1", LQS_ADMIN_MEMORY_SECRET: secret });
    for (const [method, route] of [["GET", "/admin/memory/view"], ["POST", "/admin/memory/reset-all"],
      ["POST", "/admin/memory/reset/petit_bac"]]) {
      assert.equal(request(method, route).statusCode, 401);
      assert.equal(request(method, route, "incorrect").statusCode, 401);
      unchanged();
    }
    assert.equal(JSON.stringify(request("GET", "/admin/memory/view", secret).body), initial);
    for (const route of ["/admin/memory/reset-all", "/admin/memory/reset/", "/admin/memory/reset/petit_bac"]) {
      assert.equal(request("GET", route, secret).statusCode, 405);
      unchanged();
    }
    for (const game of ["%3Cimg%3E", "toString", "__proto__"]) {
      assert.equal(request("POST", `/admin/memory/reset/${game}`, secret).statusCode, 400);
      unchanged();
    }
    assert.equal(request("POST", "/admin/memory/reset/petit_bac", secret).statusCode, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { petit_bac: [], blind_test: ["autre"] });
    assert.equal(request("POST", "/admin/memory/reset-all", secret).statusCode, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {});
  } finally {
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
