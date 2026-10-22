// A settle is accepted once the state UTXO's transaction has at least timeoutBlocks confirmations
export const blocksToSettle = (timeoutBlocks: number, confirmations: number) =>
  Math.max(0, timeoutBlocks - confirmations);