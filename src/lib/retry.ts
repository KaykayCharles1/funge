// Retry flaky network reads (Electrum connections sometimes drop)
export async function retry<T>(fn: () => Promise<T>, tries = 3, delayMs = 1500): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}