export type Game = {
  network: string;
  gameCategory: string;
  pusdCategory: string;
  state: { address: string; tokenAddress: string; lockingBytecode: string };
  pot: { address: string; tokenAddress: string; lockingBytecode: string };
  params: { basePrice: string; priceStep: string; seedPot: string };
  creatorPkh: string;
};


// The V2 game file (referee mode): no block timeout, but a referee key and fallback settings
export type GameV2 = Omit<Game, "params"> & {
  contractVersion: 2;
  refereePubkey: string;
  params: { basePrice: string; priceStep: string; seedPot: string; fallbackBlocks: number; waitingFallbackBlocks: number };
};