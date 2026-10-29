export type Net = "chipnet" | "mainnet";

export const CONFIG = {
  network: "chipnet" as Net,
    // Chipnet Electrum WebSocket servers, tried in order. The library's own default (chipnet.bch.ninja) is flaky.
  chipnetServers: ["chipnet.imaginary.cash", "chipnet.bch.ninja", "chipnet.c3-soft.com", "cbch.loping.net"],

  // PUSD token category (standard 64-char hex, as shown by explorers/BCMR).
  // chipnet: our own test token (filled in after Step 3a). mainnet: from the official PUSD docs.
  pusdCategory: {
    chipnet: "8af14ba0e3e6db4d2e6f7290ec7421d3a76d387cf00ea35e9fec1218434549eb",
    mainnet: "REPLACE_FROM_PUSD_DOCS",
  } as Record<Net, string>,
  pusdDecimals: 2, // TODO: confirm from the token's BCMR metadata before mainnet

  // Amounts are integer base units of the token
  basePrice: 100n,
  priceStep: 10n,
  seedPot: 1_000n, // starting PUSD in the pot (base units), from the creator's own tokens

  // Blocks. Keep short for the live demo round.
  timeoutBlocks: 3,
  
  // Referee design (V2 contract). Deploy-time contract settings.
  fallbackBlocks: 12, // anyone can settle without the referee after this many blocks with no action
  waitingFallbackBlocks: 144, // the same, for a round nobody has stolen in yet (about a day)

  // Referee timer (V2). Off: the page runs the original block-based game. On: it uses the V2 game file
  // and the Funge referee server below.
  referee: { enabled: true, url: "http://127.0.0.1:8787" },

  // Minimum BCH (sats) on the state and pot outputs
  minSats: 1000n,
};

export const pusdCategory = () => CONFIG.pusdCategory[CONFIG.network];