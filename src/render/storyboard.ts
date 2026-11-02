import fs from 'node:fs';
import path from 'node:path';
import type { Spec } from '../spec/schema.ts';
import { timelineFor } from '../spec/validate.ts';
import { buildHtml } from './html.ts';
import { launchBrowser } from './browser.ts';
import { openPage } from './renderer.ts';
import { runFfmpeg } from './ffmpeg.ts';
import { outDirFor } from '../paths.ts';
import type { Browser } from 'playwright';

/**
 * Fast visual check without encoding video: one frame per beat (when it is fully revealed) + the hook frame,
 * tiled into out/<id>/storyboard.jpg.
 */
export async function renderStoryboard(spec: Spec, opts: { browser?: Browser; outDir?: string } = {}): Promise<string> {
  const outDir = opts.outDir ?? outDirFor(spec.id);
  fs.mkdirSync(outDir, { recursive: true });
  const tl = timelineFor(spec);
  const html = path.join(outDir, 'index.html');
  fs.writeFileSync(html, buildHtml(spec, tl));
  const browser = opts.browser ?? (await launchBrowser());
  const tmp = fs.mkdtempSync(path.join(outDir, '.sb-'));
  try {
    const p = await openPage(browser, html);
    const times = [0.5, ...tl.beats.map((b) => Math.min(tl.duration - 0.04, b.at + b.dur * 0.85))].slice(0, 12);
    for (let i = 0; i < times.length; i++) {
      await p.page.evaluate((tt) => (window as any).__reel.seek(tt), times[i]);
      await p.page.screenshot({ path: path.join(tmp, `f${String(i).padStart(2, '0')}.png`) });
    }
    await p.page.close();
    const cols = Math.min(6, times.length);
    const rows = Math.ceil(times.length / cols);
    const out = path.join(outDir, 'storyboard.jpg');
    await runFfmpeg([
      '-y', '-hide_banner', '-loglevel', 'error', '-framerate', '1', '-i', path.join(tmp, 'f%02d.png'),
      '-vf', `scale=270:480,tile=${cols}x${rows}:padding=6:color=0x222222`, '-frames:v', '1', '-q:v', '3', out,
    ]);
    return out;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (!opts.browser) await browser.close();
  }
}
