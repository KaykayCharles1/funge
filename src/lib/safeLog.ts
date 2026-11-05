// Keeps secrets out of logs. A CashScript error can carry a debug link (a Bitauth template) that includes private keys.
export function safeText(input: string): string {
  let s = input;
  if (/bitauth/i.test(s)) {
    const i = s.indexOf("WARNING");
    if (i >= 0) s = `${s.slice(0, i)}[debug details removed]`;
    s = s.replace(/https?:\/\/\S*bitauth\S*/gi, "[debug link removed]");
  }
  s = s.replace(/\bxprv[1-9A-HJ-NP-Za-km-z]{100,}\b/g, "[key removed]"); // extended private key
  s = s.replace(/\b[5KLc][1-9A-HJ-NP-Za-km-z]{50,51}\b/g, "[key removed]"); // WIF private key
  s = s.replace(/((?:private|secret)[ _-]?key\W{0,4})[0-9a-f]{64}\b/gi, "$1[key removed]");
  return s;
}

function clean(arg: unknown): unknown {
  if (arg instanceof Error) return safeText(arg.stack ?? `${arg.name}: ${arg.message}`);
  if (typeof arg === "string") return safeText(arg);
  return arg;
}

// Call once at startup. Every console message then passes through safeText.
export function installSafeConsole(): void {
  for (const level of ["log", "info", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => original(...args.map(clean));
  }
}

// A repeating problem is reported once per window, with a count of the repeats that were skipped
const lastShown = new Map<string, number>();
const skipped = new Map<string, number>();
export function warnThrottled(key: string, text: string, everyMs = 60_000, now = Date.now()): void {
  const last = lastShown.get(key);
  if (last !== undefined && now - last < everyMs) {
    skipped.set(key, (skipped.get(key) ?? 0) + 1);
    return;
  }
  const n = skipped.get(key) ?? 0;
  skipped.delete(key);
  lastShown.set(key, now);
  console.warn(n > 0 ? `${text} (${n} similar skipped)` : text);
}