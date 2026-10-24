import { TransactionBuilder } from "cashscript";
import type { ElectrumNetworkProvider } from "cashscript";
import { hexToBin } from "@bitauth/libauth";
import { p2pkhLock } from "./lib/chain.ts";
import { decodeCommitment } from "./lib/commitment.ts";
import { makeContracts } from "./lib/contracts.ts";
import type { Game } from "./lib/game.ts";
import { retry } from "./lib/retry.ts";

const FEE_RATE = 1.5; // sats per byte; the contracts' own BCH covers it

export async function settleRound(game: Game, provider: ElectrumNetworkProvider): Promise<string> {
  const { state, pot } = makeContracts(game, provider);

  // Always re-read the live state right before building
  const [[stateUtxo], [potUtxo]] = await Promise.all([
    retry(() => provider.getUtxos(game.state.address)),
    retry(() => provider.getUtxos(game.pot.address)),
  ]);
  if (!stateUtxo?.token?.nft || !potUtxo?.token) throw new Error("No live round found. It may already be settled.");

  const commitment = stateUtxo.token.nft.commitment;
  const holderLock = p2pkhLock(hexToBin(decodeCommitment(commitment).holderPkh));

  const sent = await new TransactionBuilder({ provider })
    .addInput(stateUtxo, state.unlock.settle(), { sequence: game.params.timeoutBlocks })
    .addInput(potUtxo, pot.unlock.release())
    .addOutput({
      to: holderLock,
      amount: 1_000n,
      token: { amount: potUtxo.token.amount, category: game.pusdCategory },
    })
    .addOutput({
      to: holderLock,
      amount: 1_000n,
      token: { amount: 0n, category: game.gameCategory, nft: { capability: "none", commitment } },
    })
    .addBchChangeOutputIfNeeded({ to: holderLock, feeRate: FEE_RATE })
    .send();
  return sent.txid;
}

export function friendlySettleError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/BIP68/i.test(msg)) {
    return "Not ready yet: the network says the timeout has not passed. Wait for the next block and try again.";
  }
  if (/conflict|missing|spent|No live round/i.test(msg)) {
    return "The round just changed (someone grabbed, or it was already settled). The page is refreshing.";
  }
  if (/websocket|establish connection|timed? ?out|closed/i.test(msg)) {
    return "Network hiccup. Wait a moment and check the page before trying again.";
  }
  return `Something went wrong: ${msg.split("\n")[0]}`;
}