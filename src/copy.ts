import type { ApiErrorCode } from "./referee/api.ts";

// The rule numbers the landing page shows, already formatted (for example "10", "2%")
export type HowtoNumbers = { open: string; fee: string; cut: string };
// The Fair Game Rules numbers, already formatted from the rule constants (src/config.ts, src/refereeParams.ts)
export type RulesNumbers = {
  clock: string; // "5" (minutes)
  add: string; // "30 seconds"
  endgame: string; // "a minute": below this much time left, a conquest adds less
  endgameTime: string; // "1:00": the most the clock shows after such a conquest
  endgameAdd: string; // "10 seconds"
  amounts: string; // "1, 2 or 5"
  perReign: string; // "two"
  lockout: string; // "30 seconds"
  cap: string; // "50"
  back: string; // "90%"
  fee: string; // "2%"
  claim: string; // "30 seconds"
  blocks: string; // "12"
};
// The FAQ numbers: the rules' numbers and a few more, already formatted from the rule constants
export type FaqNumbers = RulesNumbers & {
  clockTime: string; // "5:00"
  addPhrase: string; // "30 seconds" ("a minute" when it is exactly one)
  open: string; // "5"
  example: string; // "5.10" (conquering a kingdom worth the opening price)
  maxConquest: string; // "51" (conquering a kingdom at its highest value)
  lossShare: string; // "a tenth" (what a fallen king does not get back of the value)
};
// An FAQ answer is a list of blocks: a paragraph, or numbered steps
export type FaqBlock = string | { steps: string[] };

