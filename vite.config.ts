import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { CONNECT_SOURCES } from "./src/connections.ts";
import { COPY } from "./src/copy.ts";

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

// The card a chat app or X shows for a shared link: Open Graph and Twitter tags in both pages. Crawlers do not run
// scripts, so the tags are written into the HTML. The words are COPY.preview; an invite link's title is set per
// link in worker/index.ts. Image URLs must be absolute.
const SITE = "https://funge.cash";
function previewTags(): Plugin {
  const P = COPY.preview;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const image = `${SITE}/assets/share/preview.jpg`;
  return {
    name: "funge-preview-tags",
    transformIndexHtml(html, ctx) {
      const page = ctx.path.startsWith("/play/") ? `${SITE}/play/` : `${SITE}/`;
      const tags: [string, string, string][] = [
        ["property", "og:type", "website"],
        ["property", "og:site_name", P.siteName],
        ["property", "og:title", P.title],
        ["property", "og:description", P.description],
        ["property", "og:url", page],
        ["property", "og:image", image],
        ["property", "og:image:type", "image/jpeg"],
        ["property", "og:image:width", "1200"],
        ["property", "og:image:height", "630"],
        ["property", "og:image:alt", P.imageAlt],
        ["name", "twitter:card", "summary_large_image"],
        ["name", "twitter:title", P.title],
        ["name", "twitter:description", P.description],
        ["name", "twitter:image", image],
        ["name", "twitter:image:alt", P.imageAlt],
      ];
      const meta = tags.map(([k, n, v]) => `    <meta ${k}="${n}" content="${esc(v)}" />`).join("\n");
      return html.replace("</head>", `${meta}\n  </head>`);
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), csp(), previewTags()],
  build: {
    // Two pages: the landing page at / (index.html) and the game at /play/ (play/index.html)
    rollupOptions: {
      input: {
        landing: fileURLToPath(new URL("./index.html", import.meta.url)),
        play: fileURLToPath(new URL("./play/index.html", import.meta.url)),
      },
    },
  },
});