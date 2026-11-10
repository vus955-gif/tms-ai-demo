/**
 * One-off generator of the synthetic service documents used in the demo ("Kartoteka floty":
 * document → AI → entry in the fleet file). Renders a plain form with Playwright and makes it
 * look like a phone photo with sharp. Output: public/service-samples.
 *
 * Usage: npx tsx scripts/generate-service-docs.ts
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { serviceSamples, type ServiceSample } from "../src/simulation/scenario/service-samples";

const OUT = path.join(process.cwd(), "public", "service-samples");
const W = 900;
const H = 1100;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function html(sample: ServiceSample): string {
  const rows = sample.lines.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; width: ${W}px; height: ${H}px; background: #f4f1ea; font-family: Arial, Helvetica, sans-serif; color: #1b1f2e; }
    .sheet { position: absolute; inset: 26px; background: #fffefb; border: 1px solid #b9b3a5; padding: 44px 48px; }
    h1 { margin: 0 0 6px; font-size: 25px; letter-spacing: .5px; }
    .sub { font-size: 13px; color: #555; margin-bottom: 28px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #8c8676; padding: 12px 14px; font-size: 17px; text-align: left; vertical-align: top; }
    th { width: 40%; background: #f1ede2; font-weight: normal; color: #3a3a3a; }
    td { font-family: "Courier New", monospace; font-weight: bold; }
    .foot { position: absolute; left: 48px; right: 48px; bottom: 44px; display: flex; justify-content: space-between; align-items: flex-end; }
    .sig { font-family: "Segoe Script", "Ink Free", "Brush Script MT", cursive; font-size: 30px; color: #1a3d8f; transform: rotate(-5deg); }
    .stamp { width: 210px; border: 3px double #2c4fb0; color: #2c4fb0; padding: 10px; text-align: center; font-size: 12px; font-weight: bold; transform: rotate(-4deg); opacity: .85; }
    .note { font-size: 11px; color: #777; }
  </style></head><body><div class="sheet">
    <h1>${esc(sample.title)}</h1>
    <div class="sub">Dokument przykładowy do demo — dane fikcyjne</div>
    <table>${rows}</table>
    <div class="foot">
      <div><div class="sig">J. Kowalczyk</div><div class="note">podpis osoby upoważnionej</div></div>
      <div class="stamp">${esc(sample.truth.issuer)}<br>${esc(sample.truth.docNumber)}</div>
    </div>
  </div></body></html>`;
}

/** A slight tilt, a soft shadow and a little blur: a document photographed on a desk, still easy to read. */
async function photo(png: Buffer, index: number): Promise<Buffer> {
  const rotated = await sharp(png).rotate(index % 2 ? 1.1 : -0.9, { background: "#5b5148" }).toBuffer({ resolveWithObject: true });
  const { width, height } = rotated.info;
  const shadow = Buffer.from(
    `<svg width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.12"/><stop offset="0.55" stop-color="#000" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  );
  const shadowPng = await sharp(shadow).resize(width, height, { fit: "fill" }).png().toBuffer();
  const lit = await sharp(rotated.data).composite([{ input: shadowPng, blend: "over" }]).png().toBuffer();
  return sharp(lit).blur(0.5).resize({ width: 1000 }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const [i, sample] of serviceSamples.entries()) {
    await page.setContent(html(sample));
    const jpg = await photo(await page.screenshot({ type: "png" }), i);
    await sharp(jpg).toFile(path.join(OUT, path.basename(sample.file)));
    console.log(`${sample.file} (${Math.round(jpg.length / 1024)} kB)`);
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
