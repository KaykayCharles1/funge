export type Net = "chipnet" | "mainnet";

export const CONFIG = {
  network: "chipnet" as Net,

  // PUSD token category (32-byte hex). Chipnet: replace with the test token
  // category we create in Step 3. Mainnet: fill from the official PUSD docs.
  pusdCategory: "REPLACE_WITH_CATEGORY_HEX",
  pusdDecimals: 2, // TODO: confirm from the token's BCMR metadata before mainnet

  // All amounts are integer base units of the token
  basePrice: 100n,
  priceStep: 10n,

  // Blocks. Keep short for the live demo round.
  timeoutBlocks: 3,

  // Minimum BCH (sats) on the state and pot outputs. Verify the dust rules in Step 2.
  minSats: 1000n,
};