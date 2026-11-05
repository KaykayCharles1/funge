import assert from "node:assert/strict";
import { readServerEnv } from "../server/env.ts";

// defaults are for development: this computer only, the local page addresses
const dev = readServerEnv({});
assert.equal(dev.host, "127.0.0.1");
assert.equal(dev.port, 8787);
assert.ok(dev.allowedOrigins.includes("http://localhost:5173"));
assert.equal(dev.trustProxy, false);
assert.equal(dev.bellPreset, "standard");

// a cloud setup
const cloud = readServerEnv({
  FUNGE_HOST: "0.0.0.0", PORT: "8080", FUNGE_ALLOWED_ORIGINS: "https://funge.example.com", FUNGE_TRUST_PROXY: "1",
});
assert.deepEqual([cloud.host, cloud.port, cloud.allowedOrigins, cloud.trustProxy], ["0.0.0.0", 8080, ["https://funge.example.com"], true]);

// the Kingdom clock preset
assert.equal(readServerEnv({ FUNGE_BELL_PRESET: "demo" }).bellPreset, "demo");
assert.equal(readServerEnv({ FUNGE_BELL_PRESET: " standard " }).bellPreset, "standard");
assert.throws(() => readServerEnv({ FUNGE_BELL_PRESET: "fast" }), /FUNGE_BELL_PRESET/);

// unsafe or wrong settings refuse to start
assert.throws(() => readServerEnv({ FUNGE_HOST: "0.0.0.0" }), /FUNGE_ALLOWED_ORIGINS/);
assert.throws(() => readServerEnv({ FUNGE_HOST: "0.0.0.0", FUNGE_ALLOWED_ORIGINS: "http://funge.example.com" }), /https/);
assert.throws(() => readServerEnv({ FUNGE_ALLOWED_ORIGINS: "*" }), /valid origin/);
assert.throws(() => readServerEnv({ FUNGE_ALLOWED_ORIGINS: "https://funge.example.com/" }), /trailing slash/);
assert.throws(() => readServerEnv({ PORT: "abc" }), /Invalid port/);
console.log("ok: server settings are checked");
console.log("\nAll env tests passed.");