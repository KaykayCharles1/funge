import { CONFIG } from "../config.ts";

export type RoundStatus = "waiting" | "open" | "over" | "settled";
export type PauseInfo = { since: number; reason: string } | null;

export type RoundSnapshot = {
  gameId: string;
  network: string;
  status: RoundStatus;
  deadline: number | null; // epoch ms on the SERVER clock
  remainingMs: number | null; // frozen while paused
  paused: PauseInfo;
  serverNow: number;
  graceSeconds: number;
  lastSeq: number;
  passCount: number;
  king: string | null; // pkh hex, null until the first open
  price: string | null; // base units, as a string
  pot: string | null;
  stateCoin: { txid: string; vout: number | null } | null;
  refereePubkey: string;
  chainStale: boolean;
  kind?: "kingdom";
  kingdom?: KingdomSnapshot | null; // Kingdom rounds only
  players?: Record<string, PlayerProfile>; // chosen names, by the first 22 hex characters of the key (missing on older servers)
};

// A player's chosen name and portrait. The title ("King"/"Queen") and the house come from the portrait.
export type PlayerProfile = { name: string; avatarId: string; title: string | null; house: string | null };

export type KingdomSnapshot = {
  holder: string | null;
  previousKing: string | null; // the first 11 bytes of the dethroned king's key hash
  value: string;
  openingPrice: string;
  cap: string;
  wallsAtMaximum: boolean;
  protectsUsed: number;
  protectsLeft: number;
  protectsPerReign: number;
  protectAmounts: string[];
  conquest: { pay: string; fee: string; kingGets: string; poolGets: string } | null;
  clockSeconds: number | null; // seconds on the clock right after the current king's move
  nextClockSeconds: number | null; // deprecated: what a conquest right now would set the clock to
  floorSeconds: number | null; // deprecated: always null (the bell's floor is gone)
  clockCapSeconds: number | null; // the most time the clock can show; the open starts here
  conquestAddSeconds: number | null; // what a conquest adds to the time left
  conquestMinSeconds: number | null; // a conquest never leaves less (0 = off)
  protectLockoutSeconds: number;
  protectClosesInMs: number | null;
};

export type RefereeEvent = {
  seq: number;
  roundId: string; // the game's token category
  at: number; // server time, epoch ms
  type: string; // deadline_changed, protect_applied, clock_paused, clock_resumed, round_over, round_settled (and clock_warning, made by the page)
  reason: string;
  data?: Record<string, string | number | boolean | null>;
};

export type ApiErrorCode =
  | "invalid" | "state_changed" | "too_late" | "round_over" | "not_over" | "paused" | "network_busy"
  | "chain_unavailable" | "outcome_unknown" | "unknown_round" | "internal" | "rate_limited" | "server_unreachable"
  | "not_open" | "protect_locked" | "not_king" | "already_king" | "walls_at_maximum" | "no_protects_left" | "not_cancellable"
  | "bad_name" | "name_taken" | "avatar_taken" | "not_started";

export type ApiFailure = { ok: false; error: ApiErrorCode; message: string; serverNow: number | null };

export type WalletInputClaim = {
  txid: string;
  vout: number;
  satoshis: string;
  lockingBytecode: string;
  token?: { amount: string; category: string; nft?: { capability: "none" | "mutable" | "minting"; commitment: string } };
};
export type ActRequest = {
  action: "open" | "conquer" | "protect" | "cancel"; txHex: string; walletInputs: WalletInputClaim[];
  profile?: { name: string; avatarId: string }; // open and conquer only: the name and portrait the player chose
};
export type ActSuccess = {
  ok: true; txid: string; passCount: number; king: string; deadline: number | null; serverNow: number; lastSeq: number;
};
export type ClaimSuccess = {
  ok: true; txid: string; winner: string | null; passCount: number; pot: string | null; cancelled: boolean;
  serverNow: number; lastSeq: number;
};

const KNOWN: string[] = [
  "invalid", "state_changed", "too_late", "round_over", "not_over", "paused", "network_busy",
  "chain_unavailable", "outcome_unknown", "unknown_round", "internal",
  "not_open", "protect_locked", "not_king", "already_king", "walls_at_maximum", "no_protects_left", "not_cancellable",
  "bad_name", "name_taken", "avatar_taken", "not_started",
];
const base = () => CONFIG.referee.url.replace(/\/$/, "");

type Reply = { status: number; body: unknown };

