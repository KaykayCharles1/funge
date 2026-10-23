export type Game = {
  network: string;
  gameCategory: string;
  pusdCategory: string;
  state: { address: string; tokenAddress: string; lockingBytecode: string };
  pot: { address: string; tokenAddress: string; lockingBytecode: string };
  params: { basePrice: string; priceStep: string; timeoutBlocks: number; seedPot: string };
  creatorPkh: string;
};