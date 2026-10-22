import "./style.css";
import { ElectrumNetworkProvider } from "cashscript";
import { CONFIG } from "./config.ts";
import { decodeCommitment } from "./lib/commitment.ts";

type Game = {
  state: { address: string };
  pot: { address: string };
  params: { basePrice: string; priceStep: string; timeoutBlocks: number };
};

const POLL_MS = 25_000;
const $ = (id: string) => document.getElementById(id)!;

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