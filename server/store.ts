import { copyFile, mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";

export type EventData = Record<string, string | number | boolean | null>;
export type EventRecord = { seq: number; at: number; type: string; reason: string; data?: EventData };

// Only what the chain cannot tell us. King, pass count and state coin are read from the chain.
export type RoundRecord = {
  gameId: string;
  status: "waiting" | "open" | "over" | "settled";
  deadline: number | null; // epoch ms
  paused: { since: number; reason: string } | null;
  nextSeq: number;
  events: EventRecord[];
};

export type StoreFile = { version: 1; heartbeat: number | null; rounds: Record<string, RoundRecord> };

export const emptyStoreFile = (): StoreFile => ({ version: 1, heartbeat: null, rounds: {} });

const RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]); // Windows: antivirus/indexer can briefly hold a file
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const codeOf = (e: unknown) => (e as NodeJS.ErrnoException).code;

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      const code = codeOf(e);
      if (!code || !RETRY_CODES.has(code) || i >= 8) throw e;
      await sleep(20 * (i + 1));
    }
  }
}

// Write a temp file in the same folder, flush it to disk, keep the old file as .bak, then rename over.
export async function writeFileAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const fh = await open(tmp, "w");
  try {
    await fh.writeFile(text, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await copyFile(path, `${path}.bak`);
  } catch (e) {
    if (codeOf(e) !== "ENOENT") throw e;
  }
  await renameWithRetry(tmp, path);
}

function parseStore(text: string): StoreFile | null {
  try {
    const v = JSON.parse(text) as Partial<StoreFile>;
    if (v && v.version === 1 && v.rounds && typeof v.rounds === "object") {
      return { version: 1, heartbeat: typeof v.heartbeat === "number" ? v.heartbeat : null, rounds: v.rounds };
    }
  } catch {
    // fall through
  }
  return null;
}

export async function readStoreFile(path: string): Promise<{ data: StoreFile; source: "main" | "bak" | "empty" }> {
  for (const [file, source] of [[path, "main"], [`${path}.bak`, "bak"]] as const) {
    try {
      const data = parseStore(await readFile(file, "utf8"));
      if (data) return { data, source };
    } catch {
      // missing file: try the next one
    }
  }
  return { data: emptyStoreFile(), source: "empty" };
}

export class Store {
  path: string;
  data: StoreFile;
  private queue: Promise<void> = Promise.resolve();

  constructor(path: string, data: StoreFile) {
    this.path = path;
    this.data = data;
  }

  static async open(path: string): Promise<{ store: Store; source: "main" | "bak" | "empty" }> {
    const { data, source } = await readStoreFile(path);
    return { store: new Store(path, data), source };
  }

  // Writes are serialized; each write saves the data as it is at that moment.
  save(): Promise<void> {
    const run = this.queue.catch(() => undefined).then(() => writeFileAtomic(this.path, JSON.stringify(this.data)));
    this.queue = run;
    return run;
  }
}