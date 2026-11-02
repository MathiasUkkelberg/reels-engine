#!/usr/bin/env node
/** Single entry point: `tsx src/cli.ts <command> [...args]` (wired to npm scripts in package.json). */
import { SpecError } from './spec/validate.ts';
import { closeDb } from './db/index.ts';

const COMMANDS: Record<string, () => Promise<{ run(args: string[]): Promise<void> }>> = {
  render: () => import('./commands/render.ts').then((m) => ({ run: m.renderCmd })),
  'render:batch': () => import('./commands/render.ts').then((m) => ({ run: m.renderBatchCmd })),
  storyboard: () => import('./commands/render.ts').then((m) => ({ run: m.storyboardCmd })),
  examples: () => import('./commands/render.ts').then((m) => ({ run: m.examplesCmd })),
  validate: () => import('./commands/render.ts').then((m) => ({ run: m.validateCmd })),
  preview: () => import('./commands/preview.ts').then((m) => ({ run: m.previewCmd })),
  ideas: () => import('./commands/ideas.ts').then((m) => ({ run: m.ideasCmd })),
  'ideas:prompt': () => import('./commands/ideas.ts').then((m) => ({ run: m.ideasPromptCmd })),
  'ideas:import': () => import('./commands/ideas.ts').then((m) => ({ run: m.ideasImportCmd })),
  'mark-posted': () => import('./commands/posting.ts').then((m) => ({ run: m.markPostedCmd })),
  schedule: () => import('./commands/posting.ts').then((m) => ({ run: m.scheduleCmd })),
  publish: () => import('./commands/posting.ts').then((m) => ({ run: m.publishCmd })),
  sync: () => import('./commands/metrics.ts').then((m) => ({ run: m.syncCmd })),
  'import:csv': () => import('./commands/metrics.ts').then((m) => ({ run: m.importCsvCmd })),
  learn: () => import('./commands/metrics.ts').then((m) => ({ run: m.learnCmd })),
  status: () => import('./commands/metrics.ts').then((m) => ({ run: m.statusCmd })),
  daily: () => import('./commands/daily.ts').then((m) => ({ run: m.dailyCmd })),
  'demo:learn': () => import('./commands/demo.ts').then((m) => ({ run: m.demoLearnCmd })),
};

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || !COMMANDS[cmd]) {
    console.log(`Usage: npm run <command> -- [args]\n\nCommands:\n  ${Object.keys(COMMANDS).join('\n  ')}\n\nSee README.md for details.`);
    process.exit(cmd ? 1 : 0);
  }
  const mod = await COMMANDS[cmd]();
  try {
    await mod.run(args);
  } finally {
    closeDb();
  }
}

main().catch((err) => {
  if (err instanceof SpecError) {
    console.error(`\n✗ ${err.message}:`);
    for (const i of err.issues) console.error(`   • ${i}`);
  } else {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
    if (process.env.DEBUG) console.error(err);
  }
  process.exit(1);
});
