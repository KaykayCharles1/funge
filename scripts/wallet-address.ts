// Prints the receiving address of a game wallet and its balances. It never prints the seed phrase.
//   read -rs SPIKE_MNEMONIC; export SPIKE_MNEMONIC
//   node scripts/wallet-address.ts            (for the second wallet: MNEMONIC_VAR=SPIKE_MNEMONIC_2 node scripts/wallet-address.ts)
import { makeProvider } from "../src/lib/provider.ts";
import { walletFromMnemonic } from "../src/wallet/local.ts";

const name = process.env.MNEMONIC_VAR ?? "SPIKE_MNEMONIC";
const phrase = process.env[name];
if (!phrase) throw new Error(`Set ${name} first.`);
const wallet = walletFromMnemonic(phrase);
const balances = await wallet.getBalances(makeProvider());
console.log(`${name}:`);
console.log("  token-aware address:", wallet.tokenAddress);
console.log(`  BCH on the address: ${balances.sats} sats, PUSD: ${balances.pusd} units`);
process.exit(0);