import type { ApiErrorCode } from "./referee/api.ts";

// Every sentence the player sees from the referee timer. Change the wording here only.
export const COPY = {
  clock: {
    waiting: "Waiting for the first grab",
    waitingDetail: "The clock starts when someone grabs the potato.",
    running: "Time left",
    runningDetail: "Every grab restarts the clock.",
    paused: "Clock paused",
    pausedDetail: "The clock is stopped and will continue shortly.",
    over: "Time is up",
    overDetail: "The last holder wins the pot.",
    confirming: "Confirming with the game server…",
    settled: "Round settled",
    settling: "Loading the result…",
  },
  notice:
    "The game clock is run by the Funge referee. The referee decides when time runs out, never who gets paid: the contract pays the last holder.",
  network: {
    offline: "Reconnecting to the game server…",
    stale: "Waiting for the network…",
  },
    grab: {
    sending: "Sending your grab…",
    done: "Done! You hold the potato.",
    noWallet: "Create a game wallet to play.",
    locked: "Unlock your game wallet to play.",
    mismatch: "The contracts do not match the game file. Reload the page.",
    noRound: "No live round found. It may have just ended.",
    needsBch: "Your wallet needs a little BCH to pay the network fee.",
    buildFailed: "Could not prepare the transaction. Nothing was sent.",
    behind: "The network is still catching up. Try again in a moment.",
    roundOver: "Round over",
    cooling: "Checking whether your last grab went through…",
  },
  errors: {
    invalid: "The network did not accept that grab. Nothing was sent. Please try again.",
    state_changed: "Someone grabbed first. Check the new price and try again.",
    too_late: "Too late: the clock ran out before your grab arrived.",
    round_over: "The round is over.",
    not_over: "The round is still running.",
    paused: "The clock is paused for a moment. Try again shortly.",
    network_busy: "The network is busy. The clock is paused until the next block.",
    chain_unavailable: "Could not reach the network. Nothing was sent. Please try again.",
    outcome_unknown:
      "We could not confirm that the network received your grab. Wait a moment and check the pass number before trying again.",
    unknown_round: "This round does not exist on the game server.",
    internal: "Something went wrong on the game server. Please try again.",
    rate_limited: "Too many tries. Wait a minute and try again.",
    server_unreachable: "Could not reach the game server. Nothing was sent.",
  } satisfies Record<ApiErrorCode, string>,
} as const;

export const errorText = (code: ApiErrorCode): string => COPY.errors[code];

export function pauseText(reason: string): string {
  if (reason === "network_busy") return "Clock paused: the network is busy";
  return COPY.clock.paused;
}

export const priceChangedText = (price: string) =>
  `The price changed to ${price} PUSD. Press the button again to grab at the new price.`;
export const notEnoughText = (price: string, have: string) =>
  `Not enough PUSD. The next grab costs ${price} PUSD and this wallet has ${have}.`;
export const splitCoinsText = (price: string) =>
  `Your PUSD is split across several small coins. Combine them into one, then try again (next grab: ${price} PUSD).`;