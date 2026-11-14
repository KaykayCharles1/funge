// The funge.cash Worker. It serves the built site (dist) and adds one route:
//   POST /next-round   a finished round's page asks for the next round. If the referee says the round in the
//                      game file is settled, this starts the GitHub "Next round" workflow, which deploys it.
// Secret GITHUB_TOKEN (Cloudflare): a fine-grained token with "Actions: read and write" on this repository only.
// Anyone may call the route: the workflow itself only deploys when the round is over, and runs one at a time.

interface Env {
  ASSETS: { fetch(request: Request | string): Promise<Response> };
  GITHUB_TOKEN?: string;
  REFEREE_URL: string;
  GITHUB_REPO: string;
}

const NETWORK = "chipnet";
const WORKFLOW = "next-round.yml";
const QUIET_SECONDS = 120; // after starting the workflow, later asks are answered without calling GitHub

const reply = (status: number, message: string) =>
  new Response(JSON.stringify({ message }), { status, headers: { "content-type": "application/json" } });

async function nextRound(request: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_TOKEN) return reply(500, "GITHUB_TOKEN is not set");

  // Many pages ask at once when a round ends: start the workflow once, then stay quiet for a while
  const cache = (caches as unknown as { default: Cache }).default;
  const quietKey = new Request(new URL("/next-round-asked", request.url));
  if (await cache.match(quietKey)) return reply(202, "already asked");

  const game = (await (await env.ASSETS.fetch(new URL(`/game.${NETWORK}.kingdom.json`, request.url).toString())).json()) as {
    gameCategory: string;
  };
  const round = await fetch(`${env.REFEREE_URL}/rounds/${game.gameCategory}`);
  const status = round.ok ? ((await round.json()) as { status?: string }).status : null;
  // settled: the robot deploys the next round. Unknown to the referee: the robot redeploys it.
  if (status !== "settled" && round.status !== 404) return reply(409, `the round is ${status ?? "unknown"}`);

  const gh = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "funge-worker",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  if (!gh.ok) return reply(502, `GitHub said ${gh.status}`);
  await cache.put(quietKey, new Response("asked", { headers: { "cache-control": `max-age=${QUIET_SECONDS}` } }));
  return reply(202, "next round started");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/next-round") {
      if (request.method !== "POST") return reply(405, "use POST");
      try {
        return await nextRound(request, env);
      } catch (e) {
        return reply(500, e instanceof Error ? e.message : String(e));
      }
    }
    return env.ASSETS.fetch(request);
  },
};
