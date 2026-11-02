import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { paths, outDirFor } from '../paths.ts';
import { loadSpecFile, SpecError, specWarnings } from '../spec/validate.ts';
import type { Spec } from '../spec/schema.ts';
import { renderSpec, isRendered } from '../render/renderer.ts';
import { renderStoryboard } from '../render/storyboard.ts';
import { launchBrowser } from '../render/browser.ts';
import { getDb, markRendered, upsertReel } from '../db/index.ts';

/** Resolve "specs/x.json", "x.json" or a bare id to a spec file. */
export function resolveSpecPath(arg: string): string {
  const candidates = [arg, path.join(paths.specs, arg), path.join(paths.specs, `${arg}.json`), path.join(paths.examples, 'specs', `${arg}.json`)];
  const hit = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  if (!hit) throw new Error(`Spec not found: ${arg} (looked in ./, specs/ and examples/specs/)`);
  return hit;
}

function report(spec: Spec, meta: Awaited<ReturnType<typeof renderSpec>>, outDir: string) {
  const v = meta.video.video;
  console.log(`✓ ${spec.id} → ${path.relative(process.cwd(), outDir)}/reel.mp4  (${v?.width}x${v?.height} ${v?.fps}fps ${meta.duration_s}s, ${(meta.video.size_bytes / 1e6).toFixed(1)} MB, rendered in ${meta.render_seconds}s)`);
  if (meta.qa.loop_seam_psnr_db !== null) console.log(`  loop seam PSNR: ${meta.qa.loop_seam_psnr_db.toFixed(1)} dB (≥ 30 dB is seamless)`);
  for (const w of meta.qa.warnings) console.log(`  ⚠ ${w}`);
}

export async function renderCmd(args: string[]) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { workers: { type: 'string' }, out: { type: 'string' } } });
  if (!positionals.length) throw new Error('Usage: npm run render -- specs/<id>.json');
  const browser = await launchBrowser();
  try {
    for (const p of positionals) {
      const spec = loadSpecFile(resolveSpecPath(p));
      const outDir = values.out ? path.resolve(values.out, spec.id) : outDirFor(spec.id);
      console.log(`Rendering ${spec.id} (${spec.template}, ${spec.duration_s}s${spec.loop ? ', loop' : ''})…`);
      const meta = await renderSpec(spec, { browser, outDir, workers: values.workers ? Number(values.workers) : undefined });
      report(spec, meta, outDir);
      if (!values.out) {
        const db = getDb();
        upsertReel(db, spec);
        markRendered(db, spec.id);
      }
    }
  } finally {
    await browser.close();
  }
}

/** Render every spec in specs/ that has no up-to-date render in out/. */
export async function renderBatchCmd(args: string[]) {
  const { values } = parseArgs({ args, options: { force: { type: 'boolean' }, dir: { type: 'string' } } });
  const dir = values.dir ? path.resolve(values.dir) : paths.specs;
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  const db = getDb();
  const todo: Spec[] = [];
  let invalid = 0;
  for (const f of files) {
    try {
      const spec = loadSpecFile(path.join(dir, f));
      const row = db.prepare('SELECT status FROM reels WHERE id = ?').get(spec.id) as { status: string } | undefined;
      if (row?.status === 'posted' || row?.status === 'archived') continue;
      if (values.force || !isRendered(spec)) todo.push(spec);
    } catch (e) {
      invalid++;
      console.error(`✗ ${f}: ${e instanceof SpecError ? e.issues.join('; ') : (e as Error).message}`);
    }
  }
  if (!todo.length) {
    console.log(`Nothing to render (${files.length} specs, all up to date${invalid ? `, ${invalid} invalid` : ''}).`);
    return;
  }
  console.log(`Rendering ${todo.length} pending spec(s)…`);
  const browser = await launchBrowser();
  let ok = 0;
  try {
    for (const spec of todo) {
      try {
        const meta = await renderSpec(spec, { browser });
        report(spec, meta, outDirFor(spec.id));
        upsertReel(db, spec);
        markRendered(db, spec.id);
        ok++;
      } catch (e) {
        console.error(`✗ ${spec.id}: ${(e as Error).message}`);
        db.prepare(`UPDATE reels SET status = 'failed' WHERE id = ?`).run(spec.id);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`Done: ${ok}/${todo.length} rendered.`);
  if (ok < todo.length) process.exitCode = 1;
}

export async function storyboardCmd(args: string[]) {
  if (!args.length) throw new Error('Usage: npm run storyboard -- <spec>');
  const browser = await launchBrowser();
  try {
    for (const a of args) {
      const spec = loadSpecFile(resolveSpecPath(a));
      console.log(`✓ ${await renderStoryboard(spec, { browser })}`);
    }
  } finally {
    await browser.close();
  }
}

export async function validateCmd(args: string[]) {
  const files = args.length
    ? args.map(resolveSpecPath)
    : [paths.specs, path.join(paths.examples, 'specs')].filter((d) => fs.existsSync(d)).flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => path.join(d, f)));
  let bad = 0;
  for (const f of files) {
    try {
      const spec = loadSpecFile(f);
      const w = specWarnings(spec);
      console.log(`✓ ${path.relative(process.cwd(), f)}${w.length ? `\n${w.map((x) => `   ⚠ ${x}`).join('\n')}` : ''}`);
    } catch (e) {
      bad++;
      console.log(`✗ ${path.relative(process.cwd(), f)}`);
      for (const i of e instanceof SpecError ? e.issues : [(e as Error).message]) console.log(`   • ${i}`);
    }
  }
  console.log(`${files.length - bad}/${files.length} valid`);
  if (bad) process.exitCode = 1;
}

/** Render examples/specs/*.json into examples/<id>/ (committed showcase). */
export async function examplesCmd(args: string[]) {
  const dir = path.join(paths.examples, 'specs');
  const only = new Set(args);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && (!only.size || only.has(f.replace(/\.json$/, ''))));
  const browser = await launchBrowser();
  try {
    for (const f of files) {
      const spec = loadSpecFile(path.join(dir, f));
      const outDir = path.join(paths.examples, spec.id);
      const meta = await renderSpec(spec, { browser, outDir, crf: 22 });
      fs.rmSync(path.join(outDir, 'index.html'), { force: true });
      report(spec, meta, outDir);
    }
  } finally {
    await browser.close();
  }
}
