import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { config } from '../../reels.config.ts';
import { env } from '../env.ts';
import { paths } from '../paths.ts';
import { buildPastePrompt, generateIdeas, importIdeas, type ProcessResult } from '../ideas/generate.ts';
import { AnthropicLLM } from '../ideas/llm.ts';

export function printResult(r: ProcessResult) {
  for (const a of r.accepted) {
    const arm = a.spec.experiment.arm === 'explore' ? `explore: ${a.spec.experiment.hypothesis ?? ''}` : 'exploit';
    console.log(`  ✓ ${a.spec.id}  [${a.spec.template}] "${a.spec.hook.replace(/\*/g, '')}"  critic ${a.score?.toFixed(1) ?? 'n/a'}  (${arm})`);
  }
  for (const x of r.rejected) console.log(`  ✗ ${x.id}: ${x.reason}`);
  console.log(`\nAccepted ${r.accepted.length} → specs/   Rejected ${r.rejected.length} → rejected/${new Date().toISOString().slice(0, 10)}/`);
}

export async function ideasCmd(args: string[]) {
  const { values } = parseArgs({ args, options: { count: { type: 'string' }, 'dry-run': { type: 'boolean' } } });
  const count = Number(values.count ?? config.ideas.defaultCount);
  if (!env.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set (see .env.example).\n  No-API mode: npm run -s ideas:prompt | pbcopy  →  paste into Claude  →  save the JSON answer  →  npm run ideas:import -- answer.json');
  }
  const res = await generateIdeas({ count, llm: new AnthropicLLM(), dryRun: values['dry-run'], log: (s) => console.log(s) });
  printResult(res);
}

export async function ideasPromptCmd(args: string[]) {
  const { values } = parseArgs({ args, options: { count: { type: 'string' } } });
  const count = Number(values.count ?? config.ideas.defaultCount);
  const prompt = buildPastePrompt({ count });
  const file = path.join(paths.data, 'ideas-prompt.md');
  fs.writeFileSync(file, prompt);
  process.stdout.write(prompt + '\n');
  console.error(`\n(saved to ${path.relative(process.cwd(), file)}; paste it into Claude, save the JSON reply, then: npm run ideas:import -- reply.json)`);
}

export async function ideasImportCmd(args: string[]) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { keep: { type: 'string' }, 'dry-run': { type: 'boolean' } } });
  const text = positionals[0] ? fs.readFileSync(positionals[0], 'utf8') : fs.readFileSync(0, 'utf8');
  const res = await importIdeas({ text, keep: values.keep ? Number(values.keep) : undefined, dryRun: values['dry-run'] });
  printResult(res);
}
