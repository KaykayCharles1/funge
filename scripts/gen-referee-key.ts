import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { binToHex } from "@bitauth/libauth";
import { SignatureTemplate } from "cashscript";
import { CONFIG } from "../src/config.ts";

assert.equal(CONFIG.network, "chipnet", "Referee keys for mainnet are generated only on the production server.");

const FILE = ".referee.chipnet.json"; // gitignored
assert.ok(!existsSync(FILE), `${FILE} already exists. Delete it first if you really want a new key.`);

const privateKey = crypto.getRandomValues(new Uint8Array(32));
const publicKey = new SignatureTemplate(privateKey).publicKey;
writeFileSync(FILE, JSON.stringify({ privateKeyHex: binToHex(privateKey) }));

console.log("Referee PUBLIC key (chipnet test key):", binToHex(publicKey));
console.log(`The private key is saved in ${FILE}, which git ignores. Never share or commit it.`);