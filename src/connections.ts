import { CONFIG } from "./config.ts";

const ELECTRUM_WSS_PORT = 50004; // the secure WebSocket port the Electrum client uses for hostnames

// EVERYTHING the app is allowed to connect to lives here. The Content-Security-Policy is built from this list,
// so a connection that is not listed is blocked by the browser.
export const CONNECT_SOURCES: string[] = [
  "'self'", // this site, including the game file

  // Electrum servers (chain data and broadcasting)
  ...CONFIG.chipnetServers.map((host) => `wss://${host}:${ELECTRUM_WSS_PORT}`),
  `wss://bch.imaginary.cash:${ELECTRUM_WSS_PORT}`, // mainnet default
   "wss://relay.riften.net",
   "wss://relay.cauldron.quest",
];