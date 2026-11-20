import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { binToHex } from "@bitauth/libauth";
import { SignatureTemplate } from "cashscript";
import { CONFIG } from "../src/config.ts";

// Makes a referee key and saves it in .referee.<network>.json (git ignores it). Prints only the PUBLIC key.
// Chipnet: the server and deploy-kingdom.ts read the file directly.
// Mainnet: the rule is to generate the key on the production host. For the hackathon demo the owner chose to make it
// on his own computer instead (the host has no shell on Render's free plan), so mainnet needs --demo:
//   VITE_FUNGE_NETWORK=mainnet node scripts/gen-referee-key.ts --demo
// Then copy privateKeyHex from the file into the host's REFEREE_KEY_MAINNET setting and delete the file.
const mainnet = CONFIG.network === "mainnet";
assert.ok(!mainnet || process.argv.includes("--demo"), "A mainnet referee key belongs on the production host. For the demo, add --demo.");

const FILE = `.referee.${CONFIG.network}.json`; // gitignored (.referee.*)
assert.ok(!existsSync(FILE), `${FILE} already exists. Delete it first if you really want a new key.`);

const privateKey = crypto.getRandomValues(new Uint8Array(32));
const publicKey = new SignatureTemplate(privateKey).publicKey;
writeFileSync(FILE, JSON.stringify({ privateKeyHex: binToHex(privateKey) }));

console.log(`Referee PUBLIC key (${CONFIG.network}):`, binToHex(publicKey));
console.log(`The private key is saved in ${FILE}, which git ignores. Never share or commit it.`);
if (mainnet) console.log("Next: copy privateKeyHex into Render's REFEREE_KEY_MAINNET, deploy the first rounds, then delete the file.");
