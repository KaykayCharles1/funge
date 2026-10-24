export type FrameInput = { passCount: number; holderPkh: string; gameCategory: string };
export type Caption = { line1: string; line2: string };

const CX = 200;
const CY = 190;

// FNV-1a 32-bit hash: turns any string into a seed
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32: a small seeded random number generator (same seed, same sequence)
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const hsl = (h: number, s: number, l: number) => `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
const f1 = (n: number) => n.toFixed(1);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Deterministic: the same (gameCategory, passCount, holderPkh) always gives the same picture
export function frameSvg(input: FrameInput, caption?: Caption): string {
  const { passCount, holderPkh, gameCategory } = input;
  const heat = Math.min(1, passCount / 25);
  const holderHue = parseInt(holderPkh.slice(0, 4), 16) % 360;
  const frame = mulberry32(hash32(`frame:${gameCategory}:${passCount}:${holderPkh}`));

  const skin = hsl(lerp(38, 6, heat), lerp(45, 88, heat), lerp(62, 50, heat));
  const skinLight = hsl(lerp(40, 14, heat), lerp(55, 90, heat), lerp(74, 64, heat));
  const skinDark = hsl(lerp(32, 2, heat), lerp(40, 80, heat), lerp(40, 28, heat));

  // Potato outline: fixed per game
  const shape = mulberry32(hash32(`shape:${gameCategory}`));
  const phases = [shape() * 6.283, shape() * 6.283, shape() * 6.283];
  const outline: string[] = [];
  for (let i = 0; i < 120; i++) {
    const t = (i / 120) * Math.PI * 2;
    const r = 104 * (1 + 0.14 * Math.sin(2 * t + phases[0]) + 0.1 * Math.sin(3 * t + phases[1]) + 0.05 * Math.sin(5 * t + phases[2]));
    outline.push(`${f1(CX + r * 1.18 * Math.cos(t))},${f1(CY + r * 0.9 * Math.sin(t))}`);
  }

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">`);
  parts.push(
    `<defs>` +
      `<radialGradient id="bg" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="${hsl(holderHue, 55, 22)}"/><stop offset="1" stop-color="${hsl(holderHue + 40, 60, 6)}"/></radialGradient>` +
      `<radialGradient id="skin" cx="38%" cy="32%" r="80%"><stop offset="0" stop-color="${skinLight}"/><stop offset="0.55" stop-color="${skin}"/><stop offset="1" stop-color="${skinDark}"/></radialGradient>` +
      `</defs>`,
  );
  parts.push(`<rect width="400" height="400" fill="url(#bg)"/>`);
  parts.push(
    `<ellipse cx="${CX}" cy="${CY}" rx="${f1(150 + heat * 20)}" ry="${f1(128 + heat * 18)}" fill="none" stroke="${hsl(holderHue, 80, 60)}" stroke-opacity="0.35" stroke-width="${f1(2 + heat * 5)}"/>`,
  );
  parts.push(`<ellipse cx="${CX}" cy="330" rx="115" ry="13" fill="#000" opacity="0.35"/>`);
  parts.push(`<path d="M${outline.join(" L")} Z" fill="url(#skin)" stroke="${skinDark}" stroke-width="3" stroke-linejoin="round"/>`);

  // One mark per pass (capped); the newest one takes the holder's color
  const spotCount = Math.min(passCount, 48);
  const newest = (passCount - 1) % 48;
  for (let i = 0; i < spotCount; i++) {
    const r = mulberry32(hash32(`spot:${gameCategory}:${i}`));
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 0.78;
    const x = CX + Math.cos(a) * d * 104 * 1.12;
    const y = CY + Math.sin(a) * d * 104 * 0.82;
    const s = 4 + r() * 7;
    if (i === newest) {
      parts.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(s + 3)}" fill="${hsl(holderHue, 85, 60)}" stroke="#fff" stroke-opacity="0.7" stroke-width="2"/>`);
    } else {
      parts.push(`<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(s)}" ry="${f1(s * 0.75)}" fill="${skinDark}" opacity="0.75"/>`);
    }
  }

  // Cracks open as the potato gets hotter
  const cracks = Math.min(6, Math.max(0, Math.floor((passCount - 8) / 3)));
  for (let k = 0; k < cracks; k++) {
    const r = mulberry32(hash32(`crack:${gameCategory}:${k}`));
    const a = r() * Math.PI * 2;
    const pts: string[] = [];
    for (let j = 0; j < 4; j++) {
      const d = 0.95 - j * 0.14 - r() * 0.05;
      const jitter = (r() - 0.5) * 0.5;
      pts.push(`${f1(CX + Math.cos(a + jitter) * d * 104 * 1.12)},${f1(CY + Math.sin(a + jitter) * d * 104 * 0.85)}`);
    }
    parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${hsl(8, 80, 26)}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`);
  }

  // Face: eyes dilate, smile turns into a frown as heat rises
  const look = (frame() - 0.5) * 6;
  const pupil = 4 + heat * 3;
  for (const dx of [-26, 26]) {
    parts.push(`<circle cx="${CX + dx}" cy="${CY - 14}" r="11" fill="#fff"/>`);
    parts.push(`<circle cx="${f1(CX + dx + look)}" cy="${CY - 14}" r="${f1(pupil)}" fill="#1b1308"/>`);
  }
  parts.push(
    `<path d="M${CX - 22} ${CY + 32} Q${CX} ${f1(CY + 32 + lerp(14, -12, heat))} ${CX + 22} ${CY + 32}" fill="none" stroke="${hsl(20, 60, 18)}" stroke-width="4" stroke-linecap="round"/>`,
  );
  if (heat > 0.45) {
    parts.push(`<path d="M${CX + 62} ${CY - 44} q9 15 0 22 q-9 -7 0 -22z" fill="${hsl(200, 80, 70)}" opacity="0.85"/>`);
  }

  // Steam gets thicker with heat
  const steamN = 2 + Math.floor(heat * 3);
  for (let k = 0; k < steamN; k++) {
    const x = CX - 55 + k * (110 / (steamN - 1));
    const wob = (frame() > 0.5 ? 1 : -1) * (8 + frame() * 6);
    parts.push(`<path d="M${f1(x)} 80 q${f1(wob)} -14 0 -26 t0 -26" fill="none" stroke="#fff" stroke-opacity="${f1(0.25 + heat * 0.25)}" stroke-width="4" stroke-linecap="round"/>`);
  }

  // Sparkles change every frame so no two frames look alike
  const sparkles = 4 + Math.floor(frame() * 6);
  for (let k = 0; k < sparkles; k++) {
    const a = frame() * Math.PI * 2;
    const dist = 150 + frame() * 40;
    const x = Math.min(385, Math.max(15, CX + Math.cos(a) * dist));
    const y = Math.min(325, Math.max(15, CY + Math.sin(a) * dist * 0.85));
    const s = 4 + frame() * 5;
    parts.push(
      `<path d="M${f1(x)} ${f1(y - s)} L${f1(x + s / 3)} ${f1(y - s / 3)} L${f1(x + s)} ${f1(y)} L${f1(x + s / 3)} ${f1(y + s / 3)} L${f1(x)} ${f1(y + s)} L${f1(x - s / 3)} ${f1(y + s / 3)} L${f1(x - s)} ${f1(y)} L${f1(x - s / 3)} ${f1(y - s / 3)} Z" fill="${hsl(holderHue, 90, 80)}" opacity="0.9"/>`,
    );
  }

  if (caption) {
    parts.push(`<rect x="0" y="342" width="400" height="58" fill="#000" opacity="0.6"/>`);
    parts.push(`<text x="200" y="368" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" letter-spacing="2" fill="#fbbf24">${esc(caption.line1)}</text>`);
    parts.push(`<text x="200" y="390" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="#ffffff">${esc(caption.line2)}</text>`);
  }
  parts.push(`</svg>`);
  return parts.join("");
}

export const svgToDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export async function svgToPngBlob(svg: string, size = 1080): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not render the image"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available");
    ctx.drawImage(img, 0, 0, size, size);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Phones: open the share sheet. Desktop: download the PNG.
export async function shareOrDownload(blob: Blob, filename: string, text: string): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: "image/png" });
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Funge", text });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "shared";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}