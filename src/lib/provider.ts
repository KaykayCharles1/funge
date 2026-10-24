import { ElectrumNetworkProvider } from "cashscript";
import { CONFIG } from "../config.ts";

type Net = NonNullable<ConstructorParameters<typeof ElectrumNetworkProvider>[0]>;

const CONNECTION_ERROR = /establish connection|failed to connect|websocket|socket|timed? ?out|closed|econn|enotfound/i;
const CONNECT_ONLY = /establish connection|failed to connect/i; // the only errors where a broadcast is safe to retry
const REQUEST_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// Tries several Electrum servers in turn, so one server being down does not take the app down
export class FailoverProvider extends ElectrumNetworkProvider {
  private servers: ElectrumNetworkProvider[];
  private preferred = 0;

  constructor(network: Net, hostnames: string[]) {
    super(network, { hostname: hostnames[0] });
    this.servers = hostnames.map((hostname) => new ElectrumNetworkProvider(network, { hostname }));
  }

  override async performRequest(name: string, ...parameters: (string | number | boolean)[]) {
    const isBroadcast = name === "blockchain.transaction.broadcast";
    let lastError: unknown;
    for (let i = 0; i < this.servers.length; i++) {
      const index = (this.preferred + i) % this.servers.length;
      try {
        const request = this.servers[index].performRequest(name, ...parameters);
        const result = await (isBroadcast ? request : withTimeout(request, REQUEST_TIMEOUT_MS));
        this.preferred = index;
        return result;
      } catch (e) {
        lastError = e;
        const message = e instanceof Error ? e.message : String(e);
        if (!(isBroadcast ? CONNECT_ONLY : CONNECTION_ERROR).test(message)) throw e;
        console.warn(`Electrum server #${index} failed (${message.split("\n")[0]}); trying the next one`);
      }
    }
    throw lastError;
  }
}

export function makeProvider(): ElectrumNetworkProvider {
  if (CONFIG.network === "chipnet") return new FailoverProvider("chipnet", CONFIG.chipnetServers);
  return new ElectrumNetworkProvider("mainnet"); // a mainnet server list comes before the mainnet round
}