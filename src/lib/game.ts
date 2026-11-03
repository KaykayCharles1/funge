// The Kingdom game file (contractVersion 3), written by scripts/deploy-kingdom.ts
export type GameKingdom = {
  contractVersion: 3;
  network: string;
  gameCategory: string;
  pusdCategory: string;
  state: { address: string; tokenAddress: string; lockingBytecode: string };
  pot: { address: string; tokenAddress: string; lockingBytecode: string };
  refereePubkey: string;
  params: {
    openingPrice: string; feePercent: string; cutPercent: string; cap: string;
    protectsPerReign: number; unit: string; fallbackBlocks: number;
  };
  creatorPkh: string;
};
