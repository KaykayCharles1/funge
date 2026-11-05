import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Store, emptyStoreFile, readStoreFile } from "../server/store.ts";

// Child mode: write as fast as possible until killed
if (process.argv[2] === "writer") {
  const store = new Store(process.argv[3]!, emptyStoreFile());
  for (let i = 1; ; i++) {
    store.data.heartbeat = i;
    store.data.rounds["g"] = {
      gameId: "g", status: "open", deadline: i, paused: null, nextSeq: i, events: [],
    };
    await store.save();
  }
}

const dir = mkdtempSync(join(tmpdir(), "funge-store-"));

// 1. round trip
{
  const path = join(dir, "a.json");
  const { store, source } = await Store.open(path);
  assert.equal(source, "empty");
  store.data.heartbeat = 42;
  await store.save();
  const again = await readStoreFile(path);
  assert.equal(again.source, "main");
  assert.equal(again.data.heartbeat, 42);
  console.log("ok: round trip");
}

// 2. many writes in a row and several at once
{
  const path = join(dir, "b.json");
  const { store } = await Store.open(path);
  for (let i = 0; i < 300; i++) {
    store.data.heartbeat = i;
    await store.save();
  }
  await Promise.all(Array.from({ length: 50 }, (_, i) => ((store.data.heartbeat = 1000 + i), store.save())));
  assert.equal((await readStoreFile(path)).data.heartbeat, 1049);
  console.log("ok: 350 writes, 50 of them concurrent");
}

// 3. corrupt main file falls back to the .bak copy
{
  const path = join(dir, "c.json");
  const { store } = await Store.open(path);
  store.data.heartbeat = 1;
  await store.save();
  store.data.heartbeat = 2;
  await store.save(); // .bak now holds heartbeat 1
  writeFileSync(path, "{ this is not json");
  const r = await readStoreFile(path);
  assert.equal(r.source, "bak");
  assert.equal(r.data.heartbeat, 1);
  console.log("ok: corrupt file recovered from backup");
}

// 4. kill the writer mid-write, repeatedly: the file must always load
{
  const path = join(dir, "d.json");
  for (let round = 1; round <= 8; round++) {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "writer", path], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 700));
    child.kill();
    await new Promise((r) => child.once("exit", r));
    const r = await readStoreFile(path);
    assert.notEqual(r.source, "empty", `round ${round}: file was lost`);
    assert.equal(typeof r.data.heartbeat, "number");
    console.log(`ok: kill ${round}/8, loaded from ${r.source}, heartbeat ${r.data.heartbeat}`);
  }
}
console.log("\nAll store tests passed.");