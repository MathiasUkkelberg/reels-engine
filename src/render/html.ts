import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { paths } from '../paths.ts';
import type { Spec } from '../spec/schema.ts';
import type { Timeline } from '../spec/timing.ts';
import { config } from '../../reels.config.ts';

const require = createRequire(import.meta.url);

const FONT_FILES: Array<{ family: string; pkg: string; file: string; weight: number }> = [
  { family: 'Inter', pkg: '@fontsource/inter', file: 'inter-latin-400-normal.woff2', weight: 400 },
  { family: 'Inter', pkg: '@fontsource/inter', file: 'inter-latin-600-normal.woff2', weight: 600 },
  { family: 'Inter', pkg: '@fontsource/inter', file: 'inter-latin-800-normal.woff2', weight: 800 },
  { family: 'Inter', pkg: '@fontsource/inter', file: 'inter-latin-900-normal.woff2', weight: 900 },
  { family: 'JetBrains Mono', pkg: '@fontsource/jetbrains-mono', file: 'jetbrains-mono-latin-400-normal.woff2', weight: 400 },
  { family: 'JetBrains Mono', pkg: '@fontsource/jetbrains-mono', file: 'jetbrains-mono-latin-500-normal.woff2', weight: 500 },
  { family: 'JetBrains Mono', pkg: '@fontsource/jetbrains-mono', file: 'jetbrains-mono-latin-800-normal.woff2', weight: 800 },
];

let fontCss: string | null = null;
/** @font-face rules with the font files inlined, so renders are identical on every machine. */
function fonts(): string {
  if (fontCss) return fontCss;
  fontCss = FONT_FILES.map((f) => {
    const pkgDir = path.dirname(require.resolve(`${f.pkg}/package.json`));
    const b64 = fs.readFileSync(path.join(pkgDir, 'files', f.file)).toString('base64');
    return `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
  }).join('\n');
  return fontCss;
}

const read = (p: string) => fs.readFileSync(p, 'utf8');

/** Safely embed JSON inside a <script> tag. */
function jsonForScript(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export interface HtmlOptions {
  preview?: boolean;
  version?: string;
}

export function buildHtml(spec: Spec, timeline: Timeline, opts: HtmlOptions = {}): string {
  const tdir = path.join(paths.templates, spec.template);
  const templateJs = read(path.join(tdir, 'template.js'));
  const templateCssPath = path.join(tdir, 'style.css');
  const templateCss = fs.existsSync(templateCssPath) ? read(templateCssPath) : '';
  const s = config.safeZone;

  const stage = `
<div id="stage">
  <div id="bg"></div>
  <div id="hook"></div>
  <div id="content" class="tpl-${spec.template}"></div>
  <div id="fx"></div>
  <div id="wm"><span class="cur"></span></div>
  ${
    opts.preview
      ? `<div id="safe-overlay">
    <div style="left:0;top:0;width:1080px;height:${s.top}px"></div>
    <div style="left:0;bottom:0;width:1080px;height:${s.bottom}px"></div>
    <div style="right:0;top:${s.top}px;width:${s.right}px;height:${1920 - s.top - s.bottom}px"></div>
  </div>`
      : ''
  }
</div>`;

  const body = opts.preview
    ? `<div id="viewport" style="margin:10px auto 0;overflow:hidden"><div id="wrap" style="transform-origin:0 0;width:1080px;height:1920px">${stage}</div></div>
<div id="bar">
  <button class="play">❚❚ pause</button>
  <input type="range" min="0" step="0.001" value="0">
  <span class="time"></span>
  <button class="safe">safe zones (s)</button>
  <span class="hint">space = play/pause · ←/→ = frame step · edits to the spec reload automatically</span>
</div>`
    : stage;

  const previewCss = opts.preview
    ? `body{background:#111;color:#ccc;font:14px system-ui}#bar{position:fixed;left:0;right:0;bottom:0;display:flex;gap:12px;align-items:center;padding:10px 16px;background:#1b1b1b}#bar input{flex:1}#bar button{background:#2b2b2b;color:#eee;border:1px solid #444;border-radius:6px;padding:6px 10px;cursor:pointer}#bar .hint{opacity:.6;font-size:12px}`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1080">
<title>${spec.id}</title>
<style>${fonts()}</style>
<style>${read(path.join(paths.theme, 'theme.css'))}</style>
<style>${read(path.join(paths.renderAssets, 'base.css'))}</style>
<style>${templateCss}</style>
<style>${previewCss}</style>
</head>
<body>
${body}
<script>window.__SPEC__=${jsonForScript(spec)};window.__TIMELINE__=${jsonForScript(timeline)};window.__PREVIEW__=${opts.preview ? 'true' : 'false'};window.__VERSION__=${jsonForScript(opts.version ?? '')};</script>
<script>${read(path.join(paths.renderAssets, 'runtime.js'))}</script>
<script>${templateJs}</script>
<script>Reel.boot().catch(function(e){document.title='BOOT_ERROR';window.__bootError=String(e&&e.stack||e);console.error(e);});</script>
</body>
</html>`;
}
