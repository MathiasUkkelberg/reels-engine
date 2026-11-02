/** reports/dashboard.html: a self-contained page (no external scripts) with tiles, a timeline and effect charts. */
import { config } from '../../reels.config.ts';
import type { Insights } from './pipeline.ts';
import { LEARN_FEATURES, type GroupStat } from './analyze.ts';
import { ciText, pct } from './format.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

function timeline(ins: Insights): string {
  const pts = [...ins.scored].sort((a, b) => a.posted_at.localeCompare(b.posted_at));
  if (!pts.length) return '<p class="muted">No scored reels yet.</p>';
  const W = 860, H = 260, padL = 48, padR = 16, padT = 16, padB = 34;
  const ys = pts.map((p) => p.log_score);
  const lo = Math.min(-1, ...ys), hi = Math.max(1, ...ys);
  const x = (i: number) => padL + (pts.length === 1 ? (W - padL - padR) / 2 : (i / (pts.length - 1)) * (W - padL - padR));
  const y = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
  // Rolling median of the last 5 (trend line)
  const roll = pts.map((_, i) => {
    const w = ys.slice(Math.max(0, i - 4), i + 1).sort((a, b) => a - b);
    return w[Math.floor(w.length / 2)];
  });
  const ticks = [];
  for (let v = Math.ceil(lo); v <= Math.floor(hi); v++) ticks.push(v);
  const grid = ticks
    .map((v) => `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="grid${v === 0 ? ' zero' : ''}"/><text x="${padL - 8}" y="${y(v) + 4}" class="tick" text-anchor="end">${(2 ** v).toFixed(v < 0 ? 2 : 0)}×</text>`)
    .join('');
  const line = `<path d="${roll.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}" class="trend"/>`;
  const dots = pts
    .map(
      (p, i) =>
        `<g class="pt"><circle cx="${x(i)}" cy="${y(p.log_score)}" r="14" class="hit"/><circle cx="${x(i)}" cy="${y(p.log_score)}" r="5" class="dot"/><title>${esc(p.id)} · ${p.posted_at.slice(0, 10)} · ${p.virality.toFixed(2)}× · ${esc(p.template)}\n${esc(p.hook)}</title></g>`,
    )
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Virality per reel over time with a rolling median">${grid}${line}${dots}
  <text x="${padL}" y="${H - 8}" class="tick">${pts[0].posted_at.slice(0, 10)}</text><text x="${W - padR}" y="${H - 8}" class="tick" text-anchor="end">${pts[pts.length - 1].posted_at.slice(0, 10)}</text></svg>
  <p class="legend"><span class="sw dot"></span> one reel (hover for details) <span class="sw line"></span> rolling median of last 5</p>`;
}

function effects(groups: GroupStat[]): string {
  if (!groups.length) return '';
  const W = 860, row = 30, padL = 230, padR = 120;
  const H = groups.length * row + 30;
  const lo = Math.min(-1.5, ...groups.map((g) => g.ci[0])), hi = Math.max(1.5, ...groups.map((g) => g.ci[1]));
  const clamp = (v: number) => Math.max(lo, Math.min(hi, v));
  const x = (v: number) => padL + ((clamp(v) - lo) / (hi - lo)) * (W - padL - padR);
  const rows = groups
    .map((g, i) => {
      const cy = 20 + i * row;
      const cls = g.verdict === 'better' ? 'pos' : g.verdict === 'worse' ? 'neg' : 'neu';
      return `<g class="pt"><rect x="0" y="${cy - row / 2}" width="${W}" height="${row}" class="hitrow"/>
      <text x="${padL - 10}" y="${cy + 4}" text-anchor="end" class="lab">${esc(g.value)} <tspan class="muted">n=${g.n}</tspan></text>
      <line x1="${x(g.ci[0])}" x2="${x(g.ci[1])}" y1="${cy}" y2="${cy}" class="ci ${cls}"/>
      <circle cx="${x(g.diff)}" cy="${cy}" r="6" class="dot ${cls}"/>
      <text x="${W - padR + 10}" y="${cy + 4}" class="val">${pct(g.diff)} · ${g.evidence}</text>
      <title>${esc(g.feature)} = ${esc(g.value)}: ${pct(g.diff)} vs other reels (95% CI ${ciText(g.ci)}), n=${g.n}, ${g.evidence}, verdict ${g.verdict}</title></g>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img"><line x1="${x(0)}" x2="${x(0)}" y1="4" y2="${H - 10}" class="zero"/>${rows}</svg>`;
}

