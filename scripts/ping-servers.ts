import { ElectrumNetworkProvider } from "cashscript";
import { CONFIG } from "../src/config.ts";

const TIMEOUT_MS = 20_000;

async function tryServer(hostname: string) {
  const started = Date.now();
  try {
    const provider = new ElectrumNetworkProvider("chipnet", { hostname });
    const height = await Promise.race([
      provider.getBlockHeight(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`no answer after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS),
      ),
    ]);
    return `OK    ${hostname}: block ${height} in ${Date.now() - started} ms`;
  } catch (e) {
    return `FAIL  ${hostname}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)} (${Date.now() - started} ms)`;
  }
}

async function main() {
  const lines = await Promise.all(CONFIG.chipnetServers.map(tryServer));
  console.log(lines.join("\n"));
}

main().then(() => process.exit(0));