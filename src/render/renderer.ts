import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import type { Browser, Page, CDPSession } from 'playwright';
import { config } from '../../reels.config.ts';
import type { Spec } from '../spec/schema.ts';
import { specHash, specWarnings, timelineFor } from '../spec/validate.ts';
import { captionFile } from '../spec/caption.ts';
import { buildHtml } from './html.ts';
import { launchBrowser } from './browser.ts';
import { assertFfmpeg, encoderArgs, ffmpegBin, loopSeamPsnr, probe, runFfmpeg, type ProbeResult } from './ffmpeg.ts';
import { outDirFor } from '../paths.ts';

export const ENGINE_VERSION = '1.0.0';

export interface QaReport {
  safe_zone_violations: Array<{ t: number; text: string; where: string }>;
  min_font_px: number | null;
  hook_visible_at_0_5s: boolean;
  loop_seam_psnr_db: number | null;
  warnings: string[];
}

export interface RenderMeta {
  id: string;
  spec_hash: string;
  engine_version: string;
  template: string;
  rendered_at: string;
  render_seconds: number;
  duration_s: number;
  fps: number;
  frames: number;
  loop: boolean;
  timeline: ReturnType<typeof timelineFor>;
  features: Spec['features'];
  experiment: Spec['experiment'];
  caption: { selected: number; variants: Spec['caption']['variants'] };
  hook: string;
  files: { video: string; cover: string; caption: string; storyboard: string; html: string };
  video: ProbeResult;
  qa: QaReport;
}

export interface RenderOptions {
  outDir?: string;
  browser?: Browser;
  workers?: number;
  log?: (msg: string) => void;
  /** Skip storyboard + loop check (used by quick tests). */
  fast?: boolean;
  /** Override config.render.crf (examples use a slightly higher value to keep the repo small). */
  crf?: number;
}

function autoWorkers(): number {
  if (config.render.workers > 0) return config.render.workers;
  return Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));
}

