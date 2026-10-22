import "./style.css";
import { ElectrumNetworkProvider } from "cashscript";
import { CONFIG } from "./config.ts";
import { decodeCommitment } from "./lib/commitment.ts";
import { blocksToSettle } from "./lib/timing.ts";

type Game = {
  state: { address: string };
  pot: { address: string };
  params: { basePrice: string; priceStep: string; timeoutBlocks: number };
};

const POLL_MS = 25_000;
const $ = (id: string) => document.getElementById(id)!;

const CARD = "rounded-2xl p-5 ring-1";
const CARD_NORMAL = `${CARD} bg-slate-900 ring-slate-800`;
const CARD_READY = `${CARD} bg-amber-500/10 ring-amber-400`;

function formatUnits(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString();
  const s = amount.toString().padStart(decimals + 1, "0");
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

async function loadGame(): Promise<Game> {
  const res = await fetch(`${import.meta.env.BASE_URL}game.${CONFIG.network}.json`);
  if (!res.ok) throw new Error(`Cannot load game.${CONFIG.network}.json (${res.status})`);
  return res.json();
}

// Confirmations of a transaction, or null if the server answers in an unexpected shape
async function getConfirmations(provider: ElectrumNetworkProvider, txid: string): Promise<number | null> {
  const res: unknown = await provider.performRequest("blockchain.transaction.get", txid, true);
  if (res instanceof Error) throw res;
  if (res && typeof res === "object") {
    const n = (res as { confirmations?: unknown }).confirmations;
    if (n === undefined) return 0; // mempool transactions have no confirmations field
    const num = Number(n);
    if (Number.isFinite(num)) return num;
  }
  console.warn("Unexpected blockchain.transaction.get response", res);
  return null;
}

function renderCountdown(timeoutBlocks: number, confirmations: number | null) {
  const section = $("countdown");
  if (confirmations === null) {
    section.className = CARD_NORMAL;
    $("countdownTitle").textContent = "Countdown unavailable";
    $("countdownDetail").textContent = "Could not read the confirmation count from the network server.";
    return;
  }
  const togo = blocksToSettle(timeoutBlocks, confirmations);
  if (togo === 0) {
    section.className = CARD_READY;
    $("countdownTitle").textContent = "Ready to settle";
    $("countdownDetail").textContent = "Nobody grabbed in time. The holder can claim the pot now.";
  } else {
    section.className = CARD_NORMAL;
    $("countdownTitle").textContent = `${togo} more block${togo === 1 ? "" : "s"} until settle`;
    $("countdownDetail").textContent =
      confirmations === 0
        ? "Waiting for the latest grab to confirm. The countdown restarts at every grab."
        : `${confirmations} of ${timeoutBlocks} blocks passed since the last grab. Anyone can still grab until then.`;
  }
}

async function refresh(game: Game, provider: ElectrumNetworkProvider) {
  const [stateUtxos, potUtxos] = await Promise.all([
    provider.getUtxos(game.state.address),
    provider.getUtxos(game.pot.address),
  ]);
  const s = stateUtxos[0];
  const p = potUtxos[0];
  if (!s?.token?.nft || !p?.token) {
    $("status").textContent = "No live round found (it may have been settled, or the server is catching up).";
    return;
  }
  const c = decodeCommitment(s.token.nft.commitment);
  const price = BigInt(game.params.basePrice) + BigInt(game.params.priceStep) * BigInt(c.passCount);
  $("passCount").textContent = String(c.passCount);
  $("holder").textContent = `${c.holderPkh.slice(0, 8)}…${c.holderPkh.slice(-6)}`;
  $("pot").textContent = formatUnits(p.token.amount, CONFIG.pusdDecimals);
  $("price").textContent = formatUnits(price, CONFIG.pusdDecimals);

  const confirmations = await getConfirmations(provider, s.txid).catch((e) => {
    console.error(e);
    return null;
  });
  renderCountdown(game.params.timeoutBlocks, confirmations);
  $("status").textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

async function main() {
  const game = await loadGame();
  const provider = new ElectrumNetworkProvider(CONFIG.network);
  const tick = () =>
    refresh(game, provider).catch((e) => {
      console.error(e);
      $("status").textContent = "Could not reach the network. Retrying…";
    });
  await tick();
  setInterval(tick, POLL_MS);
}

main().catch((e) => {
  console.error(e);
  $("status").textContent = `Error: ${e instanceof Error ? e.message : e}`;
});