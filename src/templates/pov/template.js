/* POV: a screen you're staring at, changing beat by beat, your reaction underneath, optional clock. */
Reel.register('pov', {
  build(root, ctx) {
    const { R, data, beats } = ctx;
    const scene = R.el('div', 'scene ' + data.scene, root);
    const glow = R.el('div', 'glow deco', scene);
    const device = R.el('div', 'device', scene);
    if (data.scene === 'laptop') R.el('div', 'base deco', scene);
    const screen = R.el('div', 'screen', device);
    const bar = R.el('div', 'bar', screen, '<i></i><i></i><i></i>');
    const clock = data.clock ? R.el('div', 'clock', bar) : null;
    const msgs = data.beats.map((b) => {
      const m = R.el('div', 'msg ' + b.tone, screen, R.rich(b.screen));
      R.fit(m, data.scene === 'laptop' ? 64 : 58, 36);
      return m;
    });
    const faces = data.beats.map((b) => R.el('div', 'face', scene, b.reaction || ''));
    let cap = null;
    if (data.caption_end) {
      cap = R.el('div', 'caption-end', root, R.rich(data.caption_end));
      R.fitHeight(cap, 58, 260, 38);
    }
    const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
    const fmt = (m) => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
    let c0 = 0, c1 = 0;
    if (data.clock) { c0 = toMin(data.clock.from); c1 = toMin(data.clock.to); if (c1 < c0) c1 += 1440; }
    const nB = data.beats.length;
    const tStart = beats[0].at, tEnd = beats[nB - 1].at + beats[nB - 1].dur * 0.5;
    const toneGlow = { normal: 'var(--accent)', good: 'var(--good)', bad: 'var(--bad)', warn: 'var(--warn)' };

    return (t) => {
      let cur = -1;
      data.beats.forEach((b, i) => { if (t >= beats[i].at) cur = i; });
      msgs.forEach((m, i) => {
        const b = beats[i];
        if (i === cur) {
          const p = R.prog(t, b.at, 0.35, R.ease.outBack);
          m.style.opacity = String(R.clamp(p * 1.5));
          m.style.transform = `translateY(${R.lerp(40, 0, p)}px) scale(${R.lerp(0.9, 1, p)})`;
        } else if (i === cur - 1) {
          const p = R.prog(t, beats[cur].at, 0.25, R.ease.inCubic);
          m.style.opacity = String(1 - p);
          m.style.transform = `translateY(${-50 * p}px)`;
        } else {
          m.style.opacity = '0';
        }
      });
      faces.forEach((f, i) => {
        const on = i === cur && data.beats[i].reaction;
        f.style.opacity = on ? '1' : '0';
        if (on) {
          const p = R.prog(t, beats[i].at + 0.1, 0.45, R.ease.outElastic);
          f.style.transform = `scale(${R.lerp(0.3, 1, p)}) rotate(${R.lerp(-20, 0, p)}deg)`;
        }
      });
      const tone = cur >= 0 ? data.beats[cur].tone : 'normal';
      glow.style.boxShadow = `0 0 140px 10px ${toneGlow[tone]}`;
      glow.style.opacity = String(cur >= 0 ? 0.35 + 0.1 * Math.sin(t * 3) : 0.2);
      if (clock) clock.textContent = fmt(R.lerp(c0, c1, R.ease.inQuad(R.clamp((t - tStart) / (tEnd - tStart)))));
      if (cap) {
        const b = beats[beats.length - 1];
        const p = R.prog(t, b.at, 0.4, R.ease.outBack);
        cap.style.opacity = String(R.clamp(p * 2));
        cap.style.transform = `translateY(${R.lerp(60, 0, p)}px) rotate(${R.lerp(-4, -1.5, p)}deg) scale(${R.lerp(0.8, 1, p)})`;
        scene.style.opacity = String(1 - 0.45 * p);
      }
    };
  },
});
