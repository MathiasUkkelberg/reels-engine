/* Expectation vs reality: clean top panel, messy bottom panel revealed item by item. */
Reel.register('expectation_reality', {
  build(root, ctx) {
    const { R, data, beats, height } = ctx;
    const mk = (cls, p, label) => {
      const box = R.el('div', 'er ' + cls, root);
      R.el('div', 'chip', box, R.rich(p.label || label));
      const text = R.el('div', 'etext', box, R.rich(p.text));
      const items = R.el('div', 'items', box);
      const its = p.items.map((s) => R.el('div', 'it', items, R.rich(s)));
      const emo = p.emoji ? R.el('div', 'emo', box, p.emoji) : null;
      return { box, text, its, emo };
    };
    const E = mk('exp', data.expectation, 'EXPECTATION');
    const Q = mk('rea', data.reality, 'REALITY');
    // Fit both panels into the content height.
    const gap = 30;
    // Largest text scale (0.7–1.4) at which the panel still fits its half of the screen.
    const fitPanel = (P, maxH) => {
      const base = [[P.text, 56], ...P.its.map((e) => [e, 42])];
      const apply = (s) => base.forEach(([e, px]) => (e.style.fontSize = Math.round(px * s) + 'px'));
      let s = 1.4;
      apply(s);
      while (P.box.getBoundingClientRect().height > maxH && s > 0.7) {
        s -= 0.04;
        apply(s);
      }
    };
    // Reality is the punchline: it gets the bigger share of the screen.
    fitPanel(E, (height - gap) * 0.42);
    fitPanel(Q, height - E.box.getBoundingClientRect().height - gap);
    Q.box.style.top = E.box.getBoundingClientRect().height + gap + 'px';

    return (t) => {
      const b0 = beats[0], b1 = beats[1];
      R.appear(E.box, R.prog(t, b0.at, 0.35), { dy: 50 });
      E.its.forEach((e, i) => R.appear(e, R.prog(t, b0.at + 0.25 + i * 0.18, 0.3), { dy: 16, scale: 1 }));
      if (E.emo) E.emo.style.transform = `translateY(${Math.sin(t * 2.4) * 8}px) rotate(${Math.sin(t * 1.7) * 6}deg)`;
      // Reality slams in with a short glitch shake.
      const p = R.prog(t, b1.at, 0.3, R.ease.outBack);
      const shake = t >= b1.at && t < b1.at + 0.35 ? 12 * (1 - (t - b1.at) / 0.35) : 0;
      Q.box.style.opacity = String(R.clamp(p * 2));
      Q.box.style.transform = `translate(${R.jitter(t, 30, 2) * shake}px, ${R.lerp(80, 0, p)}px) rotate(${R.lerp(-6, -1.2, p)}deg) scale(${R.lerp(0.85, 1, p)})`;
      Q.its.forEach((e, i) => {
        const b = beats[2 + i];
        R.appear(e, b ? R.prog(t, b.at, 0.3, R.ease.outBack) : 0, { dy: 20, scale: 0.9, dx: -30 });
      });
      if (Q.emo) Q.emo.style.transform = `rotate(${R.jitter(t, 8, 9) * 10}deg) scale(${1 + 0.06 * Math.sin(t * 9)})`;
    };
  },
});
