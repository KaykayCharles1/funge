// Read-only check of a deployed Funge server and page. It sends no transactions and needs no keys.
//   node scripts/preflight.ts <server address> <page address>
//   node scripts/preflight.ts https://referee.example.com https://funge.example.com
// Locally: node scripts/preflight.ts http://127.0.0.1:8787 http://localhost:4173   (after npm run build && npm run preview)
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { CONFIG } from "../src/config.ts";

const [serverArg, pageArg] = process.argv.slice(2);
if (!serverArg || !pageArg) {
  console.error("Usage: node scripts/preflight.ts <server address> <page address>");
  process.exit(2);
}
const server = serverArg.replace(/\/$/, "");
const page = pageArg.replace(/\/$/, "");
const pageOrigin = new URL(page).origin;
const serverOrigin = new URL(server).origin;
const serverWs = serverOrigin.replace(/^http/, "ws");
const isLocal = (u: string) => ["localhost", "127.0.0.1"].includes(new URL(u).hostname);

type Level = "ok" | "warn" | "fail";
const results: Level[] = [];
function report(level: Level, name: string, detail = "") {
  results.push(level);
  const tag = level === "ok" ? "PASS" : level === "warn" ? "WARN" : "FAIL";
  console.log(`${tag}  ${name}${detail ? ` - ${detail}` : ""}`);
}

const timeout = () => AbortSignal.timeout(10_000);

function raw(url: string, method: string, headers: Record<string, string>) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(u, { method, headers, timeout: 10_000 }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}

function wsHello(url: string) {
  return new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("no hello within 8 s"));
    }, 8_000);
    ws.onmessage = (m) => {
      try {
        const j = JSON.parse(String(m.data));
        if (j.kind === "hello") {
          clearTimeout(timer);
          ws.close();
          resolve(`hello, last event #${j.lastSeq}`);
        }
      } catch {
        // ignore other messages
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("connection failed"));
    };
  });
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0];