export function renderDashboard(ins: Insights, date: string): string {
  const a = ins.analysis;
  const followers = ins.followers;
  const goal = config.brand.goalFollowers;
  const progress = followers !== null ? Math.min(100, (followers / goal) * 100) : 0;
  const best = [...ins.scored].sort((x, y) => y.virality - x.virality)[0];
  const sections = LEARN_FEATURES.map((f) => {
    const gs = a.groups.filter((g) => g.feature === f).sort((x, y) => y.diff - x.diff);
    if (!gs.length) return '';
    return `<section><h3>${f.replace('_', ' ')}</h3>${effects(gs)}</section>`;
  }).join('');
  const hyp = ins.hypotheses.length
    ? `<table><thead><tr><th>status</th><th>hypothesis</th><th>evidence</th></tr></thead><tbody>${ins.hypotheses
        .map((h) => `<tr><td><span class="badge ${h.status}">${h.status}</span></td><td>${esc(h.statement)}</td><td>${esc(h.evidence)}</td></tr>`)
        .join('')}</tbody></table>`
    : '<p class="muted">No hypotheses yet.</p>';
  const table = ins.scored.length
    ? `<table><thead><tr><th>reel</th><th>posted</th><th class="r">virality</th><th>template</th><th>hook</th></tr></thead><tbody>${[...ins.scored]
        .sort((x, y) => y.virality - x.virality)
        .map((s) => `<tr><td><code>${esc(s.id)}</code></td><td>${s.posted_at.slice(0, 10)}</td><td class="r">${s.virality.toFixed(2)}×</td><td>${esc(s.template)}</td><td>${esc(s.hook)}</td></tr>`)
        .join('')}</tbody></table>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reels Dashboard</title>
<style>
:root{color-scheme:light;--surface:#fcfcfb;--panel:#ffffff;--text:#0b0b0b;--text2:#52514e;--muted:#8a8984;--line:#e6e5e0;--pos:#2a78d6;--neg:#eb6834;--neu:#a3a29b;--accent:#1baf7a}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;--surface:#121211;--panel:#1a1a19;--text:#f0efec;--text2:#c3c2b7;--muted:#8d8c84;--line:#2c2c2a;--pos:#3987e5;--neg:#d95926;--neu:#6f6e68;--accent:#199e70}}
:root[data-theme="dark"]{color-scheme:dark;--surface:#121211;--panel:#1a1a19;--text:#f0efec;--text2:#c3c2b7;--muted:#8d8c84;--line:#2c2c2a;--pos:#3987e5;--neg:#d95926;--neu:#6f6e68;--accent:#199e70}
body{margin:0;background:var(--surface);color:var(--text);font:15px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:920px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 10px}h3{font-size:14px;margin:18px 0 4px;color:var(--text2);text-transform:uppercase;letter-spacing:.04em}
.muted,.tick{color:var(--muted);fill:var(--muted);font-size:12px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:16px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.tile .k{color:var(--text2);font-size:13px}.tile .v{font-size:28px;font-weight:700;font-variant-numeric:tabular-nums}
.bar{height:8px;border-radius:4px;background:var(--line);margin-top:8px;overflow:hidden}.bar>i{display:block;height:100%;background:var(--accent);border-radius:4px}
svg{width:100%;height:auto;display:block}
.grid{stroke:var(--line);stroke-width:1}.grid.zero,.zero{stroke:var(--muted);stroke-width:1;stroke-dasharray:3 3}
.trend{fill:none;stroke:var(--text2);stroke-width:2}
.dot{fill:var(--pos);stroke:var(--panel);stroke-width:2}.dot.neg{fill:var(--neg)}.dot.neu{fill:var(--neu)}
.ci{stroke-width:2;stroke:var(--pos)}.ci.neg{stroke:var(--neg)}.ci.neu{stroke:var(--neu)}
.hit,.hitrow{fill:transparent}.pt:hover .hitrow{fill:var(--line);opacity:.5}.pt:hover .dot{r:8}
.lab{fill:var(--text);font-size:13px}.val{fill:var(--text2);font-size:12px}
.legend{font-size:12px;color:var(--text2)}.sw{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--pos);margin:0 4px 0 10px;vertical-align:-1px}.sw.line{border-radius:1px;height:2px;width:14px;background:var(--text2);vertical-align:3px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}.r{text-align:right;font-variant-numeric:tabular-nums}
.badge{font-size:11px;padding:2px 6px;border-radius:6px;border:1px solid var(--line)}.badge.supported{border-color:var(--pos)}.badge.refuted{border-color:var(--neg)}
code{font-size:12px}
</style></head><body><main>
<h1>@0xclaudemaxxer · learning dashboard</h1>
<div class="muted">Generated ${date} by <code>npm run learn</code> · mode: ${a.mode} · 1.00× = a typical recent reel</div>
<div class="tiles">
  <div class="tile"><div class="k">Followers</div><div class="v">${followers !== null ? followers.toLocaleString('en-US') : '–'}</div><div class="bar"><i style="width:${progress.toFixed(1)}%"></i></div><div class="muted">${progress.toFixed(1)}% of ${goal.toLocaleString('en-US')}</div></div>
  <div class="tile"><div class="k">Scored reels</div><div class="v">${ins.n_scored}</div><div class="muted">${ins.n_posted} posted · ${ins.n_too_young} too young</div></div>
  <div class="tile"><div class="k">Median virality</div><div class="v">${a.globalMedianVirality.toFixed(2)}×</div><div class="muted">vs rolling median of recent reels</div></div>
  <div class="tile"><div class="k">Best reel</div><div class="v">${best ? best.virality.toFixed(2) + '×' : '–'}</div><div class="muted">${best ? esc(best.id) : 'none yet'}</div></div>
</div>
<h2>Virality over time</h2>${timeline(ins)}
<h2>What goes with higher virality</h2>
<p class="muted">Each row: a group vs all other reels. Dot = difference, line = 95% interval. Blue = interval above zero, orange = below, grey = unclear. Groups with n&lt;3 are anecdotes.</p>
${sections || '<p class="muted">Not enough data yet.</p>'}
<h2>Hypotheses</h2>${hyp}
<h2>All scored reels</h2>${table || '<p class="muted">None yet.</p>'}
</main></body></html>`;
}
