/* Progress bar with status messages, a stall near the end, then a twist. */
Reel.register('progress', {
  build(root, ctx) {
    const { R, data, beats } = ctx;
    const wrap = R.el('div', 'wrap', root);
    const lbl = R.el('div', 'lbl', wrap, R.rich(data.label));
    const pct = R.el('div', 'pct', wrap, '0%');
    const track = R.el('div', 'track', wrap);
    const fill = R.el('div', 'fill', track);
    const status = R.el('div', 'status', wrap);
    const sts = [...data.steps.map((s) => s.text), data.stall_text].map((s) => R.el('div', 'st', status, R.rich(s)));
    const tw = R.el('div', 'twist ' + data.twist.style, root);
    R.el('div', 'tw-t', tw, R.rich(data.twist.text));
    if (data.twist.sub) R.el('div', 'tw-s', tw, R.rich(data.twist.sub));
    R.fitHeight(tw, 64, 340, 40);
    const nS = data.steps.length;
    const stallBeat = beats[nS], twistBeat = beats[nS + 1];
    // Percentage as a pure function of time.
    const pctAt = (t) => {
      let prev = 0;
      for (let i = 0; i < nS; i++) {
        const b = beats[i], target = data.steps[i].pct;
        if (t < b.at) return prev;
        if (t < b.at + b.dur) return R.lerp(prev, target, R.ease.inOutCubic(R.clamp((t - b.at) / (b.dur * 0.8))));
        prev = target;
      }
      if (t < twistBeat.at) {
        // Crawl to stall_at, then creep by tiny decimals.
        const base = R.lerp(prev, data.stall_at, R.ease.outCubic(R.clamp((t - stallBeat.at) / 0.6)));
        const creep = Math.max(0, t - stallBeat.at - 0.6) * 0.07;
        return Math.min(base + creep, 99.9);
      }
      const p = R.prog(t, twistBeat.at, 0.5, R.ease.inOutCubic);
      if (data.twist.style === 'reset') return R.lerp(Math.min(data.stall_at + 0.3, 99.9), 0, p);
      if (data.twist.style === 'success') return R.lerp(data.stall_at, 100, p);
      return Math.min(data.stall_at + 0.3, 99.9);
    };
    return (t) => {
      const v = pctAt(t);
      const stalled = t >= stallBeat.at && t < twistBeat.at;
      pct.textContent = (stalled || (v > 99 && v < 100) ? v.toFixed(1) : Math.round(v)) + '%';
      fill.style.width = v + '%';
      fill.style.backgroundPosition = `${(t * 120) % 62}px 0`;
      let cur = -1;
      beats.forEach((b, i) => { if (i <= nS && t >= b.at) cur = i; });
      sts.forEach((el, i) => {
        if (i === cur) R.appear(el, R.prog(t, beats[i].at, 0.3), { dy: 30, scale: 1 });
        else el.style.opacity = '0';
      });
      if (stalled) {
        const dots = '.'.repeat(1 + (Math.floor(t * 3) % 3));
        sts[nS].innerHTML = R.rich(data.stall_text.replace(/[.…]+$/, '')) + dots;
      }
      const isTwist = t >= twistBeat.at;
      const p = R.prog(t, twistBeat.at, 0.45, R.ease.outBack);
      tw.style.opacity = String(R.clamp(p * 2));
      tw.style.transform = `translateY(${R.lerp(80, 0, p)}px) scale(${R.lerp(0.7, 1, p)}) rotate(${R.lerp(-6, -1.5, p)}deg)`;
      const err = isTwist && data.twist.style === 'error';
      fill.style.background = err ? 'var(--red)' : '';
      pct.style.color = err ? 'var(--red)' : data.twist.style === 'reset' && isTwist ? 'var(--amber)' : '';
      const shake = err && t - twistBeat.at < 0.5 ? 16 * (1 - (t - twistBeat.at) / 0.5) : 0;
      wrap.style.transform = shake ? `translate(${R.jitter(t, 30, 2) * shake}px, ${R.jitter(t, 30, 5) * shake}px)` : 'none';
      wrap.style.opacity = isTwist ? String(1 - 0.35 * p) : '1';
      status.style.opacity = isTwist ? String(1 - R.clamp(p * 2)) : '1';
      void lbl;
    };
  },
});
