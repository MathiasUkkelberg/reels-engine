import fs from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { env } from '../env.ts';

/** Places a Chromium/Chrome binary usually lives when Playwright's own download isn't available. */
const CANDIDATES = [
  '/opt/pw-browsers/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
];

const ARGS = ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars'];

/**
 * Launch headless Chromium.
 * Order: CHROMIUM_PATH → Playwright's bundled browser (`npx playwright install chromium`) → system Chrome/Chromium.
 */
export async function launchBrowser(): Promise<Browser> {
  if (env.chromiumPath) {
    return chromium.launch({ executablePath: env.chromiumPath, args: [...ARGS, '--no-sandbox'] });
  }
  try {
    return await chromium.launch({ args: ARGS });
  } catch (err) {
    for (const p of CANDIDATES) {
      if (fs.existsSync(p)) {
        try {
          return await chromium.launch({ executablePath: p, args: [...ARGS, '--no-sandbox'] });
        } catch {
          /* try next */
        }
      }
    }
    throw new Error(
      `Could not launch Chromium.\n  Fix: run "npx playwright install chromium", or set CHROMIUM_PATH in .env to a Chrome/Chromium binary.\n  Original error: ${(err as Error).message.split('\n')[0]}`,
    );
  }
}
