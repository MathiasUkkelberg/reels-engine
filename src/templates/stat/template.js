/* Big-number reveal: stats count up one by one; the contrast between them is the joke. */
Reel.register('stat', {
  build(root, ctx) {
    const { R, data, beats, height } = ctx;
    const stack = R.el('div', 'stack', root);
    const fmt = (v, s) => {
      const n = Math.abs(v).toFixed(s.decimals);
      const [i, d] = n.split('.');
      const withSep = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return (v < 0 ? '-' : '') + s.prefix + withSep + (d ? '.' + d : '') + s.suffix;
    };
    const blocks = data.stats.map((s) => {
      const blk = R.el('div', 'blk ' + s.tone, stack);
      R.el('div', 'lab', blk, R.rich(s.label));
      const val = R.el('div', 'val', blk, fmt(s.value, s));
      return { s, blk, val };
    });
    const pun = data.punchline ? R.el('div', 'pun', stack, R.rich(data.punchline)) : null;
    // Value font: largest that fits the widest number and the total height.
    const size = data.stats.length === 1 ? 260 : data.stats.length === 2 ? 210 : 170;
    blocks.forEach((b) => R.fitWidth(b.val, size, 70, 4));
    const minVal = Math.min(...blocks.map((b) => parseFloat(b.val.style.fontSize)));
    blocks.forEach((b) => (b.val.style.fontSize = minVal + 'px'));
    R.scaleToFit(stack, [...stack.querySelectorAll('.lab, .val, .pun')], height, 0.6, 1.25);
    return (t) => {
      blocks.forEach((b, i) => {
        const bt = beats[i];
        const p = R.prog(t, bt.at, 0.3);
        R.appear(b.blk, p, { dy: 40, scale: 1 });
        const c = R.prog(t, bt.at + 0.15, Math.min(1.3, bt.dur * 0.6), R.ease.outCubic);
        b.val.textContent = fmt(b.s.value * c, b.s);
        const pop = R.prog(t, bt.at + 0.15 + Math.min(1.3, bt.dur * 0.6), 0.3, R.ease.outBack);
        b.val.style.transform = c >= 1 ? `scale(${1 + 0.06 * Math.sin(pop * Math.PI)})` : 'none';
        b.val.style.transformOrigin = 'left center';
      });
      if (pun) {
        const bt = beats[beats.length - 1];
        const p = R.prog(t, bt.at, 0.4, R.ease.outBack);
        pun.style.opacity = String(R.clamp(p * 2));
        pun.style.transform = `translateY(${R.lerp(50, 0, p)}px) scale(${R.lerp(0.85, 1, p)}) rotate(${R.lerp(-3, 0, p)}deg)`;
      }
    };
  },
});
