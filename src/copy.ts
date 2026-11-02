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
    unreachable: "The game server cannot be reached",
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
  over: {
    title: "Round is over",
    youWin: (pot: string) => `Time ran out and you hold the potato. The pot of ${pot} PUSD is yours.`,
    someoneWins: (pot: string, who: string) => `Time ran out. The last holder (${who}) wins the pot of ${pot} PUSD.`,
    auto: "The pot is paid out automatically in a few minutes at the latest.",
    unlockHint: "If you are the winner, unlock your game wallet to claim right away.",
  },
  claim: {
    button: "Claim your reward",
    working: "Settling…",
    done: "Claimed! Loading the result…",
    already: "The round has already been settled. Loading the result…",
    unknown: "We could not confirm that the network received the claim. Wait a moment: the game also pays out automatically.",
  },
  outage: {
    waiting: (have: number, need: number) =>
      `The game server cannot be reached. If it stays down, anyone can settle this round without it once ${need} blocks have passed with no activity (${have} so far). The pot always goes to the last holder.`,
    ready:
      "The game server cannot be reached, and enough blocks have passed. Anyone can now settle this round without it. The pot goes to the last holder.",
  },
  fallback: {
    button: "Settle without the game server",
    working: "Settling…",
    done: "Settled! Loading the result…",
    tooEarly: "Not allowed yet: the network needs one more block. Try again after the next block.",
    gone: "The round has already been settled. Loading the result…",
    needsBch: "Your wallet needs a little BCH to pay the network fee.",
    unknown: "We could not confirm that the network received the settlement. Wait a moment and check the page before trying again.",
    failed: "The network did not accept the settlement. Nothing was sent. Try again in a moment.",
    locked: "Unlock your game wallet to settle. It only pays the small network fee.",
    noWallet: "Create a game wallet to settle. It only pays the small network fee.",
  },
  external: {
    ready: "Playing with your connected wallet. You approve each grab in it.",
    preparing: "Preparing transaction…",
    approve: (price: string, fee: string) => `Approve in your wallet: pay ${price} PUSD (network fee about ${fee} sats).`,
    rejected: "The request was rejected in your wallet. Nothing was sent.",
    cancelled: "Cancelled. Nothing was sent.",
    timeout: "Timed out waiting for your wallet. Nothing was sent.",
    disconnected: "Your wallet disconnected. Nothing was sent.",
    failed: "Could not prepare the grab. Nothing was sent. Please try again.",
    noKingCoin: "Your wallet has no coin at your king address. Send a small amount of BCH to it, then try again.",  
  },
  
  // The Kingdom page. Change the wording here only.
  kingdom: {
    tagline: "Take the throne. The last king standing wins the pool.",
    waiting: "Waiting for the first king",
    waitingDetail: "The clock starts when someone opens the kingdom.",
    running: "Time left",
    runningDetail: "Every conquest restarts the clock. A protect does not.",
    over: "Time is up",
    overDetail: "The last king wins the pool.",
    finished: "This round is finished.",
    nobody: "Nobody yet",
    you: "you",
    openPreview: (price: string) => `Open the kingdom for ${price} PUSD. All of it goes into the pool and you become the first king.`,
    conquestPreview: (pay: string, kingGets: string, poolGets: string) =>
      `Take the throne for ${pay} PUSD. The king you dethrone gets ${kingGets} PUSD and ${poolGets} PUSD goes into the pool.`,
    takeBack: (pay: string) => `You were dethroned. Take back your throne for ${pay} PUSD.`,
    youAreKing: "You are the king. Protect your throne, or wait for the clock to run out.",
    protectsLeft: (left: number, per: number) => `Protects left this reign: ${left} of ${per}`,
    wallsMax: "Walls at maximum",
    protectCloses: (time: string) => `Protect closes in ${time}`,
    protectClosed: "Protect is closed for the last seconds of the clock",
    nextClock: (time: string) => `Next conquest clock: ${time}`,
    feedTitle: "What is happening",
    feedEmpty: "Nothing has happened yet.",
    feedOpened: (who: string, clock: string) => `${who} opened the kingdom and became king. Clock ${clock}.`,
    feedConquered: (who: string, pass: number, clock: string) => `${who} took the throne (king number ${pass}). Clock ${clock}.`,
    feedProtected: (who: string, amount: string, value: string) => `${who} protected the walls with ${amount} PUSD. Throne value ${value} PUSD.`,
    feedPaused: "The clock was paused for a moment.",
    feedResumed: "The clock continues.",
    feedOver: "Time is up.",
    feedSettled: "The round was settled and the pool paid out.",
    someone: "Someone",
    youCap: "You",
    openBtn: (price: string) => `Open the kingdom · ${price} PUSD`,
    conquerBtn: (pay: string) => `Take the throne · ${pay} PUSD`,
    takeBackBtn: (pay: string) => `Take back your throne · ${pay} PUSD`,
    youKingBtn: "You are the king",
    roundOver: "Round over",
    sending: "Sending…",
    doneOpen: "Done! You opened the kingdom and you are the king.",
    doneConquer: "Done! You hold the throne.",
    doneProtect: "Done! Your walls are stronger.",
    protectTitle: "Protect your throne",
    protectBtn: (amount: string) => `+${amount}`,
    protectHint: "A protect adds PUSD to the pool and raises the throne value. It does not restart the clock.",
    overYouWin: (pool: string) => `Time ran out and you are the king. The pool of ${pool} PUSD is yours.`,
    overSomeone: (pool: string, who: string) => `Time ran out. The last king (${who}) wins the pool of ${pool} PUSD.`,
    wonTitle: "You won the pool!",
    otherWonTitle: "The kingdom has a winner",
    aloneMine: "No challengers: your pool came back",
    aloneOther: "No challengers: the pool went back to the only king",
    endedKings: "Kings crowned",
    trophyGame: "An immutable trophy NFT is in your game wallet. To see it in another wallet, restore your seed phrase there.",
    trophyMine: "An immutable trophy NFT was sent to your wallet.",
    trophyOther: "An immutable trophy NFT was sent to the winner.",
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
    not_open: "Nobody has opened this round yet.",
    protect_locked: "Protect is closed for the last 30 seconds of the clock.",
    not_king: "Only the king can protect the kingdom.",
    already_king: "You already hold this throne.",
    walls_at_maximum: "The walls are at their maximum.",
    no_protects_left: "No protects left in this reign.",
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