import { ElectrumNetworkProvider } from "cashscript";
import { CONFIG } from "../config.ts";

type Net = NonNullable<ConstructorParameters<typeof ElectrumNetworkProvider>[0]>;
type Response = Awaited<ReturnType<ElectrumNetworkProvider["performRequest"]>>;

const CONNECTION_ERROR = /establish connection|failed to connect|websocket|socket|timed? ?out|closed|econn|enotfound/i;
const CONNECT_ONLY = /establish connection|failed to connect/i; // the only errors where a broadcast is safe to retry
const REQUEST_TIMEOUT_MS = 12_000;
const HEDGE_DELAY_MS = 1_500; // ask the next server if the current one has not answered by then
const PREFERRED_KEY = "funge:server";

const readPreferred = () => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PREFERRED_KEY);
  } catch {
    return null;
  }
};

const savePreferred = (hostname: string) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFERRED_KEY, hostname);
  } catch {
    // optional
  }
};

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

// Uses several Electrum servers: reads are "hedged" (the next server is asked if the first is slow),
// broadcasts go to one server at a time so a transaction cannot be sent twice.
export class FailoverProvider extends ElectrumNetworkProvider {
  private servers: ElectrumNetworkProvider[];
  private hostnames: string[];
  private preferred = 0;

  constructor(network: Net, hostnames: string[]) {
    super(network, { hostname: hostnames[0] });
    this.hostnames = hostnames;
    this.servers = hostnames.map((hostname) => new ElectrumNetworkProvider(network, { hostname }));
    const saved = readPreferred();
    const index = saved ? hostnames.indexOf(saved) : -1;
    if (index >= 0) this.preferred = index;
  }

  private markPreferred(index: number) {
    if (this.preferred === index) return;
    this.preferred = index;
    savePreferred(this.hostnames[index]);
  }

  override async performRequest(name: string, ...parameters: (string | number | boolean)[]): Promise<Response> {
    if (name === "blockchain.transaction.broadcast") return this.sequential(name, parameters);
    return this.hedged(name, parameters);
  }

  private async sequential(name: string, parameters: (string | number | boolean)[]): Promise<Response> {
    let lastError: unknown;
    for (let i = 0; i < this.servers.length; i++) {
      const index = (this.preferred + i) % this.servers.length;
      try {
        const result = await this.servers[index].performRequest(name, ...parameters);
        this.markPreferred(index);
        return result;
      } catch (e) {
        lastError = e;
        const message = e instanceof Error ? e.message : String(e);
        if (!CONNECT_ONLY.test(message)) throw e; // anything else may mean the server did receive it
        console.warn(`Electrum server #${index} could not connect; trying the next one`);
      }
    }
    throw lastError;
  }

  private hedged(name: string, parameters: (string | number | boolean)[]): Promise<Response> {
    const order = this.servers.map((_, i) => (this.preferred + i) % this.servers.length);
    return new Promise<Response>((resolve, reject) => {
      let started = 0;
      let failed = 0;
      let done = false;
      let lastError: unknown;

      const startNext = () => {
        if (done || started >= order.length) return;
        const index = order[started++];
        const hedgeTimer = setTimeout(startNext, HEDGE_DELAY_MS);
        withTimeout(this.servers[index].performRequest(name, ...parameters), REQUEST_TIMEOUT_MS).then(
          (result) => {
            clearTimeout(hedgeTimer);
            if (done) return;
            done = true;
            this.markPreferred(index);
            resolve(result);
          },
          (e) => {
            clearTimeout(hedgeTimer);
            if (done) return;
            lastError = e;
            const message = e instanceof Error ? e.message : String(e);
            if (!CONNECTION_ERROR.test(message)) {
              done = true; // a real answer from the server (e.g. an error), so do not retry elsewhere
              reject(e);
              return;
            }
            failed++;
            console.warn(`Electrum server #${index} failed (${message.split("\n")[0]})`);
            if (started < order.length) startNext();
            else if (failed >= order.length) {
              done = true;
              reject(lastError);
            }
          },
        );
      };
      startNext();
    });
  }
}

export function makeProvider(): ElectrumNetworkProvider {
  if (CONFIG.network === "chipnet") return new FailoverProvider("chipnet", CONFIG.chipnetServers);
  return new ElectrumNetworkProvider("mainnet"); // a mainnet server list comes before the mainnet round
}