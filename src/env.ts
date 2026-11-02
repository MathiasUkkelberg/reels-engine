import 'dotenv/config';
import { config } from '../reels.config.ts';

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

/** Typed view of environment variables (see .env.example). */
export const env = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  anthropicCriticModel: process.env.ANTHROPIC_CRITIC_MODEL || process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  anthropicEffort: (process.env.ANTHROPIC_EFFORT || 'high') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
  /** Server-side refusal fallback ("default" routing). Set ANTHROPIC_FALLBACKS=off for models/platforms without it. */
  anthropicFallbacks: (process.env.ANTHROPIC_FALLBACKS || 'default') !== 'off',

  publishingEnabled: bool(process.env.PUBLISHING_ENABLED, config.publishing.enabled),
  igUserId: process.env.IG_USER_ID ?? '',
  igAccessToken: process.env.IG_ACCESS_TOKEN ?? '',
  /** graph.instagram.com (Instagram Login, default) or graph.facebook.com (Facebook Login for Business). */
  igApiHost: process.env.IG_API_HOST || 'graph.instagram.com',
  igGraphVersion: process.env.IG_GRAPH_VERSION || config.publishing.graphVersion,

  /** How the MP4 reaches Instagram: r2 | s3 | static | resumable */
  videoHost: (process.env.VIDEO_HOST || 'r2') as 'r2' | 's3' | 'static' | 'resumable',
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? '',
  r2AccountId: process.env.R2_ACCOUNT_ID ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Region: process.env.S3_REGION || 'auto',
  s3Bucket: process.env.S3_BUCKET ?? '',
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',

  chromiumPath: process.env.CHROMIUM_PATH ?? '',
};

export function igConfigured(): boolean {
  return Boolean(env.igUserId && env.igAccessToken);
}
