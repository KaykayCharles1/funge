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
  $("faucetBtn").addEventListener("click", async () => {
    const key = wallet();
    if (!key || busy) return;
    busy = true;
    renderFaucet();
    say(T.sending, false);
    try {
      const res = await fetch(`${CONFIG.referee.url}/faucet/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pkh: key }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (body.ok) {
        say(T.paid(pusd, bch), false);
        onPaid();
      } else {
        const known = body.error !== undefined && body.error in T.errors;
        say(T.errors[known ? body.error! : res.status === 429 ? "busy" : "failed"]!, true);
      }
    } catch {
      say(T.errors.failed!, true);
    } finally {
      busy = false;
      renderFaucet();
    }
  });
  renderFaucet();
}
