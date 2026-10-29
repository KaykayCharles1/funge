import { hexToBin } from "@bitauth/libauth";
import { CONFIG } from "./config.ts";
import type { EndedRound } from "./ended.ts";
import { frameSvg, svgToDataUrl } from "./lib/art.ts";
import { lockToAddress, p2pkhLock } from "./lib/chain.ts";
import { formatUnits } from "./lib/format.ts";

const $ = (id: string) => document.getElementById(id)!;

// Shows the "round over" screen. myKeys are the keys that count as "you"; gameWalletPkh is the in-page wallet.
export function renderEndedRound(r: EndedRound, gameCategory: string, myKeys: string[], gameWalletPkh: string | null) {
  $("live").classList.add("hidden");
  $("ended").classList.remove("hidden");
  ($("endedArt") as HTMLImageElement).src = svgToDataUrl(
    frameSvg({ passCount: r.passes, holderPkh: r.winnerPkh, gameCategory }),
  );
  const mine = myKeys.includes(r.winnerPkh);
  const cancelled = r.passes === 0; // nobody grabbed: the seed went back to its creator
  const winner = lockToAddress(p2pkhLock(hexToBin(r.winnerPkh)), false);
  $("endedTitle").textContent = cancelled
    ? mine ? "Round cancelled: your seed came back" : "Round cancelled: the seed went back to its creator"
    : mine ? "You won the pot!" : "The potato has a winner";
  $("endedWinner").textContent = mine ? `${winner} (you)` : winner;
  $("endedPot").textContent = `${formatUnits(r.potPaid, CONFIG.pusdDecimals)} PUSD`;
  $("endedPasses").textContent = String(r.passes);
  $("endedTrophy").textContent = cancelled
    ? "Nobody grabbed, so the round was cancelled and the seed was returned."
    : gameWalletPkh === r.winnerPkh
      ? "An immutable trophy NFT is in your game wallet. To see it in another wallet, restore your seed phrase there."
      : mine
        ? "An immutable trophy NFT was sent to your wallet."
        : "An immutable trophy NFT was sent to the winner.";
  $("endedTx").textContent = `Settlement transaction: ${r.settleTxid}${r.confirmed ? "" : " (waiting for confirmation)"}`;
}