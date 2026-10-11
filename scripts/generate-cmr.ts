/**
 * One-off generator of the synthetic CMR photos used in the demo.
 * Renders a fictional CMR form (HTML) with Playwright, then makes it look like a
 * phone photo with sharp (rotation, shadow, blur, noise). Output: public/cmr-samples.
 *
 * Usage: npx tsx scripts/generate-cmr.ts
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { cmrSamples, type CmrSample } from "../src/simulation/scenario/cmr-samples";

const OUT = path.join(process.cwd(), "public", "cmr-samples");
const W = 900;
const H = 1270;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function html(sample: CmrSample): string {
  const t = sample.truth;
  const box = (n: string, title: string, body: string, style = "") =>
    `<div class="box" style="${style}"><div class="n">${n}</div><div class="t">${title}</div><div class="v">${body}</div></div>`;
  const stamp = t.stamp
    ? `<div class="stamp"><div>${esc(t.consignee.split("—")[0].trim().slice(0, 28))}</div><div class="big">PRZYJĘTO</div><div>${t.issuedDate.replace("09.10", "10.10")}</div></div>`
    : "";
  const signature = t.signature ? `<div class="sig">${esc(t.consignee.split(" ")[0])} K.</div>` : "";
  const remarks = t.remarks ? `<div class="remark">${esc(t.remarks)}</div>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; width: ${W}px; height: ${H}px; background: #fbfaf5; font-family: Arial, Helvetica, sans-serif; color: #1e2a4a; }
    .sheet { position: absolute; inset: 22px; border: 2px solid #c0392b; background: #fffdf6; }
    .head { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 2px solid #c0392b; color: #c0392b; }
    .head h1 { margin: 0; font-size: 22px; letter-spacing: 2px; }
    .head .sub { font-size: 11px; }
    .head .no { font-family: "Courier New", monospace; font-size: 18px; color: #1e2a4a; font-weight: bold; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; }
    .box { border-right: 1px solid #d98880; border-bottom: 1px solid #d98880; padding: 6px 8px 8px 28px; position: relative; min-height: 86px; }
    .n { position: absolute; left: 6px; top: 6px; color: #c0392b; font-weight: bold; font-size: 15px; }
    .t { color: #c0392b; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 4px; }
    .v { font-family: "Courier New", monospace; font-size: 15px; line-height: 1.35; color: #1b1f2e; white-space: pre-line; }
    .full { grid-column: 1 / 3; }
    .goods { display: grid; grid-template-columns: 1.1fr .6fr 2fr .9fr .8fr; }
    .goods .box { min-height: 120px; }
    .stamp { position: absolute; right: 40px; bottom: 26px; width: 170px; height: 170px; border: 4px double #2c4fb0; border-radius: 50%; color: #2c4fb0; transform: rotate(-14deg);
      display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; font-size: 12px; font-weight: bold; opacity: .82; padding: 14px; }
    .stamp .big { font-size: 22px; letter-spacing: 2px; margin: 6px 0; }
    .sig { position: absolute; left: 60px; bottom: 50px; font-family: "Segoe Script", "Ink Free", "Brush Script MT", cursive; font-size: 34px; color: #1a3d8f; transform: rotate(-6deg); }
    .remark { position: absolute; left: 34px; right: 230px; top: 46px; font-family: "Ink Free", "Segoe Script", cursive; font-size: 21px; color: #1a3d8f; transform: rotate(-2deg); line-height: 1.25; }
    .b24 { min-height: 250px; position: relative; }
  </style></head><body><div class="sheet">
    <div class="head"><div><h1>CMR</h1><div class="sub">MIĘDZYNARODOWY SAMOCHODOWY LIST PRZEWOZOWY · LETTRE DE VOITURE INTERNATIONALE</div></div><div class="no">${esc(t.cmrNumber)}</div></div>
    <div class="grid">
      ${box("1", "Nadawca (nazwa, adres, kraj)", `${esc(t.sender)}\n${esc(t.senderAddress)}`)}
      ${box("16", "Przewoźnik (nazwa, adres, kraj)", esc(t.carrier))}
      ${box("2", "Odbiorca (nazwa, adres, kraj)", `${esc(t.consignee)}\n${esc(t.consigneeAddress)}`)}
      ${box("17", "Kolejni przewoźnicy", "—")}
      ${box("3", "Miejsce przeznaczenia przesyłki", esc(t.placeOfDelivery))}
      ${box("18", "Zastrzeżenia i uwagi przewoźnika", "brak")}
      ${box("4", "Miejsce i data załadowania", `${esc(t.takeoverPlace)}\n${t.issuedDate}`)}
      ${box("5", "Załączone dokumenty / referencje", esc(t.references.join(", ")))}
    </div>
    <div class="goods">
      ${box("6", "Cechy i numery", "EUR")}
      ${box("7", "Ilość sztuk", String(t.packages))}
      ${box("9", "Rodzaj towaru", esc(t.goods))}
      ${box("11", "Waga brutto kg", t.weightKg.toLocaleString("pl-PL"))}
      ${box("12", "Objętość m³", "—")}
    </div>
    <div class="grid">
      ${box("13", "Instrukcje nadawcy", `Ref.: ${esc(t.references.join(", "))}`, "grid-column: 1 / 3")}
      ${box("21", "Wystawiono w / dnia", `${esc(t.takeoverPlace.split(",")[0])}, ${t.issuedDate}`)}
      ${box("23", "Podpis i stempel przewoźnika", "TransDemo")}
      <div class="box b24 full"><div class="n">24</div><div class="t">Przesyłkę otrzymano · miejsce, data, podpis i stempel odbiorcy</div>${remarks}${signature}${stamp}</div>
    </div>
  </div></body></html>`;
}

async function photo(png: Buffer, sample: CmrSample): Promise<Buffer> {
  const rotate = sample.variant === "krzywy" ? 6.5 : sample.variant === "rozmazany" ? -2.5 : sample.id.length % 2 ? 0.8 : -0.6;
  let img = sharp(png).rotate(rotate, { background: "#5b5148" });
  const meta = await img.toBuffer({ resolveWithObject: true });
  const { width, height } = meta.info;
  // A soft shadow across part of the sheet, like a hand holding a phone.
  const shadowOpacity = sample.variant === "krzywy" ? 0.38 : 0.12;
  const shadow = Buffer.from(
    `<svg width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#000" stop-opacity="${shadowOpacity}"/><stop offset="0.55" stop-color="#000" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  );
  const shadowPng = await sharp(shadow).resize(width, height, { fit: "fill" }).png().toBuffer();
  // sharp resizes before compositing, so materialise the shadow first.
  img = sharp(await sharp(meta.data).composite([{ input: shadowPng, blend: "over" }]).png().toBuffer());
  if (sample.variant === "rozmazany") img = img.blur(5.5).modulate({ brightness: 0.88 });
  else img = img.blur(0.5);
  return img.resize({ width: 1000 }).jpeg({ quality: sample.variant === "rozmazany" ? 55 : 80, mozjpeg: true }).toBuffer();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const sample of cmrSamples) {
    await page.setContent(html(sample));
    const png = await page.screenshot({ type: "png" });
    const jpg = await photo(png, sample);
    await sharp(jpg).toFile(path.join(OUT, path.basename(sample.file)));
    console.log(`${sample.file} (${Math.round(jpg.length / 1024)} kB)`);
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
