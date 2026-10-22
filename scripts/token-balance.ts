import { readFileSync } from "node:fs";
import { ElectrumNetworkProvider } from "cashscript";
import { TestNetWallet } from "mainnet-js";
import { pusdCategory } from "../src/config.ts";

async function main() {
  const { wif } = JSON.parse(readFileSync(".wallet.chipnet.json", "utf8"));
  const wallet = await TestNetWallet.fromWIF(wif);
  const provider = new ElectrumNetworkProvider("chipnet");
  const utxos = await provider.getUtxos(wallet.getDepositAddress());
  const pusd = utxos.filter((u) => u.token?.category === pusdCategory());
  const total = pusd.reduce((sum, u) => sum + u.token!.amount, 0n);
  console.log("test PUSD UTXOs:", pusd.length, "| total units:", String(total));
  console.log("BCH (sats):", String(utxos.reduce((s, u) => s + u.satoshis, 0n)));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });