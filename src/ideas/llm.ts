/** Minimal LLM interface so the idea pipeline can run against the Anthropic API or a test double. */
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env.ts';

export interface LLM {
  complete(req: { system: string; prompt: string; model?: string; maxTokens?: number; effort?: string }): Promise<string>;
}

export class AnthropicLLM implements LLM {
  private client: Anthropic;
  constructor(apiKey = env.anthropicApiKey) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  async complete(req: { system: string; prompt: string; model?: string; maxTokens?: number; effort?: string }): Promise<string> {
    const model = req.model ?? env.anthropicModel;
    const params = {
      model,
      max_tokens: req.maxTokens ?? 64000,
      system: req.system,
      thinking: { type: 'adaptive' as const },
      output_config: { effort: (req.effort ?? env.anthropicEffort) as 'high' },
      messages: [{ role: 'user' as const, content: req.prompt }],
    };
    // Streaming avoids HTTP timeouts on long generations. Server-side fallback re-runs a declined request
    // on Anthropic's recommended model instead of failing the batch (ANTHROPIC_FALLBACKS=off to disable).
    const stream = env.anthropicFallbacks
      ? this.client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as never)
      : this.client.messages.stream(params);
    const msg = (await stream.finalMessage()) as Anthropic.Message;
    if (msg.stop_reason === 'refusal') throw new Error('The model declined this request (stop_reason=refusal).');
    if (msg.stop_reason === 'max_tokens') throw new Error('The response hit max_tokens before finishing; lower --count.');
    return msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
}

/** Pull the first JSON object out of a model response (tolerates ```json fences and stray prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf('{');
    const end = c.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1));
    } catch {
      /* try next */
    }
  }
  throw new Error('No valid JSON object found in the response.');
}
