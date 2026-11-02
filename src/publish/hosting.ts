/**
 * Getting the MP4 to a public URL Instagram can fetch.
 *   r2 / s3   upload with AWS Signature V4 (Cloudflare R2, AWS S3, MinIO, …) → PUBLIC_BASE_URL/<key>
 *   static    you sync out/ to any web host yourself → PUBLIC_BASE_URL/<id>/reel.mp4
 *   resumable no hosting: direct upload to Instagram (Facebook Login for Business apps only)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { env } from '../env.ts';
import type { Fetch } from './instagram.ts';

const sha256 = (d: string | Buffer) => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (key: Buffer | string, d: string) => crypto.createHmac('sha256', key).update(d).digest();

export function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request');
}

const encodeKey = (key: string) => key.split('/').map((p) => encodeURIComponent(p).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');

/** Build a SigV4-signed PUT request for an S3-compatible bucket (path-style URL). */
export function signPut(o: {
  endpoint: string;
  bucket: string;
  key: string;
  body: Buffer;
  contentType: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  now?: Date;
}): { url: string; headers: Record<string, string> } {
  const now = o.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const u = new URL(o.endpoint);
  const host = u.host;
  const canonicalUri = `/${o.bucket}/${encodeKey(o.key)}`;
  const payloadHash = sha256(o.body);
  const headers: Record<string, string> = {
    'content-type': o.contentType,
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const signed = Object.keys(headers).sort();
  const canonical = ['PUT', canonicalUri, '', ...signed.map((h) => `${h}:${headers[h]}`), '', signed.join(';'), payloadHash].join('\n');
  const scope = `${date}/${o.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const sig = crypto.createHmac('sha256', signingKey(o.secretAccessKey, date, o.region, 's3')).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${o.accessKeyId}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${sig}`;
  return { url: `${u.protocol}//${host}${canonicalUri}`, headers };
}

export function s3Endpoint(): string {
  if (env.s3Endpoint) return env.s3Endpoint;
  if (env.videoHost === 'r2' && env.r2AccountId) return `https://${env.r2AccountId}.r2.cloudflarestorage.com`;
  return `https://s3.${env.s3Region === 'auto' ? 'us-east-1' : env.s3Region}.amazonaws.com`;
}

export function publicUrl(key: string): string {
  if (!env.publicBaseUrl) throw new Error('PUBLIC_BASE_URL is not set (the public URL where uploaded files can be fetched).');
  return `${env.publicBaseUrl.replace(/\/+$/, '')}/${encodeKey(key)}`;
}

/** Upload a file and return its public URL. */
export async function hostFile(file: string, key: string, contentType: string, fetchImpl: Fetch = fetch): Promise<string> {
  if (env.videoHost === 'static') return publicUrl(key);
  if (env.videoHost === 'resumable') throw new Error('hostFile is not used with VIDEO_HOST=resumable');
  for (const [k, v] of Object.entries({ S3_BUCKET: env.s3Bucket, S3_ACCESS_KEY_ID: env.s3AccessKeyId, S3_SECRET_ACCESS_KEY: env.s3SecretAccessKey })) {
    if (!v) throw new Error(`${k} is not set (needed for VIDEO_HOST=${env.videoHost}). See SETUP-INSTAGRAM.md.`);
  }
  const req = signPut({
    endpoint: s3Endpoint(),
    bucket: env.s3Bucket,
    key,
    body: fs.readFileSync(file),
    contentType,
    region: env.s3Region,
    accessKeyId: env.s3AccessKeyId,
    secretAccessKey: env.s3SecretAccessKey,
  });
  const res = await fetchImpl(req.url, { method: 'PUT', headers: req.headers, body: fs.readFileSync(file) });
  if (!res.ok) throw new Error(`Upload to ${env.videoHost} failed: HTTP ${res.status} ${await res.text()}`);
  return publicUrl(key);
}
