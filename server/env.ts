const LOCAL_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173"];
const LOOPBACK = ["127.0.0.1", "localhost", "::1"];

export type ServerEnv = { host: string; port: number; allowedOrigins: string[]; trustProxy: boolean };

// FUNGE_HOST            where to listen. Default 127.0.0.1 (this computer only). On a cloud host use 0.0.0.0.
// PORT / FUNGE_PORT     the port (cloud hosts usually set PORT).
// FUNGE_ALLOWED_ORIGINS the exact address(es) of the page, comma separated, e.g. https://funge.example.com
// FUNGE_TRUST_PROXY=1   only when a host proxy sits in front: use the visitor address it forwards, for rate limits
export function readServerEnv(env: Record<string, string | undefined>): ServerEnv {
  const host = env.FUNGE_HOST?.trim() || "127.0.0.1";
  const rawPort = env.PORT ?? env.FUNGE_PORT ?? "8787";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${rawPort}`);

  const exposed = !LOOPBACK.includes(host);
  const raw = env.FUNGE_ALLOWED_ORIGINS?.trim();
  if (exposed && !raw) {
    throw new Error("Refusing to start: FUNGE_ALLOWED_ORIGINS must list the page's https address when the server listens on the network.");
  }
  const allowedOrigins = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : LOCAL_ORIGINS;
  if (allowedOrigins.length === 0) throw new Error("FUNGE_ALLOWED_ORIGINS is empty.");
  for (const o of allowedOrigins) {
    let url: URL;
    try {
      url = new URL(o);
    } catch {
      throw new Error(`Not a valid origin: "${o}" (wildcards are not allowed).`);
    }
    if (url.origin !== o) throw new Error(`An origin must look like https://host[:port] with no path or trailing slash: "${o}".`);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (exposed && !local && url.protocol !== "https:") throw new Error(`Refusing to start: the page address must be https: "${o}".`);
  }
  return { host, port, allowedOrigins, trustProxy: env.FUNGE_TRUST_PROXY === "1" };
}