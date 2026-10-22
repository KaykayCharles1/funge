export type Net = "chipnet" | "mainnet";

export const CONFIG = {
  network: "chipnet" as Net,

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

  // Blocks. Keep short for the live demo round.
  timeoutBlocks: 3,

  // Minimum BCH (sats) on the state and pot outputs
  minSats: 1000n,
};

export const pusdCategory = () => CONFIG.pusdCategory[CONFIG.network];