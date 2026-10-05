#!/usr/bin/env node
// Renders src/app/icon.svg (the header's "O" mark) into the two icon files
// that can't be SVG: src/app/favicon.ico (16, 32 and 48 px, for browsers
// without SVG favicons) and src/app/apple-icon.png (180 px, full-bleed —
// the phone rounds the corners itself). Run after changing icon.svg:
//
//   node scripts/render-icons.mjs
//
// Uses the Playwright Chromium the browser tests already install; makes no
// network calls.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/app");
const svg = readFileSync(path.join(appDir, "icon.svg"), "utf8");
const FAVICON_SIZES = [16, 32, 48];

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(source, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0">${source.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
const favicons = [];
for (const size of FAVICON_SIZES) favicons.push(await png(svg, size));
const apple = await png(svg.replace(/ rx="[\d.]+"/, ""), 180);
await browser.close();

// An .ico holding PNGs: a 6-byte header, a 16-byte entry per image, then the images.
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(favicons.length, 4);
let offset = header.length + 16 * favicons.length;
const entries = favicons.map((image, i) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(FAVICON_SIZES[i], 0);
  entry.writeUInt8(FAVICON_SIZES[i], 1);
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(image.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += image.length;
  return entry;
});
writeFileSync(path.join(appDir, "favicon.ico"), Buffer.concat([header, ...entries, ...favicons]));
writeFileSync(path.join(appDir, "apple-icon.png"), apple);
console.log("Wrote src/app/favicon.ico and src/app/apple-icon.png from src/app/icon.svg.");
