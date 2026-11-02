/* Tier list that fills in live: each item pops into the spotlight, then flies into its tier. */
Reel.register('tier_list', {
  build(root, ctx) {
    const { R, data, beats, height } = ctx;
    const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#8ce99a', '#66d9e8', '#b197fc'];
    const spot = R.el('div', 'spot', root);
    const rowsEl = R.el('div', 'rows', root);
    rowsEl.style.top = '190px';
    const rows = {};
    data.tiers.forEach((tier, i) => {
      const row = R.el('div', 'row', rowsEl);
      const lab = R.el('div', 'lab', row, R.rich(tier));
      lab.style.background = COLORS[i % COLORS.length];
      rows[tier.toLowerCase()] = { row, lab, track: R.el('div', 'track', row) };
    });
    let twistRow = null;
    if (data.twist) {
      const row = R.el('div', 'row twist', rowsEl);
      const lab = R.el('div', 'lab', row, R.rich(data.twist.tier));
      twistRow = { row, lab, track: R.el('div', 'track', row) };
    }
    const all = [...data.items.map((it) => ({ ...it })), ...(data.twist ? [{ text: data.twist.text, tier: '__twist' }] : [])];
    // Static layout first (chips inside their tracks) to measure final positions.
    const chips = all.map((it) => {
      const r = it.tier === '__twist' ? twistRow : rows[String(it.tier).toLowerCase()] || Object.values(rows)[Object.keys(rows).length - 1];
      const c = R.el('div', 'chip', r.track, R.rich(it.text));
      return { it, c, r };
    });
    // Shrink chip text if any track overflows.
    let fs = 44;
    const overflow = () => Object.values(rows).concat(twistRow ? [twistRow] : []).some((r) => r.track.scrollHeight > r.track.clientHeight + 4 || r.track.scrollWidth > r.track.clientWidth + 2);
    while (overflow() && fs > 30) { fs -= 2; chips.forEach(({ c }) => (c.style.fontSize = fs + 'px')); }
    const rootRect = root.getBoundingClientRect();
    chips.forEach((ch) => {
      const r = ch.c.getBoundingClientRect();
      ch.x = r.left - rootRect.left; ch.y = r.top - rootRect.top; ch.w = r.width; ch.h = r.height;
    });
    chips.forEach((ch) => { root.appendChild(ch.c); ch.c.classList.add('fly'); });
    const spotW = ctx.width;
    return (t) => {
      chips.forEach((ch, i) => {
        const b = beats[i];
        if (!b || t < b.at) { ch.c.style.opacity = '0'; return; }
        ch.c.style.opacity = '1';
        // Phase 1: pop into the spotlight at 1.5x. Phase 2: fly to the tier.
        const S = Math.min(1.55, (spotW - 40) / ch.w);
        const sx = (spotW - ch.w * S) / 2, sy = (170 - ch.h * S) / 2;
        const pop = R.prog(t, b.at, 0.3, R.ease.outBack);
        const flyStart = b.at + Math.min(0.9, b.dur * 0.5);
        const fly = R.prog(t, flyStart, 0.4, R.ease.inOutCubic);
        const s = R.lerp(S * R.lerp(0.5, 1, pop), 1, fly);
        const x = R.lerp(sx, ch.x, fly), y = R.lerp(sy, ch.y, fly);
        const wob = fly < 1 ? Math.sin((t - b.at) * 10) * 2 * (1 - fly) : 0;
        ch.c.style.transform = `translate(${x}px, ${y}px) scale(${s}) rotate(${wob}deg)`;
        ch.c.style.borderColor = fly >= 1 ? '' : 'var(--accent)';
      });
      if (twistRow) {
        const b = beats[beats.length - 1];
        const p = R.prog(t, b.at - 0.05, 0.35, R.ease.outBack);
        twistRow.row.style.opacity = String(R.clamp(p * 2));
        twistRow.row.style.transform = `scale(${R.lerp(0.6, 1, p)})`;
        twistRow.lab.style.filter = t > b.at ? `brightness(${1 + 0.35 * Math.max(0, Math.sin(t * 14))})` : '';
      }
    };
  },
});
