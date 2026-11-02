import { spawn, spawnSync } from 'node:child_process';

export function ffmpegBin(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}
export function ffprobeBin(): string {
  return process.env.FFPROBE_PATH || 'ffprobe';
}

export function assertFfmpeg(): void {
  const r = spawnSync(ffmpegBin(), ['-version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    throw new Error('ffmpeg not found. Install it with "brew install ffmpeg" (macOS) or set FFMPEG_PATH.');
  }
}

export function runFfmpeg(args: string[]): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegBin(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve({ stderr }) : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`))));
  });
}

/** H.264 + silent AAC settings that match Instagram's Reels spec (closed GOP, 4:2:0, moov atom first, no edit lists). */
export function encoderArgs(opts: { fps: number; duration: number; crf: number; frameFormat: 'png' | 'jpeg'; out: string }): string[] {
  return [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'image2pipe',
    '-c:v', opts.frameFormat === 'png' ? 'png' : 'mjpeg',
    '-framerate', String(opts.fps),
    '-i', '-',
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', String(opts.crf),
    '-maxrate', '20M',
    '-bufsize', '40M',
    '-pix_fmt', 'yuv420p',
    '-profile:v', 'high',
    '-level:v', '4.2',
    '-r', String(opts.fps),
    '-g', String(opts.fps * 2),
    '-keyint_min', String(opts.fps),
    '-sc_threshold', '0',
    '-flags', '+cgop',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-colorspace', 'bt709',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '48000',
    '-ac', '2',
    '-t', opts.duration.toFixed(3),
    '-use_editlist', '0',
    '-movflags', '+faststart',
    opts.out,
  ];
}

export interface ProbeResult {
  video?: { codec: string; width: number; height: number; fps: number; pix_fmt: string; profile?: string };
  audio?: { codec: string; sample_rate: number; channels: number };
  duration: number;
  size_bytes: number;
}

export function probe(file: string): ProbeResult {
  const r = spawnSync(ffprobeBin(), ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], {
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s: any) => s.codec_type === 'video');
  const a = j.streams.find((s: any) => s.codec_type === 'audio');
  const [num, den] = String(v?.r_frame_rate ?? '0/1').split('/').map(Number);
  return {
    video: v && { codec: v.codec_name, width: v.width, height: v.height, fps: num / (den || 1), pix_fmt: v.pix_fmt, profile: v.profile },
    audio: a && { codec: a.codec_name, sample_rate: Number(a.sample_rate), channels: a.channels },
    duration: Number(j.format.duration),
    size_bytes: Number(j.format.size),
  };
}

/** PSNR (dB) between the first and last frame: high means the loop point is seamless. */
export async function loopSeamPsnr(file: string, frames: number): Promise<number | null> {
  try {
    const { stderr } = await runFfmpeg([
      '-hide_banner',
      '-loglevel', 'info',
      '-i', file,
      '-i', file,
      '-filter_complex',
      `[0:v]trim=start_frame=0:end_frame=1,setpts=PTS-STARTPTS[a];[1:v]trim=start_frame=${frames - 1}:end_frame=${frames},setpts=PTS-STARTPTS[b];[a][b]psnr`,
      '-f', 'null',
      '-',
    ]);
    const m = stderr.match(/average:([0-9.]+|inf)/);
    if (!m) return null;
    return m[1] === 'inf' ? 99 : Number(m[1]);
  } catch {
    return null;
  }
}
