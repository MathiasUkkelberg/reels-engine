import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (one level above src/). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const paths = {
  root: ROOT,
  specs: path.join(ROOT, 'specs'),
  out: path.join(ROOT, 'out'),
  examples: path.join(ROOT, 'examples'),
  rejected: path.join(ROOT, 'rejected'),
  reports: path.join(ROOT, 'reports'),
  data: path.join(ROOT, 'data'),
  db: process.env.REELS_DB_PATH ? path.resolve(process.env.REELS_DB_PATH) : path.join(ROOT, 'data', 'reels.db'),
  insights: path.join(ROOT, 'data', 'insights.json'),
  playbook: path.join(ROOT, 'PLAYBOOK.md'),
  templates: path.join(ROOT, 'src', 'templates'),
  theme: path.join(ROOT, 'src', 'theme'),
  renderAssets: path.join(ROOT, 'src', 'render'),
};

export function outDirFor(id: string): string {
  return path.join(paths.out, id);
}
