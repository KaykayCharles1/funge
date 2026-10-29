// Usage: node scripts/ws-watch.ts <roundId> [afterSeq]
const [id, after] = process.argv.slice(2);
if (!id) throw new Error("usage: node scripts/ws-watch.ts <roundId> [afterSeq]");
const ws = new WebSocket(`ws://127.0.0.1:8787/rounds/${id}/ws${after ? `?after=${after}` : ""}`);
ws.onopen = () => console.log("open");
ws.onmessage = (m) => console.log(String(m.data));
ws.onclose = (e) => console.log("closed", e.code, e.reason);
ws.onerror = () => console.log("error");