// Every sentence the player sees from the referee timer. Change the wording here only.
export const COPY = {
  clock: {
    paused: "Clock paused",
    pausedDetail: "The clock is stopped and will continue shortly.",
    confirming: "Confirming with the game server…",
    settled: "Round settled",
    settling: "Loading the result…",
  },
  notice:
    "The game clock is run by the Funge referee. The referee decides when time runs out, never who gets paid: the contract pays the last king.",
  network: {
    offline: "Reconnecting to the game server…",
    stale: "Waiting for the network…",
    unreachable: "The game server cannot be reached",
  },
  grab: {
    noWallet: "Create a game wallet to play.",
    locked: "Unlock your game wallet to play.",
    mismatch: "The contracts do not match the game file. Reload the page.",
    noRound: "No live round found. It may have just ended.",
    needsBch: "Your wallet needs a little BCH to pay the network fee.",
    buildFailed: "Could not prepare the transaction. Nothing was sent.",
    cooling: "Checking whether your last move went through…",
  },
  over: {
    title: "Round is over",
    auto: "The pool is paid out automatically within a minute or so.",
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
      `The game server cannot be reached. If it stays down, anyone can settle this round without it once ${need} blocks have passed with no activity (${have} so far). The pool always goes to the last king.`,
    ready:
      "The game server cannot be reached, and enough blocks have passed. Anyone can now settle this round without it. The pool goes to the last king.",
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
    ready: "Playing with your connected wallet. You approve each move in it.",
    preparing: "Preparing transaction…",
    approve: (price: string, fee: string) => `Approve in your wallet: pay ${price} PUSD (network fee about ${fee} sats).`,
    rejected: "The request was rejected in your wallet. Nothing was sent.",
    cancelled: "Cancelled. Nothing was sent.",
    timeout: "Timed out waiting for your wallet. Nothing was sent.",
    disconnected: "Your wallet disconnected. Nothing was sent.",
    failed: "Could not prepare the move. Nothing was sent. Please try again.",
    noKingCoin: "Your wallet has no coin at your king address. Send a small amount of BCH to it, then try again.",
    approveCancel: (pool: string, fee: string) => `Approve in your wallet: cancel the round and get ${pool} PUSD back (network fee about ${fee} sats).`,
    promptCancel: (pool: string) => `Cancel the Funge round and get ${pool} PUSD back`,
  },
  // Invite links: the "Invite friends" button on the battlefield, and the banner a friend sees when they open one
  invite: {
    button: "Invite friends",
    // who: "King Charles"; the same words go in the share message and the banner
    summons: (who: string) => `${who} summons you to battle for the throne.`,
    message: (who: string) => `${who} summons you to battle for the throne. Do you have what it takes to become the King of Funge?`,
    someone: "A challenger", // when the player has not chosen a name yet
    panelTitle: "Invite friends",
    panelText: "Send this to a friend or a group:",
    copy: "Copy invite",
    copied: "Copied. Paste it in any chat.",
    copyFailed: "Could not copy. Select the text above and copy it.",
    telegram: "Telegram",
    whatsapp: "WhatsApp",
    x: "X",
    discord: "Discord",
    close: "Close",
    bannerQuestion: "Do you have what it takes to become the King of Funge?",
    bannerCoins: "Get free test coins",
    bannerClose: "Dismiss",
  },
  // The card a chat app or X shows for a shared funge.cash link (built into both pages; an invite link's title
  // becomes "King Charles summons you to battle for the throne." in worker/index.ts)
  preview: {
    siteName: "Funge",
    title: "Funge: Battle for the throne",
    description: "Conquer the throne, protect it, and be the last King standing to win the Treasury. A game on Bitcoin Cash.",
    imageAlt: "The Funge crown and logo over the castle in its valley, with the words Battle for the throne.",
    // the words on the picture itself (public/assets/share/preview.jpg; its .json says how it was made)
    imageTitle: "Battle for the throne",
    imageLine: "Be the last King standing and win the Treasury",
  },
  // The chipnet test faucet, under the wallets on the game page (chipnet only)
  faucet: {
    title: "Free test coins",
    text: (pusd: string, sats: string) => `New here? Get ${pusd} test PUSD and ${sats} sats of test BCH to play. Once a day per wallet.`,
    button: "Get test coins",
    sending: "Sending your test coins…",
    paid: (pusd: string, sats: string) => `Sent ${pusd} PUSD and ${sats} sats. They show in your wallet in a few seconds.`,
    errors: {
      already_claimed: "This wallet already got test coins today. Come back tomorrow.",
      ip_limit: "You already claimed test coins several times today. Come back tomorrow.",
      daily_limit: "The faucet has given out all of today's test coins. Come back tomorrow.",
      empty: "The faucet is empty right now. Please try again later.",
      faucet_off: "The faucet is not available right now.",
      busy: "Too many tries. Wait a minute, then try again.",
      failed: "Could not send test coins. Please try again in a minute.",
    } as Record<string, string>,
  },
  
  // Withdraw: from the game wallet to the player's own wallet, under the game wallet's balances
  withdraw: {
    button: "Withdraw",
    title: "Withdraw",
    text: "Paste the address of a Bitcoin Cash wallet that holds tokens, such as Paytaca or Cashonize.",
    addressLabel: "BCH Address",
    addressPlaceholder: (network: string) => (network === "mainnet" ? "bitcoincash:z…" : "bchtest:z…"),
    pusdLabel: "PUSD",
    bchLabel: "BCH",
    have: (amount: string) => `You have ${amount}`,
    max: "Max",
    allBch: "Max",
    nfts: (n: number) => `Also send my trophies and other NFTs (${n})`,
    review: "Withdraw",
    cancel: "Cancel",
    checking: "Checking…",
    confirmTitle: "Confirm Transaction",
    confirmPusd: (amount: string) => `${amount} PUSD`,
    confirmBch: (amount: string) => `${amount} BCH`,
    confirmNfts: (n: number) => `${n} trophy or NFT${n === 1 ? "" : "s"}`,
    confirmTo: "To",
    confirmFee: (amount: string) => `${amount} BCH`,
    feeLabel: "Network fee",
    confirmWarn: "Check the address. A payment cannot be undone.",
    send: "Withdraw",
    back: "Back",
    sending: "Sending…",
    approve: "Approve in your wallet…", // an own wallet (WizardConnect) is asked to sign
    walletPrompt: (what: string) => `Withdraw ${what} from Funge`, // shown in the wallet app
    sent: "Transaction Successful",
    explorer: (network: string) => (network === "mainnet" ? "View on the explorer ↗" : "View on the testnet explorer ↗"),
    done: "Done",
    errors: {
      empty: "Paste your wallet's address first.",
      invalid: "That is not a valid Bitcoin Cash address. Check for a missing or extra character.",
      network: "That address is for another network.",
      script: "Send to a personal wallet address, not a contract.",
      self: "That is this wallet's own address. Paste the address of your other wallet.",
      amount: "Enter an amount, for example 12.50.",
      nothing: "Enter how much PUSD or BCH to send.",
      no_pusd: "That is more PUSD than this wallet holds.",
      no_bch: "Not enough BCH for this and the network fee. Send less, or choose Max for BCH.",
      too_small: "The smallest BCH payment is 0.00000546 BCH.",
      busy: "Wait until your move is confirmed, then try again.",
      failed: "Could not send. Wait a minute and check your balances before trying again.",
    } as Record<string, string>,
  },

  // Swap: the game wallet's BCH and PUSD, either way, through Cauldron's pools, laid out like any exchange (sell on top, buy below)
  swap: {
    button: "Swap",
    title: "Swap",
    practice: "Practice pool",
    sell: "Sell",
    buy: "Buy",
    percents: [25, 50, 75],
    max: "Max",
    settings: "Swap settings",
    flip: "Switch the two coins",
    slippage: "Max slippage",
    slippageAuto: "Auto",
    slippageHelp: "If someone trades just before you, your swap still goes through when the new price is within this much of the one you reviewed.",
    // the main button
    enter: "Enter an amount",
    loading: "Getting price…",
    review: "Review",
    notEnough: (coin: string) => `Not enough ${coin}`,
    tooBig: (coin: string) => `Not enough ${coin} on offer`,
    tooSmall: "Amount too small",
    tooMuchImpact: (percent: string) => `Price impact over ${percent}%`,
    unavailable: "Exchange unavailable",
    // under the panels
    rate: (bch: string, usd: string) => `1 PUSD = ${bch} BCH${usd ? ` (${usd})` : ""}`,
    networkCost: "Network cost",
    // the review window
    confirmTitle: "You're swapping",
    close: "Close",
    showMore: "Show more",
    showLess: "Show less",
    rowRate: "Rate",
    rowFee: "Pool fee",
    rowNetwork: "Network cost",
    rowImpact: "Price impact",
    rowSlippage: "Max slippage",
    rowRoute: "Route",
    route: "Cauldron",
    rateLine: (bch: string) => `1 BCH = ${bch} PUSD`,
    send: "Swap",
    sending: "Swapping…",
    approve: "Approve in your wallet…", // an own wallet (WizardConnect) is asked to sign
    walletPrompt: (sell: string, buy: string) => `Swap ${sell} for ${buy} on Funge`, // shown in the wallet app
    retrying: "Price moved a little. Trying again…",
    // the card at the top of the panel after a swap went through
    swapped: "Swapped",
    swappedLine: (sold: string, got: string) => `${sold} for ${got}`,
    errors: {
      pools_changed: "The price moved more than your slippage. Nothing was spent. Review again.",
      busy: "Wait until your move is confirmed, then try again.",
      failed: "Could not swap. Check your balances in a minute before trying again.",
    } as Record<string, string>,
  },

  // The Kingdom page. Change the wording here only.
  // The landing page (index.html, at /): the game presented as a board game, the valley as the box lid and the rules as the
  // rule sheet. Plain, short sentences; real numbers only.
  landing: {
    pageTitle: "Funge · Battle for the throne",
    description: "A battle for the throne game on Bitcoin Cash. One Kingdom, one King, one PUSD Treasury. The last king wins it all.",
    title: "Funge",
    tagline: "Conquer the throne. The last king wins the Treasury.",
    // The project strip at the very top, for the hackathon judges: the event, the address for votes, and the links.
    // On a phone it scrolls from right to left.
    strip: {
      label: "Project information",
      event: "BCH BLAZE 2026",
      votes: "Ember votes:",
      address: "bitcoincash:zrrefj3c74fffqatf7l2cftfmr2p0xd8k5ma09clk2",
      copy: "Copy",
      copied: "Copied",
      opensNew: "(opens in a new tab)",
      links: [
        { text: "Presentation", href: "https://docs.google.com/presentation/d/1Mp6ganeNi_efnJHrHYXZPEYHYWe_ctCsJlwc_65o-iM/present?slide=id.p", lead: true },
        { text: "Forked Repo", href: "https://github.com/KaykayCharles1/funge-pre-demo", lead: false },
        { text: "GitHub", href: "https://github.com/KaykayCharles1/funge", lead: false },
      ],
    },
    // The hero (built first, section by section)
    logoAlt: "Funge",
    navLabel: "Page sections",
    // the scroll button at the top right, next to the help button: its name, shown on hover
    rulesLink: "Rules",
    heroTitle: "The last king wins it all",
    // read as one line; the gold dots between the words are drawn by the page
    heroLine: ["Conquer", "Protect", "Reclaim the throne"],
    heroSecondary: "How it works",
    // the battle loop after How to Play (a silent video; this is its spoken description)
    shotAlt: "A round on the battlefield: King Satoshi's violet army holds the castle, King Blaze's crimson army takes it, and King Satoshi takes it back.",
    specs: [
      { icon: "shield", label: "Four houses" },
      { icon: "bell", label: "A 5:00 clock" },
      { icon: "coin", label: "One PUSD Treasury" },
    ],
    specsLabel: "What is in the box",
    join: "Play Now",
    joinNote: "Watch the round, then take the throne",
    // Fair Game Rules: the scroll after the battle loop. Only what How to Play does not already say.
    fairRules: {
      title: "Fair Game Rules",
      seal: "Sealed by the contract",
      // each title and text gets the numbers; a rule that shows none simply ignores them
      rules: [
        { title: (_r: RulesNumbers) => "The clock", text: (r: RulesNumbers) => `A round starts with ${r.clock} minutes on the clock. Every conquest adds ${r.add}, but never past ${r.clock} minutes. With under ${r.endgame} left, a conquest adds only ${r.endgameAdd}, and never past ${r.endgameTime}.` },
        { title: (_r: RulesNumbers) => "Protect amounts", text: (r: RulesNumbers) => `A king protects with ${r.amounts} PUSD, never any other amount.` },
        { title: (r: RulesNumbers) => `${r.perReign[0]!.toUpperCase()}${r.perReign.slice(1)} protects per reign`, text: (r: RulesNumbers) => `Every new reign starts with ${r.perReign} fresh protects, even for a king who reclaimed his throne.` },
        { title: (r: RulesNumbers) => `No protecting in the last ${r.lockout}`, text: (_r: RulesNumbers) => "The final moments belong to the challengers." },
        { title: (_r: RulesNumbers) => "The highest walls", text: (r: RulesNumbers) => `A kingdom is worth at most ${r.cap} PUSD. Once there, the walls can rise no higher.` },
        { title: (_r: RulesNumbers) => "Losing isn't losing everything", text: (r: RulesNumbers) => `A fallen king gets back ${r.back} of the kingdom's value, plus the ${r.fee} fee the conqueror paid.` },
        { title: (_r: RulesNumbers) => "No conquering yourself", text: (_r: RulesNumbers) => "You can't take a throne you already hold." },
        { title: (_r: RulesNumbers) => "A change of heart", text: (_r: RulesNumbers) => "The first king can cancel the round and take every coin back, but only before anyone conquers." },
        { title: (_r: RulesNumbers) => "The Referee keeps time, not money", text: (_r: RulesNumbers) => "Our game server, the Referee, runs the round's clock. It never holds or sends PUSD: the contract alone pays the winner." },
        { title: (_r: RulesNumbers) => "The winner is always paid", text: (r: RulesNumbers) => `If the winner doesn't claim within ${r.claim}, the prize is paid automatically. Even if the Referee goes down, anyone can settle the round after ${r.blocks} blocks, and the last king is still paid.` },
      ],
    },
    // The FAQ after the scroll: three groups of questions; one answer opens at a time
    faq: {
      title: "Frequently Asked Questions",
      groups: [
        {
          title: "The game",
          items: [
            {
              q: "What is Funge?",
              a: (_r: FaqNumbers): FaqBlock[] => ["Funge is a fast-paced fantasy game where Kings and Queens battle for the treasury of Funge Kingdom. The last king at the end of a round wins it all."],
            },
            {
              q: "How long does a round last?",
              a: (r: FaqNumbers): FaqBlock[] => [`At least ${r.clock} minutes. The clock starts at ${r.clockTime} when the first king opens the round, and every conquest adds ${r.addPhrase}, never past ${r.clockTime}. With under ${r.endgame} left, a conquest adds only ${r.endgameAdd}, never past ${r.endgameTime}. A round lasts as long as kings keep fighting. When the clock reaches zero, the last king wins.`],
            },
            {
              q: "What happens to my money if I lose the throne?",
              a: (r: FaqNumbers): FaqBlock[] => [`You get most of it back. A fallen king gets ${r.back} of the kingdom's value, plus the ${r.fee} fee the conqueror paid. Losing the throne costs you about ${r.lossShare} of what it was worth, and you can always take it back.`],
            },
            {
              q: "Can I play on my phone?",
              a: (_r: FaqNumbers): FaqBlock[] => ["Yes. Funge runs in your phone's browser, with nothing to install, and the game wallet works there too."],
            },
          ],
        },
        {
          title: "Money",
          items: [
            {
              q: "What is PUSD?",
              a: (_r: FaqNumbers): FaqBlock[] => ["PUSD (ParyonUSD) is a dollar stablecoin on Bitcoin Cash: one PUSD aims to be worth one US dollar. Every PUSD is backed by more than its worth in BCH, and anyone can trade PUSD for a dollar's worth of BCH, which keeps its price close to a dollar. Playing in PUSD means prices and prizes are in dollars, even when BCH's price moves."],
            },
            {
              q: "Where can I get PUSD?",
              a: (_r: FaqNumbers): FaqBlock[] => ["Swap from BCH to PUSD in the in-game dex."],
            },
            {
              q: "How much do I need to play?",
              a: (r: FaqNumbers): FaqBlock[] => [`Opening a round costs ${r.open} PUSD. Conquering costs the kingdom's value plus ${r.fee}, so ${r.example} PUSD for a ${r.open} PUSD kingdom and never more than ${r.maxConquest} PUSD. Protecting costs ${r.amounts} PUSD. You also need a little BCH for network fees; a few cents' worth covers many moves.`],
            },
            {
              q: "How do I get my winnings out?",
              a: (_r: FaqNumbers): FaqBlock[] => ["The prize is paid straight into the wallet you played with. In the game wallet, press Withdraw, paste the address of any Bitcoin Cash wallet that holds tokens, such as Cashonize or Paytaca, and send."],
            },
            {
              q: "Why Bitcoin Cash?",
              a: (_r: FaqNumbers): FaqBlock[] => ["Funge needs fast, cheap moves and a Treasury no one can run off with. On Bitcoin Cash a move costs a fraction of a cent, and the Treasury is held by a smart contract that can only pay the last king. PUSD and your trophy live on the same chain."],
            },
          ],
        },
        {
          title: "Wallet",
          items: [
            {
              q: "How do I get started?",
              a: (_r: FaqNumbers): FaqBlock[] => [{ steps: [
                "Press Play Now and create your Funge game wallet: one tap, nothing to install.",
                "Write down your 12-word recovery phrase and keep it safe.",
                "Add PUSD for your moves and a little BCH for network fees.",
                "Pick your king or queen and take the throne.",
              ] }],
            },
            {
              q: "What wallets can I use?",
              a: (_r: FaqNumbers): FaqBlock[] => ["Two kinds. The Funge game wallet lives in the page itself. You create it in one tap, and your moves go through instantly with no approval pop-up, which matters when the clock is close to zero. Or you can connect your own Bitcoin Cash wallet, such as Cashonize or Paytaca, through WizardConnect, and approve each move in it. Approving takes a moment, so a move in the last seconds can arrive too late."],
            },
            {
              q: "Is the in-game wallet safe?",
              a: (_r: FaqNumbers): FaqBlock[] => ["Your wallet is yours alone. It's created in your browser, and its recovery phrase stays on your device, stored encrypted. Funge's servers never see it and can never move your coins. Set a password and the wallet stays locked until you type it. Without a password it opens by itself on your device, which is easier but means anyone using your browser can play with it. Treat it like a pocket wallet: keep what you play with in it, not your savings."],
            },
            {
              q: "What if I lose my phone or clear my browser?",
              a: (_r: FaqNumbers): FaqBlock[] => ["The game wallet lives in your browser, so clearing site data or losing the device removes it. Your 12-word recovery phrase is the way back. You can see it any time in the wallet with Back up, then restore it in Funge on any device, or in Cashonize or Paytaca. Without the phrase, nobody can recover the wallet, not even us."],
            },
          ],
        },
      ],
    },
    startTitle: "Before you play",
    start: [
      { title: "Open a wallet", text: "Create the game wallet in your browser in one tap, or connect your own wallet through WizardConnect." },
      { title: "Bring PUSD", text: "Fund it with PUSD for your moves and a little BCH for network fees." },
      { title: "Join the battle", text: "Watch the live round, pick your king or queen, and take the throne." },
    ],
    closing: "Rise and claim dominion as the true King of Funge",
    // The footer: the king on his throne, the closing line, Play Now and the X link
    footer: {
      throneAlt: "King Satoshi sits on his golden throne in the torch-lit hall of his keep.",
      xLabel: "Follow Funge on X",
      xUrl: "https://x.com/playFunge",
    },
    // How to Play: the pinned section (its title is also the help button's label at the top of the page). The numbers come from the rule constants (src/config.ts).
    howto: {
      title: "How to Play",
      stepsLabel: "The five moves",
      // the label of a timeline node, for screen readers
      goTo: (n: number, title: string) => `Step ${n}: ${title}`,
      steps: [
        {
          title: "The First King",
          text: (r: HowtoNumbers) => `The first King begins the round and claims the throne with ${r.open} PUSD. His kingdom is worth ${r.open} PUSD, and his ${r.open} PUSD goes the Treasury.`,
          alt: "The first king stands before his keep at dusk as gold coins drop into an open treasure chest.",
        },
        {
          title: "Protect your kingdom",
          text: (_r: HowtoNumbers) => "A king can protect his kingdom by paying PUSD to raise his walls. Every protection raises the kingdom's value and is added to the Treasury.",
          alt: "The king stands with crossed arms as stone walls rise around the keep, soldiers line up and a golden shield glows above.",
        },
        {
          title: "The Conqueror",
          text: (r: HowtoNumbers) => `Anyone can send an army to take the throne. The Conqueror pays the kingdom's value plus a ${r.fee} fee and becomes the new king.`,
          alt: "A crimson conqueror points toward the keep as his army marches in and the violet king waits at the wall.",
        },
        {
          title: "Reclaim your throne",
          text: (r: HowtoNumbers) => `A fallen king gets most of his money back, and can take the throne again by paying the kingdom's value plus the ${r.fee} fee.`,
          alt: "The fallen king returns across the field with a torn cape and a bag of gold, ahead of his violet army, while a crimson banner flies over the keep.",
        },
        {
          title: "The Treasury",
          text: (r: HowtoNumbers) => `Each time a throne is taken, ${r.cut} of the kingdom's value goes into the Treasury, same with every protection. When the round ends, the last king wins it all.`,
          alt: "An overflowing treasure chest with a golden trophy and crown, between a violet banner and a crimson banner, with the keep in the distance.",
        },
      ],
      closing: "Ready to take the throne?",
    },
    valleyAlt: "Four armies in violet, crimson, black and blue march along roads toward a silver-roofed castle in a green valley.",
  },

  kingdom: {
    tagline: "Take the throne. The last king standing wins the pool.",
    waiting: "Waiting for the first king",
    waitingDetail: "The clock starts when someone opens the kingdom.",
    running: "Time left",
    runningDetail: (add: string, cap: string, endgameAdd: string, endgame: string) =>
      `Every conquest adds ${add} to the clock, up to ${cap}. Under ${endgame} left, it adds only ${endgameAdd}, up to ${endgame}. A protect does not change it.`,
    over: "Time is up",
    overDetail: "The last king wins the pool.",
    finished: "This round is finished.",
    nobody: "Nobody yet",
    lastKing: "the last king",
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
    feedTitle: "What is happening",
    feedEmpty: "Nothing has happened yet.",
    feedOpened: (who: string, clock: string) => `${who} opened the kingdom and became king. Clock ${clock}.`,
    feedConquered: (who: string, pass: number, clock: string, added: string) =>
      `${who} took the throne (king number ${pass}). Clock ${clock}${added ? ` (+${added})` : ""}.`,
    feedProtected: (who: string, amount: string, value: string) => `${who} protected the walls with ${amount} PUSD. Throne value ${value} PUSD.`,
    feedPaused: "The clock was paused for a moment.",
    feedResumed: "The clock continues.",
    feedOver: "Time is up.",
    feedSettled: "The round was settled and the pool paid out.",
    feedCancelled: (who: string) => `${who} cancelled the round before anyone challenged. The pool went back.`,
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
    doneCancel: "Round cancelled. Your pool is on its way back to you.",
    protectTitle: "Protect your throne",
    protectBtn: (amount: string) => `+${amount}`,
    protectHint: "A protect adds PUSD to the pool and raises the throne value. It does not change the clock.",
    overYouWin: (pool: string) => `Time ran out and you are the king. The pool of ${pool} PUSD is yours.`,
    overSomeone: (pool: string, who: string) => `Time ran out. The last king (${who}) wins the pool of ${pool} PUSD.`,
    wonTitle: "You won the pool!",
    otherWonTitle: "The kingdom has a winner",
    // A finished round with one king (cancelled, or nobody challenged): the trophy cannot tell which, so one wording
    aloneMine: "Round cancelled. Pool returned",
    aloneOther: "Round cancelled. Pool returned",
    endedKings: "Kings crowned",
    trophyGame: "An immutable trophy NFT is in your game wallet. To see it in another wallet, restore your seed phrase there.",
    trophyMine: "An immutable trophy NFT was sent to your wallet.",
    trophyOther: "An immutable trophy NFT was sent to the winner.",
  },

  // The battlefield's wallet panel (src/battlefield/walletPanel.ts): picking a wallet, creating, importing, unlocking
  walletPanel: {
    pickTitle: "Pick a Wallet",
    gameWallet: "Funge Game Wallet",
    wizardConnect: "WizardConnect",
    startText: "To get started, create a new wallet or import an existing one.",
    createNew: "Create a New Wallet",
    haveWallet: "I Already Have a Wallet",
    back: "Back",
    walletBack: "Wallet",
    pwTitle: "Create a password",
    pwText: "You will use this to unlock your wallet.",
    password: "Password",
    confirmPassword: "Confirm Password",
    showPassword: "Show password",
    pwShort: "At least 8 characters",
    pwMismatch: "The passwords don't match",
    pwMatch: "Passwords match",
    continue: "Continue",
    phraseTitle: "Recovery Phrase",
    phraseWarn: "This phrase is the ONLY way to recover your wallet. Do NOT share it with anyone!",
    phraseAria: "Your recovery phrase. Point at it, or press and hold, to see the words.",
    saved: "I saved my Recovery Phrase",
    importText: "Import an existing wallet with your 12 or 24-word recovery phrase.",
    importBtn: "Import Wallet",
    wordAria: (n: number) => `Word ${n}`,
    lockedTitle: "Your wallet is locked",
    lockedText: "Unlock your game wallet to play.",
    unlock: "Unlock",
    wrongPassword: "Wrong password.",
    forgot: "Forgot Password?",
    forgotTitle: "Forgot Password",
    forgotText: "Funge doesn't store your password and can't help you get it back. Reset your wallet to set up a new one.",
    reset: "Reset Wallet",
    resetTitle: "Reset Wallet?",
    resetText: "Resetting your wallet wipes your password from browser memory.",
    resetWarn: "Your wallet is removed from this browser. You can only get it back with your recovery phrase.",
    cancel: "Cancel",
    badPhrase: "That recovery phrase is not valid. Check the words and their order.",
    // The game wallet's home
    lockWallet: "Lock Wallet",
    disconnectWallet: "Disconnect Wallet",
    copyAddress: "Copy",
    copiedAddress: "Copied",
    addressAria: "Your game wallet address",
    faucetLine: (pusd: string, bch: string) => `Claim ${pusd} PUSD and ${bch} BCH`,
    claim: "Claim",
    nextClaim: (time: string) => `Next claim in ${time}`,
    backup: "Back up seed phrase",
    deleteWallet: "Delete wallet",
    // Back up: the password first, then the words under a cover
    backupTitle: "Backup Seed Phrase",
    confirmPassword2: "Enter the password to confirm",
    confirm: "Confirm",
    backupWarn: "This Seed Phrase is the credential to your assets. DO NOT lose it or reveal it to others, otherwise you might lose your assets forever. Please view it in a secure environment and keep it carefully.",
    showSeed: "Click to show Seed Phrase",
    seedSaved: "I've saved the Seed Phrase",
    seedAria: "Your seed phrase",
    // Delete
    deleteTitle: "Delete this wallet?",
    deleteText: "It is removed from this browser. Without your seed phrase backup, any funds in it are lost for good.",
    backupFirst: "Back up seed phrase first",
    // WizardConnect
    wcScan: "Scan wallet to connect",
    wcQrAlt: "WizardConnect QR code",
    wcCopyLink: "Copy link",
    wcReconnecting: "Reconnecting to your wallet…",
    wcConnected: "Connected",
    failed: "Could not save the wallet. Please try again.",
  },

  // The animated battlefield (?mode=battlefield)
  battlefield: {
    treasury: "Treasury",
    kingdomValue: "Kingdom value",
    nextConquest: "Next conquest costs",
    noKing: "No king yet",
    currency: "PUSD",
    // The top bar over the full-screen field (src/battlefield/topbar.ts)
    throneValue: (value: string) => `Throne value · ${value} PUSD`,
    lastKingSub: "Last king · wins the treasury",
    youName: (name: string) => `${name} (you)`,
    homeAria: "Funge home",
    menuAria: "Menu",
    protectsLeftAria: "Protects left this reign",
    conquests: (n: number) => (n === 1 ? "1 conquest" : `${n} conquests`),
    waitingTitle: "Waiting for the first king",
    // "Play a demo round" (src/demoRound.ts): a round on the page alone, with demo PUSD
    demoPlay: "Play a demo round",
    demoAgain: "Play again",
    demoBadge: "Demo round · demo PUSD",
    demoLeave: "Leave demo",
    waitingDetail: (price: string) => `The first king pays ${price} PUSD`,
    connecting: "Connecting to the referee…",
    vs: "VS",
    newRuler: (title: string) => (title === "Queen" ? "New queen" : "New king"),
    paid: (amount: string) => `Paid ${amount}`,
    refunded: (amount: string) => `Refunded ${amount}`,
    toTreasury: (amount: string) => `+${amount} to the Treasury`,
    firstRuler: (title: string) => (title === "Queen" ? "First queen" : "First king"),
    wins: (amount: string) => `Wins ${amount} PUSD`,
    winsNoAmount: "Wins the Treasury",
    noChallengers: "No challengers, pool returned",
    summary: (kings: number, conquests: number) =>
      `${kings} ${kings === 1 ? "king" : "kings"} · ${conquests} ${conquests === 1 ? "conquest" : "conquests"}`,
    claimReward: "Claim your reward",
    waitingClaim: "Waiting for the king to claim",
    // Short messages under the king plate. "YOUR" marks the player's own kingdom.
    popOpened: (who: string) => `${who} is the first to rule`,
    popOpenedYou: "You are the first to rule",
    popConquered: (who: string, old: string) => `${who} conquered ${old}'s kingdom`,
    popConqueredYours: (who: string) => `${who} conquered YOUR kingdom`,
    popYouConquered: (old: string) => `You conquered ${old}'s kingdom`,
    popProtected: (who: string, amount: string) => `${who} protected the kingdom with ${amount}`,
    popProtectedYou: (amount: string) => `You protected YOUR kingdom with ${amount}`,
    popObserved: (who: string) => `${who} took the throne on the chain`,
    popMinute: "One minute left",
    popProtectClosed: "Protect closed",
    popTenSeconds: "Ten seconds left",
    popResumed: "The clock runs again",
    popOver: "The round is over",
    popWins: (who: string, amount: string) => `${who} wins ${amount} PUSD`,
    // "Choose your king": the picker before a player's first open or conquest in a round
    pickTitle: "Choose your King or Queen",
    pickPortraits: "Portraits",
    pickPortraitAria: (title: string, house: string) => `${title}, ${house}`,
    pickTakenAria: (title: string) => `${title}, taken by another player`,
    pickTaken: "Taken",
    pickNameLabel: "Type your name",
    pickCancel: "Cancel",
    pickClosed: "Not possible right now",
    pickNeedName: "Type a name.",
    pickChoosePortrait: "Choose a portrait.",
    pickProblem: {
      length: "Use 2 to 16 characters.",
      characters: "Use letters, digits, spaces, apostrophes or hyphens, with at least one letter.",
      link: "Links, web addresses and wallet addresses cannot be names.",
      word: "That word cannot be used in a name.",
      taken: "Another player in this round already uses that name.",
    },
    pickConfirmOpen: (price: string) => `Be the first king · ${price} PUSD`,
    pickConfirmConquer: (price: string) => `Conquer · ${price} PUSD`,
    pickConfirmTakeBack: (price: string) => `Take back your throne · ${price} PUSD`,
    houseName: (id: string) => `House ${id.charAt(0).toUpperCase()}${id.slice(1)}`,
    // Cancel round: the king ends the round before anyone challenged and takes the whole pool back
    cancelRoundBtn: "Cancel round",
    cancelRoundLine: (amount: string) => `Get your ${amount} PUSD back`,
    cancelRoundAria: (amount: string) => `Cancel the round and get your ${amount} PUSD back`,
    roundCancelled: "Round cancelled. Pool returned",
    popCancelled: (who: string) => `${who} cancelled the round. Pool returned`,
    popCancelledYou: "You cancelled the round. Pool returned",
    // The time a conquest added to the clock: floats by the bell and follows the conquest popup
    clockAdded: (time: string) => `+${time}`,
    popWithAdded: (text: string, added: string) => `${text} · ${added}`,
    // The action bar under the field
    openBtn: (price: string) => `Be the first king · ${price} PUSD`,
    conquerBtn: (price: string) => `Conquer the throne · ${price} PUSD`,
    takeBackBtn: (price: string) => `Take back your throne · ${price} PUSD`,
    holdThrone: "You hold the throne",
    claimBtn: "Claim your reward",
    claiming: "Claiming…",
    sending: "Sending…",
    approve: (left: string) => `Approve in your wallet · ${left} left`,
    cancel: "Cancel",
    createWallet: "Create your game wallet",
    connectWallet: "Connect a wallet to play",
    // The box in the middle of the field when the round is over (src/battlefield/banners.ts)
    roundOverKick: "The round is over",
    // A conquest on a phone held upright (the fight needs the full width)
    landscapeHint: "Enable landscape to see the battle",
    insufficient: "Insufficient Amount",
    insufficientBch: "Insufficient BCH for the fee",
    reconnecting: "Reconnecting…",
    walletLocked: "Locked",
    unlockWallet: "Unlock your game wallet",
    needsFunds: (missing: string) => `You need ${missing} more PUSD`,
    protectTitle: (left: number, per: number, cap: string) => `Protect · ${left} of ${per} left · cap ${cap} PUSD`,
    protectBtn: (amount: string) => `+${amount}`,
    protectAria: (amount: string) => `Protect with ${amount} PUSD`,
    protectNotOpen: "Protect opens when the round is running",
    protectNotKing: "Only the king can protect",
    protectCap: (cap: string) => `That would pass the cap of ${cap} PUSD`,
    mockOff: "Moves are off during a mock round",
    gameWallet: "Game wallet",
    noWallet: "No wallet yet",
    openWallet: "Open the wallet panel",
    nextRound: "The next round starts soon",
    nextRoundIn: (time: string) => `Next round in ${time}`,
    nextRoundAlmost: "The next round is almost ready…",
    nextRoundAnyMoment: "The next round starts any moment now…",
    walletSection: "Wallet",
    // The side panel (src/battlefield/panel.ts): Wallet and Rules tabs
    rulesTab: "Rules",
    panelAria: "Wallet and rules",
    closeAria: "Close",
    // Rule 10 in the game's Rules tab: the landing page's version also explains the fallback after a few blocks
    ruleTenShort: (claim: string) => `If the winner doesn't claim within ${claim}, the prize is paid automatically.`,
    actionsLabel: "Your moves",
    loading: "Loading the battlefield…",
    soundOn: "Sound on",
    soundOff: "Sound off",
    soundAria: "Turn the sound on or off",
    // When it persists, the battlefield shows network.unreachable (the old page's wording)
  },

  errors: {
    invalid: "The network did not accept that move. Nothing was sent. Please try again.",
    state_changed: "Someone moved first. Check the new price and try again.",
    too_late: "Too late: the clock ran out before your move arrived.",
    round_over: "The round is over.",
    not_over: "The round is still running.",
    paused: "The clock is paused for a moment. Try again shortly.",
    network_busy: "The network is busy. The clock is paused until the next block.",
    chain_unavailable: "Could not reach the network. Nothing was sent. Please try again.",
    outcome_unknown:
      "We could not confirm that the network received your move. Wait a moment and check the page before trying again.",
    unknown_round: "This round does not exist on the game server.",
    internal: "Something went wrong on the game server. Please try again.",
    rate_limited: "Too many tries. Wait a minute and try again.",
    server_unreachable: "Could not reach the game server. Nothing was sent.",
    not_open: "Nobody has opened this round yet.",
    protect_locked: "Protect is closed for the last 30 seconds of the clock.",
    not_king: "Only the king can do that.",
    already_king: "You already hold this throne.",
    walls_at_maximum: "The walls are at their maximum.",
    no_protects_left: "No protects left in this reign.",
    not_cancellable: "Someone has already conquered the throne, so the round can no longer be cancelled.",
    bad_name: "That name cannot be used. Use 2 to 16 letters, digits, spaces, apostrophes or hyphens.",
    name_taken: "Another player in this round already uses that name. Choose another.",
    avatar_taken: "Another player in this round already uses that portrait. Choose another.",
    not_started: "This round starts when the current one ends.",
  } satisfies Record<ApiErrorCode, string>,
} as const;

export const errorText = (code: ApiErrorCode): string => COPY.errors[code];

export function pauseText(reason: string): string {
  if (reason === "network_busy") return "Clock paused: the network is busy";
  return COPY.clock.paused;
}

export const notEnoughText = (price: string, have: string) =>
  `Not enough PUSD. The next move costs ${price} PUSD and this wallet has ${have}.`;
export const splitCoinsText = (price: string) =>
  `Your PUSD is spread across too many small coins for one move. Combine some of them into one, then try again (next move: ${price} PUSD).`;