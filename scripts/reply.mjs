#!/usr/bin/env node
/**
 * Launch-day helper: turn an SVG someone sent you into a share link and a
 * high-resolution PNG, ready to paste back as a reply.
 *
 *   node scripts/reply.mjs path/to/logo.svg [--look Neon] [--size 4096]
 *                          [--url https://particle-logo.vercel.app] [--out replies]
 *
 * Needs Playwright with Chromium once:  npm i -D playwright && npx playwright install chromium
 * The share link is built here; the PNG is rendered by the live app in headless
 * Chromium, so it is exactly what the person would get by exporting themselves.
 */
import { readFile, mkdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { buildShareUrl } from '../src/engine/share.js';
import { LOOKS } from '../src/engine/config.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
if (!file) {
  console.error('usage: node scripts/reply.mjs logo.svg [--look Neon] [--size 4096] [--url <app url>] [--out replies]');
  process.exit(1);
}
const size = Number(opt('size', 4096));
const base = opt('url', 'https://particle-logo.vercel.app/').replace(/\/?$/, '/');
const outDir = resolve(opt('out', 'replies'));
const lookName = opt('look', null);
const looks = Array.isArray(LOOKS) ? LOOKS : Object.entries(LOOKS).map(([id, l]) => ({ id, ...l }));
const look = lookName ? looks.find((l) => [l.id, l.name].some((n) => String(n).toLowerCase() === lookName.toLowerCase())) : null;
if (lookName && !look) {
  console.error(`Unknown look "${lookName}". Looks: ${looks.map((l) => l.name || l.id).join(', ')}`);
  process.exit(1);
}

const svg = await readFile(file, 'utf8');
const name = basename(file).replace(/\.svg$/i, '');
const { url, includesSvg } = await buildShareUrl({
  source: { type: 'custom', svg, name },
  config: look ? look.settings : {},
  base,
});

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is needed once:  npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page.on('pageerror', (e) => console.error('page error:', e.message));

  const settled = async () => {
    // Wait until the custom logo is the one on stage and its layout has landed.
    await page.waitForFunction(
      (n) => {
        const stage = document.querySelector(`[aria-label^="${n} logo"]`);
        const count = Number((document.querySelector('.statusbar')?.textContent.match(/([\d,]+) particles/) || [])[1]?.replace(/,/g, ''));
        return Boolean(stage) && count > 0;
      },
      name,
      { timeout: 60_000, polling: 250 },
    );
    await page.waitForTimeout(600);
  };

  if (includesSvg) {
    await page.goto(url);
  } else {
    // Too big for a link: load it through the app's file picker instead.
    console.error('SVG is too large to travel in the link; the link carries the settings only.');
    await page.goto(base);
    await page.setInputFiles('input[type="file"]', resolve(file));
    if (look) await page.getByRole('button', { name: new RegExp(`^${look.name}\\b`) }).click();
  }
  await settled();

  await mkdir(outDir, { recursive: true });
  await page.getByLabel('Image size').selectOption(String(size));
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 300_000 }),
    page.getByRole('button', { name: 'PNG', exact: true }).click(),
  ]);
  const png = join(outDir, `${name}-${size}.png`);
  await download.saveAs(png);

  console.log(`PNG   ${png}`);
  console.log(`Link  ${url}`);
  console.log('');
  console.log(`Here you go: ${url}`);
} finally {
  await browser.close();
}
