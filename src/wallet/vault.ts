import { isValidMnemonic, normalizeMnemonic, walletFromMnemonic } from "./local.ts";
import type { LocalWallet } from "./local.ts";

export type VaultState = "none" | "locked" | "unlocked";

export type VaultRecord = {
  version: 1;
  mode: "device" | "password";
  iv: Uint8Array;
  ciphertext: Uint8Array;
  salt?: Uint8Array; // password mode
  iterations?: number; // password mode
  deviceKey?: CryptoKey; // device mode: a non-extractable key held by the browser
};

export type VaultStorage = {
  get(): Promise<VaultRecord | undefined>;
  put(record: VaultRecord): Promise<void>;
  clear(): Promise<void>;
};

const PBKDF2_ITERATIONS = 600_000;
const MIN_PASSWORD_LENGTH = 8;
const AAD = new TextEncoder().encode("funge-vault-v1");

// Copies into a plain ArrayBuffer-backed array, which is what WebCrypto's typings expect
const buf = (bytes: Uint8Array) => new Uint8Array(bytes);

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", buf(new TextEncoder().encode(password)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: buf(salt), iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encrypt(key: CryptoKey, plaintext: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: buf(AAD) },
    key,
    buf(new TextEncoder().encode(plaintext)),
  );
  return { iv, ciphertext: new Uint8Array(encrypted) };
}

// Returns null if the key is wrong or the data was tampered with
async function decrypt(key: CryptoKey, iv: Uint8Array, ciphertext: Uint8Array): Promise<string | null> {
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(iv), additionalData: buf(AAD) }, key, buf(ciphertext));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export function makeVault(storage: VaultStorage) {
  let record: VaultRecord | undefined;
  let session: { mnemonic: string; wallet: LocalWallet } | null = null;

  const open = (mnemonic: string) => {
    session = { mnemonic, wallet: walletFromMnemonic(mnemonic) };
  };

  return {
    // Call once on page load. Device-mode wallets open automatically.
    async init(): Promise<VaultState> {
      record = await storage.get();
      if (!record) return "none";
      if (record.mode === "device" && record.deviceKey) {
        const phrase = await decrypt(record.deviceKey, record.iv, record.ciphertext);
        if (phrase) {
          open(phrase);
          return "unlocked";
        }
        // Damaged data: stays "locked" with no password, so the UI should offer "restore from seed phrase"
      }
      return "locked";
    },

    state(): VaultState {
      if (session) return "unlocked";
      return record ? "locked" : "none";
    },

    hasPassword(): boolean {
      return record?.mode === "password";
    },

    async create(mnemonic: string, password?: string): Promise<void> {
      const phrase = normalizeMnemonic(mnemonic);
      if (!isValidMnemonic(phrase)) throw new Error("That seed phrase is not valid. Check the words and their order.");
      if (password !== undefined && password.length < MIN_PASSWORD_LENGTH) {
        throw new Error(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters, or skip it.`);
      }
      if (await storage.get()) throw new Error("A wallet already exists in this browser. Delete it first.");

      let next: VaultRecord;
      if (password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
        next = { version: 1, mode: "password", salt, iterations: PBKDF2_ITERATIONS, ...(await encrypt(key, phrase)) };
      } else {
        const deviceKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        next = { version: 1, mode: "device", deviceKey, ...(await encrypt(deviceKey, phrase)) };
      }
      await storage.put(next);
      record = next;
      open(phrase);
    },

    // false = wrong password (the vault stays locked)
    async unlock(password: string): Promise<boolean> {
      if (!record || record.mode !== "password" || !record.salt || !record.iterations) return false;
      const key = await deriveKey(password, record.salt, record.iterations);
      const phrase = await decrypt(key, record.iv, record.ciphertext);
      if (!phrase) return false;
      open(phrase);
      return true;
    },

    lock() {
      session = null;
    },

    wallet(): LocalWallet | null {
      return session?.wallet ?? null;
    },

    // Only for an explicit "Back up my seed phrase" click in the UI
    revealMnemonic(): string | null {
      return session?.mnemonic ?? null;
    },

    async wipe(): Promise<void> {
      session = null;
      record = undefined;
      await storage.clear();
    },
  };
}

// --- Browser storage (IndexedDB) ---

const DB_NAME = "funge-wallet";
const STORE = "vault";
const KEY = "main";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open browser storage"));
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? request.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("Browser storage transaction was aborted"));
    };
  });
}

export const indexedDbStorage: VaultStorage = {
  get: () => run<VaultRecord | undefined>("readonly", (store) => store.get(KEY)),
  put: async (record) => {
    await run("readwrite", (store) => store.put(record, KEY));
  },
  clear: async () => {
    await run("readwrite", (store) => store.delete(KEY));
  },
};

// Asks the browser not to evict this data when it is short on space
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

// The vault the app uses in the browser
export const vault = makeVault(indexedDbStorage);