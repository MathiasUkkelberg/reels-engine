import { loadSpecFile } from './src/spec/validate.ts';
import { renderSpec } from './src/render/renderer.ts';
const spec = loadSpecFile(process.argv[2]);
const meta = await renderSpec(spec, { log: console.log });
console.log(JSON.stringify({ secs: meta.render_seconds, video: meta.video, qa: meta.qa }, null, 2));