// null means the request never got an answer (no connection, or it timed out)
async function call(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Reply | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(base() + path, { ...init, signal: controller.signal });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // not JSON
    }
    return { status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function failure(r: Reply): ApiFailure {
  const b = (r.body ?? {}) as { error?: unknown; message?: unknown; serverNow?: unknown };
  let error: ApiErrorCode = r.status === 429 ? "rate_limited" : "internal";
  if (typeof b.error === "string" && KNOWN.includes(b.error)) error = b.error as ApiErrorCode;
  return {
    ok: false,
    error,
    message: typeof b.message === "string" ? b.message : "",
    serverNow: typeof b.serverNow === "number" ? b.serverNow : null,
  };
}
const unreachable = (): ApiFailure => ({ ok: false, error: "server_unreachable", message: "", serverNow: null });
// After a send we cannot know whether the server got it, so a lost answer is "outcome unknown"
const unknownOutcome = (): ApiFailure => ({ ok: false, error: "outcome_unknown", message: "", serverNow: null });

export async function getHealth(): Promise<{ serverNow: number } | null> {
  const r = await call("/health", {}, 5_000);
  const body = r?.body as { serverNow?: unknown } | null | undefined;
  return r && r.status === 200 && typeof body?.serverNow === "number" ? { serverNow: body.serverNow } : null;
}

export async function getRound(id: string): Promise<{ ok: true; round: RoundSnapshot } | ApiFailure> {
  const r = await call(`/rounds/${id}`);
  if (!r) return unreachable();
  if (r.status === 200) return { ok: true, round: r.body as RoundSnapshot };
  return failure(r);
}

export async function getEvents(
  id: string,
  after: number,
): Promise<{ ok: true; resync: boolean; lastSeq: number; events: RefereeEvent[] } | ApiFailure> {
  const r = await call(`/rounds/${id}/events?after=${after}`);
  if (!r) return unreachable();
  if (r.status !== 200) return failure(r);
  const b = r.body as { resync: boolean; lastSeq: number; events: RefereeEvent[] };
  return { ok: true, resync: b.resync, lastSeq: b.lastSeq, events: b.events };
}

const post = (path: string, body: unknown) =>
  call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, 30_000);

export async function act(id: string, request: ActRequest | Record<string, unknown>): Promise<ActSuccess | ApiFailure> {
  const r = await post(`/rounds/${id}/act`, request);
  if (!r) return unknownOutcome();
  if (r.status === 200) return r.body as ActSuccess;
  return failure(r);
}

export async function claim(id: string): Promise<ClaimSuccess | ApiFailure> {
  const r = await post(`/rounds/${id}/claim`, {});
  if (!r) return unknownOutcome();
  if (r.status === 200) return r.body as ClaimSuccess;
  return failure(r);
}

export type WatchStatus = "connecting" | "live" | "offline";
export type WatchHandlers = {
  onEvent: (event: RefereeEvent) => void;
  onResync: () => void; // history has a gap: reload the round, then call setSeq with its lastSeq
  onStatus: (status: WatchStatus) => void;
};

// Live events with automatic reconnect. Events are numbered, so a reconnect asks only for what it missed.
export function watchRound(gameId: string, startSeq: number, h: WatchHandlers) {
  let lastSeq = startSeq;
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule() {
    if (closed) return;
    const delay = Math.min(1000 * 2 ** attempt, 15_000) + Math.random() * 500;
    attempt++;
    timer = setTimeout(connect, delay);
  }

  function onMessage(raw: unknown) {
    let msg: { kind?: string; event?: RefereeEvent; lastSeq?: number };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.kind === "hello") {
      attempt = 0;
      h.onStatus("live");
    } else if (msg.kind === "resync") {
      if (typeof msg.lastSeq === "number") lastSeq = msg.lastSeq;
      h.onResync();
    } else if (msg.kind === "event" && msg.event) {
      const seq = msg.event.seq;
      if (seq <= lastSeq) return; // already seen
      if (seq > lastSeq + 1) {
        lastSeq = seq;
        h.onResync(); // we missed some
        return;
      }
      lastSeq = seq;
      h.onEvent(msg.event);
    }
  }

  function connect() {
    if (closed) return;
    h.onStatus("connecting");
    let s: WebSocket;
    try {
      s = new WebSocket(`${base().replace(/^http/, "ws")}/rounds/${gameId}/ws?after=${lastSeq}`);
    } catch {
      h.onStatus("offline");
      schedule();
      return;
    }
    socket = s;
    s.onmessage = (m) => onMessage(m.data);
    s.onclose = () => {
      if (socket === s) socket = null;
      if (!closed) {
        h.onStatus("offline");
        schedule();
      }
    };
    s.onerror = () => undefined; // onclose follows
  }

  connect();
  return {
    setSeq: (n: number) => {
      if (n > lastSeq) lastSeq = n;
    },
    close: () => {
      closed = true;
      clearTimeout(timer);
      socket?.close();
    },
  };
}