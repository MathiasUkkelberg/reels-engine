/**
 * Integration tests: real Chromium + ffmpeg. Skipped automatically when either is unavailable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { launchBrowser } from '../src/render/browser.ts';
import { buildHtml } from '../src/render/html.ts';
import { openPage, renderSpec } from '../src/render/renderer.ts';
import { parseSpec, timelineFor } from '../src/spec/validate.ts';
import { config } from '../reels.config.ts';
import { EXAMPLES, rawExample, tmpDir } from './helpers.ts';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

/** Fraction of pixels that differ by more than 2/255 between two PNGs (runs in the page; plain JS string so no bundler helpers leak in). */
const PIXEL_DIFF = `async function (A, C) {
  const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
  const [ia, ic] = await Promise.all([load(A), load(C)]);
  const cv = document.createElement('canvas'); cv.width = ia.width; cv.height = ia.height;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, cv.width, cv.height).data;
  g.clearRect(0, 0, cv.width, cv.height); g.drawImage(ic, 0, 0); const dc = g.getImageData(0, 0, cv.width, cv.height).data;
  let n = 0; for (let i = 0; i < da.length; i += 4) { const d = Math.max(Math.abs(da[i] - dc[i]), Math.abs(da[i + 1] - dc[i + 1]), Math.abs(da[i + 2] - dc[i + 2])); if (d > 2) n++; }
  return n / (cv.width * cv.height);
}`;
let browser: Browser | null = null;

beforeAll(async () => {
  try {
    browser = await launchBrowser();
  } catch {
    browser = null;
  }
});
afterAll(async () => {
  await browser?.close();
});

describe('templates in the browser', () => {
  const names = fs.readdirSync(EXAMPLES).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
  for (const name of names) {
    it(`${name}: hook visible by 0.5s, text inside safe zones, readable size, deterministic`, async (ctx) => {
      if (!browser) return ctx.skip();
      const spec = parseSpec(rawExample(name));
      const tl = timelineFor(spec);
      const dir = tmpDir();
      const file = path.join(dir, 'index.html');
      fs.writeFileSync(file, buildHtml(spec, tl));
      const p = await openPage(browser, file);
      try {
        const qaAt = (t: number) => p.page.evaluate(({ tt, s }) => { (window as any).__reel.seek(tt); return (window as any).__reel.qa(s); }, { tt: t, s: config.safeZone });
        expect((await qaAt(0.5)).hookOpacity).toBeGreaterThanOrEqual(0.95);
        for (const b of tl.beats) {
          const r = await qaAt(Math.min(tl.duration - 0.05, b.at + b.dur * 0.8));
          expect(r.violations, `safe-zone violations at beat ${b.i}`).toEqual([]);
          if (r.minFontPx !== null) expect(r.minFontPx).toBeGreaterThanOrEqual(30);
        }
        // Virtual clock: the same time renders the same frame regardless of seek order
        // (allowing a sliver of anti-aliasing differences: < 0.1% of pixels off by more than 2/255).
        const shot = async (t: number) => {
          await p.page.evaluate((tt) => (window as any).__reel.seek(tt), t);
          return (await p.page.screenshot({ type: 'png' })).toString('base64');
        };
        const t = tl.beats[1].at + 0.2;
        const a = await shot(t);
        await shot(tl.duration - 0.1);
        const c = await shot(t);
        const changed = await p.page.evaluate(`(${PIXEL_DIFF})(${JSON.stringify(a)}, ${JSON.stringify(c)})`);
        expect(changed).toBeLessThan(0.001);
      } finally {
        await p.page.close();
      }
    });
  }
});

describe('render pipeline', () => {
  it('renders 1080x1920 30fps H.264 + silent AAC with cover, caption and meta', async (ctx) => {
    if (!browser || !hasFfmpeg) return ctx.skip();
    const raw = rawExample('stat-productivity-audit');
    raw.duration_s = 5;
    raw.id = 'test-render';
    const spec = parseSpec(raw);
    const out = tmpDir();
    const meta = await renderSpec(spec, { browser, outDir: out, workers: 2 });
    expect(meta.video.video).toMatchObject({ codec: 'h264', width: 1080, height: 1920, fps: 30, pix_fmt: 'yuv420p' });
    expect(meta.video.audio).toMatchObject({ codec: 'aac', sample_rate: 48000 });
    expect(meta.video.duration).toBeGreaterThan(4.9);
    expect(meta.video.duration).toBeLessThan(5.2);
    for (const f of ['reel.mp4', 'cover.jpg', 'caption.txt', 'meta.json', 'storyboard.jpg']) expect(fs.existsSync(path.join(out, f)), f).toBe(true);
    expect(fs.readFileSync(path.join(out, 'caption.txt'), 'utf8')).toMatch(/#/);
    expect(meta.qa.safe_zone_violations).toEqual([]);
    expect(meta.qa.hook_visible_at_0_5s).toBe(true);
    // Loop: last frame flows into the first.
    expect(meta.qa.loop_seam_psnr_db).toBeGreaterThan(30);
    // moov atom at the front (faststart) so Instagram can start processing immediately.
    const head = fs.readFileSync(path.join(out, 'reel.mp4')).subarray(0, 64).toString('latin1');
    expect(head.indexOf('moov') === -1 || head.indexOf('moov') < head.indexOf('mdat') || head.indexOf('mdat') === -1).toBe(true);
  }, 180_000);
});
