/* Countdown list: one huge numbered beat at a time; finished beats collapse into a list above. */
Reel.register('countdown', {
  build(root, ctx) {
    const { R, data, beats, height } = ctx;
    const N = data.items.length;
    const numOf = (i) => (data.direction === 'down' ? N - i : i + 1);
    const ROW = 66;
    const list = R.el('div', 'list', root);
    const rows = data.items.map((it, i) => {
      const r = R.el('div', 'li', list, `<span class="n">${numOf(i)}</span><span class="tx">${R.rich(it.text)}</span>`);
      r.style.top = i * ROW + 'px';
      return r;
    });
    const spots = data.items.map((it, i) => {
      const s = R.el('div', 'spot', root);
      R.el('div', 'num', s, String(numOf(i)));
      const tx = R.el('div', 'stx', s, R.rich(it.text));
      if (it.sub) R.el('div', 'sub', s, R.rich(it.sub));
      const emo = it.emoji ? R.el('div', 'emo', s, it.emoji) : null;
      if (emo) tx.style.paddingRight = '0';
      // Make sure the spotlight fits below the longest list.
      const maxH = height - (N - 1) * ROW - 30;
      const parts = [...s.querySelectorAll('.stx, .sub')];
      const base = parts.map((e) => parseFloat(getComputedStyle(e).fontSize));
      let k = 1;
      while (s.getBoundingClientRect().height > maxH && k > 0.6) {
        k -= 0.05;
        parts.forEach((e, j) => (e.style.fontSize = Math.round(base[j] * k) + 'px'));
        s.querySelector('.num').style.fontSize = Math.round(280 * k) + 'px';
      }
      return { s, emo };
    });
    return (t) => {
      let cur = -1;
      beats.forEach((b, i) => { if (t >= b.at) cur = i; });
      const listH = (k) => Math.max(0, k) * ROW + (k > 0 ? 30 : 0);
      const pMove = cur >= 0 ? R.prog(t, beats[cur].at, 0.35) : 0;
      const top = R.lerp(listH(cur - 1), listH(cur), pMove);
      rows.forEach((r, i) => {
        const done = i < cur;
        const p = i === cur - 1 ? pMove : done ? 1 : 0;
        r.style.opacity = String(p);
        r.style.transform = `translateX(${R.lerp(-30, 0, p)}px)`;
      });
      spots.forEach(({ s, emo }, i) => {
        if (i !== cur) {
          if (i === cur - 1) {
            const p = R.prog(t, beats[cur].at, 0.25, R.ease.inCubic);
            s.style.opacity = String(1 - p);
            s.style.transform = `translateY(${top - 80 * p}px) scale(${1 - 0.2 * p})`;
          } else s.style.opacity = '0';
          return;
        }
        const p = R.prog(t, beats[i].at + 0.05, 0.4, R.ease.outBack);
        s.style.opacity = String(R.clamp(p * 1.6));
        s.style.transform = `translateY(${top + R.lerp(60, 0, p)}px)`;
        const num = s.querySelector('.num');
        num.style.transform = `scale(${R.lerp(1.6, 1, R.prog(t, beats[i].at, 0.35, R.ease.outBack))})`;
        num.style.transformOrigin = 'left center';
        if (emo) emo.style.transform = `rotate(${Math.sin((t - beats[i].at) * 4) * 8}deg) scale(${R.lerp(0, 1, R.prog(t, beats[i].at + 0.2, 0.4, R.ease.outElastic))})`;
      });
    };
  },
});
