// Referee timer parameters. Change them here only.
export const RESET_SECONDS = { steal: 600 } as const; // deadline reset per action type
export const GRACE_SECONDS = 1; // lateness grace after the deadline
export const KEEPER_DELAY_SECONDS = 120; // the keeper settles by itself after this
export const HEARTBEAT_SECONDS = 5; // how often the server saves a heartbeat
export const EVENT_HISTORY = 200; // events kept per round for client resync
export const UNCONFIRMED_CAP = 40; // pause near the node's unconfirmed chain limit (Step 4)

export type ActionType = keyof typeof RESET_SECONDS;