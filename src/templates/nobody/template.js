/* "Nobody: / Absolutely no one: / AI:" followed by the punchline, line by line. */
Reel.register('nobody', {
  build(root, ctx) {
    const { R, data, beats, height } = ctx;
    const col = R.el('div', 'col', root);
    const setup = data.setup.map((s) => R.el('div', 'setup', col, R.rich(s)));
    const actor = R.el('div', 'actor', col, R.rich(data.actor));
    let host = col;
    if (data.style === 'markdown') host = R.el('div', 'card', col);
    if (data.style === 'terminal') host = R.el('div', 'term', col);
    const lines = data.punchline.map((s) => {
      if (data.style === 'terminal') return R.el('div', 'tl', host, R.rich(s));
      if (data.style === 'markdown') {
        const m = s.match(/^(#{1,2})\s+(.*)$/);
        if (m) return R.el('div', m[1].length === 1 ? 'h1' : 'h2', host, R.rich(m[2]));
        if (/^[-*•]\s+/.test(s)) return R.el('div', 'li', host, R.rich(s.replace(/^[-*•]\s+/, '')));
        if (/^>\s+/.test(s)) return R.el('div', 'q', host, R.rich(s.replace(/^>\s+/, '')));
        if (/^\|/.test(s)) return R.el('div', 'tr', host, R.rich(s));
        return R.el('div', 'p', host, R.rich(s));
      }
      return R.el('div', 'pl-text', host, R.rich(s));
    });
    // Fill the screen: grow/shrink all text together so the full column fits.
    R.scaleToFit(col, [...setup, actor, ...lines], height, 0.7, 1.35);
    const order = [...setup, actor, ...lines];
    const rootTop = root.getBoundingClientRect().top;
    const bottoms = order.map((e) => e.getBoundingClientRect().bottom - rootTop);
    const offsetAt = (t) => {
      let k = -1;
      order.forEach((_, i) => { if (beats[i] && t >= beats[i].at) k = i; });
      return k < 0 ? 0 : Math.max(0, bottoms[k] - height);
    };
    if (host !== col) host.style.transformOrigin = 'top left';
    return (t) => {
      order.forEach((e, i) => {
        const b = beats[i];
        const p = b ? R.prog(t, b.at, i < setup.length ? 0.22 : 0.32, R.ease.outBack) : 0;
        R.appear(e, p, { dy: 26, scale: 0.94 });
      });
      if (host !== col) {
        const b = beats[setup.length + 1];
        const p = b ? R.prog(t, b.at - 0.05, 0.25) : 0;
        host.style.opacity = String(R.clamp(p * 2));
      }
      const evt = beats.map((b) => b.at).filter((x) => x <= t).pop();
      let off = offsetAt(t);
      if (evt !== undefined) off = R.lerp(offsetAt(evt - 1e-3), off, R.prog(t, evt, 0.3));
      col.style.transform = R.ty(-off);
    };
  },
});