export async function openPage(browser: Browser, file: string): Promise<{ page: Page; cdp: CDPSession }> {
  const page = await browser.newPage({ viewport: { width: config.render.width, height: config.render.height }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() => (window as any).__reel?.ready || (window as any).__bootError, null, { timeout: 30_000 });
  const bootError = await page.evaluate(() => (window as any).__bootError);
  if (bootError) throw new Error(`Template failed to build in the browser:\n${bootError}`);
  const cdp = await page.context().newCDPSession(page);
  return { page, cdp };
}

async function capture(p: { page: Page; cdp: CDPSession }, t: number, format: 'png' | 'jpeg'): Promise<Buffer> {
  await p.page.evaluate((tt) => (window as any).__reel.seek(tt), t);
  const res = await p.cdp.send('Page.captureScreenshot', {
    format,
    ...(format === 'jpeg' ? { quality: 95 } : {}),
    optimizeForSpeed: true,
  });
  return Buffer.from(res.data, 'base64');
}

/** Render one spec to out/<id>/ (reel.mp4, cover.jpg, caption.txt, meta.json, storyboard.jpg, index.html). */
export async function renderSpec(spec: Spec, opts: RenderOptions = {}): Promise<RenderMeta> {
  assertFfmpeg();
  const log = opts.log ?? (() => {});
  const started = Date.now();
  const outDir = opts.outDir ?? outDirFor(spec.id);
  fs.mkdirSync(outDir, { recursive: true });

  const tl = timelineFor(spec);
  const htmlFile = path.join(outDir, 'index.html');
  fs.writeFileSync(htmlFile, buildHtml(spec, tl));

  const ownBrowser = !opts.browser;
  const browser = opts.browser ?? (await launchBrowser());
  const workers = Math.max(1, opts.workers ?? autoWorkers());
  const pages: Array<{ page: Page; cdp: CDPSession }> = [];
  try {
    for (let i = 0; i < workers; i++) pages.push(await openPage(browser, htmlFile));

    // --- QA pass (safe zones, readability, hook timing) ---
    const qa = await runQa(pages[0].page, spec, tl);

    // --- frames → ffmpeg ---
    const videoFile = path.join(outDir, 'reel.mp4');
    const format = config.render.frameFormat;
    const ff = spawn(
      ffmpegBin(),
      encoderArgs({ fps: tl.fps, duration: tl.duration, crf: opts.crf ?? config.render.crf, frameFormat: format, out: videoFile }),
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );
    let ffErr = '';
    ff.stderr.on('data', (d) => (ffErr += d.toString()));
    const ffDone = new Promise<void>((resolve, reject) => {
      ff.on('error', reject);
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${ffErr.slice(-1000)}`))));
    });
    const write = (buf: Buffer) =>
      new Promise<void>((resolve, reject) => {
        if (ff.stdin.destroyed) return reject(new Error(`ffmpeg closed its input: ${ffErr.slice(-500)}`));
        ff.stdin.write(buf, (err) => (err ? reject(err) : resolve()));
      });

    let lastPct = -1;
    for (let base = 0; base < tl.frames; base += pages.length) {
      const batch = await Promise.all(
        pages.map((p, k) => (base + k < tl.frames ? capture(p, (base + k) / tl.fps, format) : Promise.resolve(null))),
      );
      for (const buf of batch) if (buf) await write(buf);
      const pct = Math.floor(((base + pages.length) / tl.frames) * 10) * 10;
      if (pct !== lastPct && pct <= 100) {
        lastPct = pct;
        log(`  ${spec.id}: ${Math.min(100, pct)}%`);
      }
    }
    ff.stdin.end();
    await ffDone;

    // --- cover ---
    const coverFile = path.join(outDir, 'cover.jpg');
    await pages[0].page.evaluate((tt) => (window as any).__reel.seek(tt), tl.coverAt);
    await pages[0].page.screenshot({ path: coverFile, type: 'jpeg', quality: 92 });

    // --- storyboard (8 frames) + loop seam check ---
    const storyFile = path.join(outDir, 'storyboard.jpg');
    if (!opts.fast) {
      const step = Math.max(1, Math.floor(tl.frames / 8));
      await runFfmpeg([
        '-y', '-hide_banner', '-loglevel', 'error', '-i', videoFile,
        '-vf', `select='not(mod(n\\,${step}))',scale=270:480,tile=4x2:padding=6:color=0x222222`,
        '-frames:v', '1', '-q:v', '3', storyFile,
      ]);
      if (spec.loop) qa.loop_seam_psnr_db = await loopSeamPsnr(videoFile, tl.frames);
    }

    // --- caption + meta ---
    const captionPath = path.join(outDir, 'caption.txt');
    fs.writeFileSync(captionPath, captionFile(spec));

    const meta: RenderMeta = {
      id: spec.id,
      spec_hash: specHash(spec),
      engine_version: ENGINE_VERSION,
      template: spec.template,
      rendered_at: new Date().toISOString(),
      render_seconds: Math.round((Date.now() - started) / 100) / 10,
      duration_s: tl.duration,
      fps: tl.fps,
      frames: tl.frames,
      loop: spec.loop,
      timeline: tl,
      features: spec.features,
      experiment: spec.experiment,
      caption: { selected: spec.caption.selected, variants: spec.caption.variants },
      hook: spec.hook,
      files: { video: 'reel.mp4', cover: 'cover.jpg', caption: 'caption.txt', storyboard: 'storyboard.jpg', html: 'index.html' },
      video: probe(videoFile),
      qa,
    };
    fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
    return meta;
  } finally {
    for (const p of pages) await p.page.close().catch(() => {});
    if (ownBrowser) await browser.close();
  }
}

async function runQa(page: Page, spec: Spec, tl: ReturnType<typeof timelineFor>): Promise<QaReport> {
  const safe = config.safeZone;
  const times = new Set<number>([0.5, tl.coverAt]);
  for (const b of tl.beats) times.add(Math.min(tl.duration - 0.05, b.at + b.dur * 0.7));
  const violations: QaReport['safe_zone_violations'] = [];
  let minFont: number | null = null;
  let hookVisible = false;
  for (const t of [...times].sort((a, b) => a - b)) {
    const r = await page.evaluate(
      ({ tt, s }) => {
        (window as any).__reel.seek(tt);
        return (window as any).__reel.qa(s);
      },
      { tt: t, s: safe },
    );
    if (t === 0.5) hookVisible = r.hookOpacity >= 0.95;
    for (const v of r.violations) {
      if (!violations.some((x) => x.text === v.text)) violations.push({ t: Math.round(t * 100) / 100, ...v });
    }
    if (r.minFontPx !== null) minFont = minFont === null ? r.minFontPx : Math.min(minFont, r.minFontPx);
  }
  const warnings = specWarnings(spec);
  if (!hookVisible) warnings.push('hook is not fully visible at 0.5s');
  if (minFont !== null && minFont < 30) warnings.push(`smallest on-screen text is ${minFont}px; aim for ≥ 32px so it reads on a phone`);
  for (const v of violations) warnings.push(`text "${v.text}" crosses a safe zone (${v.where}) at ${v.t}s`);
  return { safe_zone_violations: violations, min_font_px: minFont, hook_visible_at_0_5s: hookVisible, loop_seam_psnr_db: null, warnings };
}

/** True when out/<id>/ already holds a render of exactly this spec. */
export function isRendered(spec: Spec, outDir = outDirFor(spec.id)): boolean {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'meta.json'), 'utf8')) as RenderMeta;
    return meta.spec_hash === specHash(spec) && fs.existsSync(path.join(outDir, 'reel.mp4'));
  } catch {
    return false;
  }
}
