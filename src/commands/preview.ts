import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { paths } from '../paths.ts';
import { loadSpecFile, SpecError, timelineFor } from '../spec/validate.ts';
import { buildHtml } from '../render/html.ts';
import { resolveSpecPath } from './render.ts';

/** mtimes of everything that affects the page, so the browser reloads on any edit. */
function version(specFile: string): string {
  const files = [specFile, path.join(paths.theme, 'theme.css'), path.join(paths.renderAssets, 'runtime.js'), path.join(paths.renderAssets, 'base.css')];
  for (const d of fs.readdirSync(paths.templates, { withFileTypes: true })) {
    if (d.isDirectory()) for (const f of fs.readdirSync(path.join(paths.templates, d.name))) files.push(path.join(paths.templates, d.name, f));
  }
  return files.map((f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0)).join('-');
}

function errorPage(title: string, lines: string[], v: string): string {
  return `<!doctype html><meta charset="utf-8"><title>spec error</title><body style="background:#111;color:#eee;font:16px ui-monospace,monospace;padding:30px">
<h2 style="color:#ff5468">${title}</h2><ul>${lines.map((l) => `<li>${l.replace(/</g, '&lt;')}</li>`).join('')}</ul><p style="opacity:.6">Fix the spec and save: this page reloads automatically.</p>
<script>let v=${JSON.stringify(v)};setInterval(async()=>{try{const n=await (await fetch('/__version')).text();if(n!==v)location.reload()}catch{}},800)</script>`;
}

export async function previewCmd(args: string[]) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { port: { type: 'string', default: '5173' }, 'no-open': { type: 'boolean' } } });
  if (!positionals[0]) throw new Error('Usage: npm run preview -- <id or specs/<id>.json>');
  const specFile = resolveSpecPath(positionals[0]);
  const server = http.createServer((req, res) => {
    const v = version(specFile);
    if (req.url === '/__version') {
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      return res.end(v);
    }
    let html: string;
    try {
      const spec = loadSpecFile(specFile);
      html = buildHtml(spec, timelineFor(spec), { preview: true, version: v });
    } catch (e) {
      html = errorPage(e instanceof SpecError ? e.message : 'Error', e instanceof SpecError ? e.issues : [(e as Error).message], v);
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  });
  const port = Number(values.port);
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${port}/`;
  console.log(`Previewing ${path.relative(process.cwd(), specFile)} at ${url}\nEdit the spec, templates or theme and the page reloads. Ctrl+C to stop.`);
  if (!values['no-open']) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(opener, [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }
}
