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
  chipnetServers: ["chipnet.imaginary.cash", "chipnet.bch.ninja"],

  // PUSD token category (standard 64-char hex, as shown by explorers/BCMR).
  // chipnet: our own test token (filled in after Step 3a). mainnet: from the official PUSD docs.
  pusdCategory: {
    chipnet: "735d04cdead10c2eec0b608ab30b0e9c6edc1b07fa2f06c8ebe99b2e0d2a2163", // test PUSD v2 (100,000.00 and a minting NFT, Nov 2026)
    mainnet: "2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544", // ParyonUSD (PUSD), checked by Charles against paryonusd.com, Nov 2026
  } as Record<Net, string>,
  pusdDecimals: 2, // ParyonUSD's on-chain metadata (BCMR) says 2

  // "Get PUSD" swaps BCH for PUSD against Cauldron's pools (src/lib/swap.ts). Mainnet: Cauldron's own pool list.
  // Chipnet, where Cauldron does not run: our practice pools, owned by the dev wallet (scripts/create-chipnet-pool.ts).
  swap: {
    indexerUrl: "https://indexer.riften.net",
    chipnetPoolOwner: "53478d4c3763bfc04cf433a148c8ac14435233f7", // first pool: 7,500.00 test PUSD and 0.015 test BCH, Nov 2026
  },

  // Kingdom (FungeKingdom contract). Deploy-time contract settings, in base units of PUSD (2 decimals).
  kingdom: {
    openingPrice: 500n, // 5.00 PUSD: what the first player pays; it becomes the kingdom's value
    feePercent: 2n, // whole percent of the value, paid on top by the conqueror, goes to the dethroned king
    cutPercent: 10n, // whole percent of the value taken from the dethroned king's share into the pool
    cap: 5_000n, // 50.00 PUSD: the value can never be raised above this
    protectsPerReign: 2, // protects the king may use before the next conquest
    unit: 100n, // 1.00 PUSD: the smallest protect; the three amounts are 1x, 2x and 5x
  },
  
  // Deploy-time contract setting.
  fallbackBlocks: 12, // anyone can settle without the referee after this many blocks with no action

  // Where "View on the explorer" opens a transaction (the withdraw screen)
  explorerTx: {
    chipnet: "https://chipnet.imaginary.cash/tx/",
    mainnet: "https://blockchair.com/bitcoin-cash/transaction/",
  },

  // The Funge referee server (runs the game clock)
  referee: { url: refereeUrl() },
    
  // Minimum BCH (sats) on the state and pot outputs
  minSats: 1000n,

  // The animated battlefield. When true, ?mode=battlefield shows it above the play page.
  battlefield: true,
};

export const pusdCategory = () => CONFIG.pusdCategory[CONFIG.network];