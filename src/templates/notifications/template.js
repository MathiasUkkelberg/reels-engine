/* Lock screen with push notifications stacking in (newest on top). */
Reel.register('notifications', {
  build(root, ctx) {
    const { R, data, beats, height } = ctx;
    const lock = R.el('div', 'lock', root);
    R.el('div', 'date', lock, R.rich(data.date));
    R.el('div', 'time', lock, R.rich(data.time));
    const stack = R.el('div', 'stack', root);
    stack.style.top = lock.getBoundingClientRect().height + 40 + 'px';
    const GAP = 16;
    const cards = data.items.map((n, i) => {
      const c = R.el('div', 'nt ' + n.tone, stack);
      c.innerHTML = `<div class="nh"><div class="ico">${n.icon || '🔔'}</div><div class="app small-ok">${R.rich(n.app)}</div><div class="ago small-ok">${R.rich(n.ago)}</div></div><div class="ti">${R.rich(n.title)}</div><div class="bo">${R.rich(n.body)}</div>`;
      return { c, h: c.getBoundingClientRect().height, b: beats[i] };
    });
    // y of card i at time t: total height of newer visible cards.
    const ys = (t) => {
      const vis = cards.filter((k) => t >= k.b.at);
      const out = new Map();
      let y = 0;
      for (let i = vis.length - 1; i >= 0; i--) { out.set(vis[i], y); y += vis[i].h + GAP; }
      return out;
    };
    return (t) => {
      const now = ys(t);
      const evt = cards.map((k) => k.b.at).filter((x) => x <= t).pop();
      const before = evt !== undefined ? ys(evt - 1e-3) : now;
      const p = evt !== undefined ? R.prog(t, evt, 0.38, R.ease.outCubic) : 1;
      cards.forEach((k) => {
        if (!now.has(k)) { k.c.style.opacity = '0'; return; }
        const y1 = now.get(k);
        const isNew = !before.has(k);
        const y0 = isNew ? -60 : before.get(k);
        const y = R.lerp(y0, y1, p);
        const op = isNew ? R.clamp(p * 1.6) : 1;
        const s = isNew ? R.lerp(0.92, 1, R.ease.outBack(p)) : 1;
        k.c.style.opacity = String(op * (y1 > height ? 0 : 1));
        k.c.style.transform = `translateY(${y}px) scale(${s})`;
      });
      // Tiny buzz when a notification lands.
      const buzz = evt !== undefined && t - evt < 0.18 ? 5 * (1 - (t - evt) / 0.18) : 0;
      lock.style.transform = buzz ? `translateX(${R.jitter(t, 60, 4) * buzz}px)` : 'none';
    };
  },
});
