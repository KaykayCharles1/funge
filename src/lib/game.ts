export type Game = {
  network: string;
  gameCategory: string;
  pusdCategory: string;
  state: { address: string; tokenAddress: string; lockingBytecode: string };
  pot: { address: string; tokenAddress: string; lockingBytecode: string };
  params: { basePrice: string; priceStep: string; seedPot: string };
  creatorPkh: string;
};


// The Kingdom game file (contractVersion 3), written by scripts/deploy-kingdom.ts
export type GameKingdom = Omit<Game, "params"> & {
  contractVersion: 3;
  refereePubkey: string;
  params: {
    openingPrice: string; feePercent: string; cutPercent: string; cap: string;
    protectsPerReign: number; unit: string; fallbackBlocks: number;
  };
};