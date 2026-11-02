import { loadSpecFile } from './src/spec/validate.ts';
import { renderStoryboard } from './src/render/storyboard.ts';
import { launchBrowser } from './src/render/browser.ts';
const browser = await launchBrowser();
for (const f of process.argv.slice(2)) {
  try { const spec = loadSpecFile(f); console.log(await renderStoryboard(spec, { browser })); }
  catch (e: any) { console.error(f, e.message, e.issues ?? ''); }
}
await browser.close();
