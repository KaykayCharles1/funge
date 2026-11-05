export type Unconfirmed = {
  canSend: (id: string) => boolean;
  record: (id: string) => void;
  saturate: (id: string) => void; // the node told us the chain is full
  resetAll: () => void; // a block arrived
  count: (id: string) => number;
};

export function makeUnconfirmed(cap: number): Unconfirmed {
  const counts = new Map<string, number>();
  return {
    canSend: (id) => (counts.get(id) ?? 0) < cap,
    record: (id) => void counts.set(id, (counts.get(id) ?? 0) + 1),
    saturate: (id) => void counts.set(id, cap),
    resetAll: () => counts.clear(),
    count: (id) => counts.get(id) ?? 0,
  };
}