async function main() {
  console.log(`Server ${server}\nPage   ${page}\nNetwork ${CONFIG.network}\n`);

  // 1. the game file in this checkout
  const gameFile = new URL(`../public/game.${CONFIG.network}.kingdom.json`, import.meta.url);
  let game: { contractVersion?: number; network?: string; gameCategory?: string; refereePubkey?: string; params?: Record<string, unknown> };
  try {
    game = JSON.parse(readFileSync(gameFile, "utf8"));
  } catch {
    report("fail", "game file", `public/game.${CONFIG.network}.kingdom.json is missing`);
    return;
  }
  const goodGame = game.contractVersion === 3 && game.network === CONFIG.network && /^[0-9a-f]{64}$/.test(game.gameCategory ?? "");
  report(goodGame ? "ok" : "fail", "game file", goodGame ? `round ${game.gameCategory!.slice(0, 8)}…` : "not a Kingdom game for this network");
  if (!goodGame) return;
  const fb = Number(game.params?.fallbackBlocks);
  if (fb === CONFIG.fallbackBlocks) {
    report("ok", "fallback blocks", `${fb}`);
  } else {
    report(CONFIG.network === "mainnet" ? "fail" : "warn", "fallback blocks", `${fb}, expected ${CONFIG.fallbackBlocks}: a throwaway test game?`);
  }

  // 2. addresses
  if (!isLocal(server) && new URL(server).protocol !== "https:") report("fail", "server address", "must be https://");
  else report("ok", "server address", isLocal(server) ? "local" : "https");

  // 3. the server answers, and its clock agrees with ours
  try {
    const t0 = Date.now();
    const res = await fetch(`${server}/health`, { signal: timeout() });
    const t1 = Date.now();
    const j = (await res.json()) as { ok?: boolean; serverNow?: number };
    if (!res.ok || j.ok !== true) throw new Error(`status ${res.status}`);
    report("ok", "server health", `${t1 - t0} ms`);
    const skew = Math.abs((j.serverNow ?? 0) - (t0 + t1) / 2);
    report(skew > 3_000 ? "fail" : skew > 1_000 ? "warn" : "ok", "server clock", `${Math.round(skew)} ms from this computer`);
  } catch (e) {
    report("fail", "server health", message(e));
    return; // nothing else can work
  }

  // 4. the round on the server is this game
  try {
    const res = await fetch(`${server}/rounds/${game.gameCategory}`, { signal: timeout() });
    if (res.status === 404) throw new Error("the server does not know this game: wrong game file, or the server was not restarted after deploying");
    const r = (await res.json()) as {
      network?: string; refereePubkey?: string; status?: string; passCount?: number; pot?: string | null; chainStale?: boolean; paused?: unknown;
    };
    if (!res.ok) throw new Error(`status ${res.status}`);
    if (r.network !== CONFIG.network) report("fail", "round network", `server says ${r.network}`);
    else report("ok", "round network", r.network);
    report(r.refereePubkey === game.refereePubkey ? "ok" : "fail", "referee key", r.refereePubkey === game.refereePubkey ? "matches the game file" : "differs from the game file");
    report("ok", "round state", `${r.status}, pass ${r.passCount}, pot ${r.pot ?? "?"}`);
    if (r.chainStale) report("warn", "chain view", "the server's view of the chain is stale");
    if (r.paused) report("warn", "round paused", JSON.stringify(r.paused));
  } catch (e) {
    report("fail", "round state", message(e));
  }

  // 5. CORS: the page's address is allowed, a stranger's is not
  try {
    const allowed = await raw(`${server}/health`, "GET", { Origin: pageOrigin });
    report(allowed.headers["access-control-allow-origin"] === pageOrigin ? "ok" : "fail", "CORS for the page", `allow-origin: ${allowed.headers["access-control-allow-origin"] ?? "none"}`);
    const stranger = await raw(`${server}/health`, "GET", { Origin: "https://evil.example" });
    report(stranger.headers["access-control-allow-origin"] ? "fail" : "ok", "CORS refuses strangers", `allow-origin: ${stranger.headers["access-control-allow-origin"] ?? "none"}`);
    const pre = await raw(`${server}/rounds/${game.gameCategory}/act`, "OPTIONS", {
      Origin: pageOrigin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type",
    });
    const methods = String(pre.headers["access-control-allow-methods"] ?? "");
    report(pre.status < 300 && methods.includes("POST") ? "ok" : "fail", "CORS preflight for grabs", `status ${pre.status}, methods ${methods || "none"}`);
  } catch (e) {
    report("fail", "CORS", message(e));
  }

  // 6. the live connection
  try {
    report("ok", "live connection", await wsHello(`${serverWs}/rounds/${game.gameCategory}/ws`));
  } catch (e) {
    report("fail", "live connection", `${message(e)} (check that the host allows WebSockets)`);
  }

  // 7. the page
  try {
    const res = await fetch(`${page}/`, { signal: timeout() });
    const html = await res.text();
    if (!res.ok) throw new Error(`status ${res.status}`);
    report("ok", "page loads", `status ${res.status}`);
    const csp = /Content-Security-Policy/i.test(html);
    report(csp ? "ok" : "warn", "page security policy", csp ? "present" : "missing (is this a production build?)");
    report(html.includes(serverWs) ? "ok" : "fail", "page may reach the server", html.includes(serverWs) ? serverWs : `the page's policy does not list ${serverWs}: rebuild with VITE_REFEREE_URL=${serverOrigin}`);
    if (!isLocal(server) && html.includes("127.0.0.1")) report("fail", "page points at this computer", "rebuild with VITE_REFEREE_URL");
    const src = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
    if (src) {
      const js = await (await fetch(new URL(src, `${page}/`), { signal: timeout() })).text();
      report(js.includes(serverOrigin) ? "ok" : "fail", "page code uses this server", js.includes(serverOrigin) ? "address is built in" : "the built code has another server address");
    }
    const pg = (await (await fetch(`${page}/game.${CONFIG.network}.kingdom.json`, { signal: timeout() })).json()) as { gameCategory?: string };
    report(pg.gameCategory === game.gameCategory ? "ok" : "fail", "page game file", pg.gameCategory === game.gameCategory ? "same game as this checkout" : "the page serves a different game: rebuild after deploying");
  } catch (e) {
    report("fail", "page", message(e));
  }
}

await main();
const fails = results.filter((r) => r === "fail").length;
const warns = results.filter((r) => r === "warn").length;
console.log(`\n${fails === 0 ? "READY" : "NOT READY"}: ${results.length - fails - warns} passed, ${warns} warning(s), ${fails} failure(s).`);
process.exit(fails === 0 ? 0 : 1);