import { CONFIG } from "./config.ts";

const ELECTRUM_WSS_PORT = 50004; // the secure WebSocket port the Electrum client uses for hostnames

// EVERYTHING the app is allowed to connect to lives here. The Content-Security-Policy is built from this list,
// so a connection that is not listed is blocked by the browser.

// A page served over https cannot talk to a plain http server, and a real server must be encrypted anyway
const referee = new URL(CONFIG.referee.url);
if (!["localhost", "127.0.0.1"].includes(referee.hostname) && referee.protocol !== "https:") {
  throw new Error(`The referee server address must start with https:// (got ${CONFIG.referee.url}).`);
}

export const CONNECT_SOURCES: string[] = [
  "'self'", // this site, including the game file

  // Electrum servers (chain data and broadcasting)
  ...CONFIG.chipnetServers.map((host) => `wss://${host}:${ELECTRUM_WSS_PORT}`),
  `wss://bch.imaginary.cash:${ELECTRUM_WSS_PORT}`, // mainnet default
   "wss://relay.riften.net",
   "wss://relay.cauldron.quest",
   "https://indexer.riften.net", // Cauldron's pool list (mainnet swap: BCH to PUSD)
    new URL(CONFIG.referee.url).origin, // the referee server (http/https)
    new URL(CONFIG.referee.url).origin.replace(/^http/, "ws"), // and its WebSocket
];