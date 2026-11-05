export type LockRunner = <T>(key: string, fn: () => Promise<T>) => Promise<T>;

// One job at a time per key (here: per round)
export function makeLocks(): LockRunner {
  const tails = new Map<string, Promise<void>>();
  return async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prev = tails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prev.then(() => mine);
    tails.set(key, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}