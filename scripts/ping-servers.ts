import { ElectrumNetworkProvider } from "cashscript";

const CANDIDATES: (string | undefined)[] = [
  undefined, // the library's own default
  "chipnet.imaginary.cash",
  "chipnet.bch.ninja",
  "chipnet.c3-soft.com",
  "cbch.loping.net",
];

async function tryServer(hostname?: string) {
  const label = hostname ?? "(library default)";
  const started = Date.now();
  try {
    const provider = hostname
      ? new ElectrumNetworkProvider("chipnet", { hostname })
      : new ElectrumNetworkProvider("chipnet");
    const height = await Promise.race([
      provider.getBlockHeight(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out after 10s")), 10_000)),
    ]);
    console.log(`OK    ${label}: block ${height} in ${Date.now() - started} ms`);
  } catch (e) {
    console.log(`FAIL  ${label}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }
}

async function main() {
  for (const h of CANDIDATES) await tryServer(h);
}

main().then(() => process.exit(0));