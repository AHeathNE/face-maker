// Screenshot a page in headless Chrome with software WebGL.
// Usage: node tools/shot.mjs <url> <out.png> [--w 1280] [--h 800] [--eval "js to run before shot"] [--wait ms]
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const [url, out] = args;
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: true, protocolTimeout: 0,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: Number(opt('--w', 1280)), height: Number(opt('--h', 800)) });
page.on('pageerror', (e) => console.error('pageerror:', e.message));
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && console.error(m.type() + ':', m.text().slice(0, 300)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__app?.ready, { timeout: 60000 });
const ev = opt('--eval', null);
if (ev) console.log('eval →', JSON.stringify(await page.evaluate(ev)));
await new Promise((r) => setTimeout(r, Number(opt('--wait', 1500))));
await page.screenshot({ path: out });
await browser.close();
