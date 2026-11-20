import { CONFIG } from "./config.ts";
import { COPY } from "./copy.ts";
import { formatUnits } from "./lib/format.ts";
import { FAUCET } from "./refereeParams.ts";

// The "Get test coins" box (chipnet only): asks the referee's faucet to pay the wallet that would play
const T = COPY.faucet;
const $ = (id: string) => document.getElementById(id)!;
let wallet: () => string | null = () => null;
let busy = false;

export function renderFaucet() {
  const on = CONFIG.network === "chipnet" && wallet() !== null;
  $("faucet").classList.toggle("hidden", !on);
  ($("faucetBtn") as HTMLButtonElement).disabled = busy;
}

function say(text: string, isError: boolean) {
  const el = $("faucetMsg");
  el.textContent = text;
  el.className = `mt-2 text-sm ${isError ? "text-red-400" : "text-emerald-300"}`;
}

// pkh: the key hash of the wallet that would play; onPaid: refresh the balances
export function initFaucet(pkh: () => string | null, onPaid: () => void) {
  wallet = pkh;
  const pusd = formatUnits(FAUCET.pusdUnits, CONFIG.pusdDecimals);
  const bch = FAUCET.sats.toLocaleString("en-US"); // "20,000" (sats)
  $("faucetTitle").textContent = T.title;
  $("faucetText").textContent = T.text(pusd, bch);
  $("faucetBtn").textContent = T.button;
  paidHook = onPaid;
  $("faucetBtn").addEventListener("click", async () => {
    say(T.sending, false);
    const r = await claimFaucet();
    if (r.ok) say(T.paid(pusd, bch), false);
    else if (r.code !== "no_wallet") say(T.errors[r.code]!, true);
  });
  renderFaucet();
}

let paidHook: () => void = () => {};
export type FaucetResult = { ok: true } | { ok: false; code: string };

// Ask the faucet to pay the wallet that would play. code: a key of COPY.faucet.errors (or "no_wallet")
export async function claimFaucet(): Promise<FaucetResult> {
  const key = wallet();
  if (!key || busy) return { ok: false, code: "no_wallet" };
  busy = true;
  renderFaucet();
  try {
    const res = await fetch(`${CONFIG.referee.url}/faucet/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pkh: key }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (body.ok) {
      paidHook();
      return { ok: true };
    }
    const known = body.error !== undefined && body.error in T.errors;
    return { ok: false, code: known ? body.error! : res.status === 429 ? "busy" : "failed" };
  } catch {
    return { ok: false, code: "failed" };
  } finally {
    busy = false;
    renderFaucet();
  }
}
export const faucetBusy = () => busy;
