export type Net = "chipnet" | "mainnet";


// The referee server's address. Set VITE_REFEREE_URL when building the page for a real host, e.g.
//   VITE_REFEREE_URL=https://referee.example.com npm run build
function refereeUrl(): string {
  let url: string | undefined;
  try {
    url = import.meta.env.VITE_REFEREE_URL; // the browser build
  } catch {
    // running in Node (server, scripts, vite config): there is no import.meta.env
  }
  if (!url && typeof process !== "undefined") url = process.env.VITE_REFEREE_URL;
  return (url ?? "http://127.0.0.1:8787").replace(/\/$/, "");
}


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

  // Kingdom (FungeKingdom contract). Deploy-time contract settings, in base units of PUSD (2 decimals).
  // The fallback block count below is used for Kingdom games too.
  kingdom: {
    openingPrice: 1_000n, // 10.00 PUSD: what the first player pays; it becomes the kingdom's value
    feePercent: 2n, // whole percent of the value, paid on top by the conqueror, goes to the dethroned king
    cutPercent: 10n, // whole percent of the value taken from the dethroned king's share into the pool
    cap: 5_000n, // 50.00 PUSD: the value can never be raised above this
    protectsPerReign: 2, // protects the king may use before the next conquest
    unit: 100n, // 1.00 PUSD: the smallest protect; the three amounts are 1x, 5x and 10x
  },
  
  // Referee design (V2 contract). Deploy-time contract settings.
  fallbackBlocks: 12, // anyone can settle without the referee after this many blocks with no action
  waitingFallbackBlocks: 144, // the same, for a round nobody has stolen in yet (about a day)

  // The Funge referee server (runs the game clock)
  referee: { url: refereeUrl() },
    
  // Minimum BCH (sats) on the state and pot outputs
  minSats: 1000n,
};

export const pusdCategory = () => CONFIG.pusdCategory[CONFIG.network];