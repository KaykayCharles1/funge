import { TestNetWallet } from "mainnet-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const FILE = ".wallet.chipnet.json";

async function main() {
  let wallet;
  if (existsSync(FILE)) {
    const { wif } = JSON.parse(readFileSync(FILE, "utf8"));
    wallet = await TestNetWallet.fromWIF(wif);
  } else {
    wallet = await TestNetWallet.newRandom();
    writeFileSync(FILE, JSON.stringify({ wif: wallet.privateKeyWif }, null, 2));
    console.log(`Created ${FILE} (gitignored). Chipnet keys only.`);
  }
  console.log("BCH address  :", wallet.getDepositAddress());
  console.log("Token address:", wallet.getTokenDepositAddress());
  console.log("Balance (sat?):", String(await wallet.getBalance()));}

main().catch((e) => { console.error(e); process.exit(1); });