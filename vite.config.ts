import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { CONNECT_SOURCES } from "./src/connections.ts";

// Adds a Content-Security-Policy to the production build. The dev server needs inline scripts and styles,
// so it is left alone: test the policy with `npm run build && npm run preview`.
function csp(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'", // wasm: the crypto library compiles WebAssembly
    "style-src 'self'",
    "img-src 'self' data: blob:", // data: for the art and QR, blob: for the PNG export
    `connect-src ${CONNECT_SOURCES.join(" ")}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
  return {
    name: "funge-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), csp()],
  build: {
    // Two pages: the game (index.html) and the landing page (landing.html)
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        landing: fileURLToPath(new URL("./landing.html", import.meta.url)),
      },
    },
  },
});