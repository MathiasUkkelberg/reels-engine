/* Fake keynote: product launch slides on a dark stage, with crowd reactions. */
Reel.register('keynote', {
  build(root, ctx) {
    const { R, data, beats } = ctx;
    R.el('div', 'live small-ok', root, `<span class="tag">LIVE</span><span>${R.rich(data.presenter)}</span>`);
    const stage = R.el('div', 'stage', root);
    R.el('div', 'beam deco', stage);
    const slide = R.el('div', 'slide', stage);
    const slides = data.slides.map((s) => {
      const el = R.el('div', 'sl', slide);
      if (s.kind === 'title') {
        R.el('div', 'k-title', el, R.rich(data.product));
        R.el('div', 'k-sub', el, R.rich(s.text));
        if (s.sub) R.el('div', 'k-sub', el, R.rich(s.sub));
      } else if (s.kind === 'stat' || s.kind === 'price') {
        R.el('div', 'k-big', el, R.rich(s.text));
        if (s.sub) R.el('div', 'k-sub', el, R.rich(s.sub));
      } else if (s.kind === 'one_more_thing') {
        R.el('div', 'k-omt', el, 'One more thing…');
        el.appendChild(R.el('div', 'k-text', null, R.rich(s.text)));
        if (s.sub) R.el('div', 'k-sub', el, R.rich(s.sub));
      } else {
        R.el('div', 'k-text', el, R.rich(s.text));
        if (s.sub) R.el('div', 'k-sub', el, R.rich(s.sub));
      }
      // Shrink the slide's text until it fits.
      const parts = [...el.children];
      R.scaleToFit(el, parts, 620, 0.5, 1);
      while (el.scrollHeight > 624 && parts.length) { R.scaleToFit(el, parts, 560, 0.5, 0.95); break; }
      return el;
    });
    const crowd = R.el('div', 'crowd deco', stage);
    const heads = [];
    for (let i = 0; i < 8; i++) {
      const h = R.el('i', null, crowd);
      h.style.left = (i * 150 - 20 + (i % 2) * 30) + 'px';
      heads.push(h);
    }
    const wows = ['👏', '😮', '🔥', '🤯'];
    const reactions = data.slides.map((s, i) => {
      const w = R.el('div', 'wow', stage, wows[i % wows.length]);
      w.style.left = (140 + ((i * 260) % 640)) + 'px';
      w.style.top = '700px';
      return w;
    });
    return (t) => {
      let cur = -1;
      beats.forEach((b, i) => { if (t >= b.at) cur = i; });
      slides.forEach((el, i) => {
        const b = beats[i];
        if (i === cur) {
          const p = R.prog(t, b.at, 0.5, R.ease.outCubic);
          el.style.opacity = String(p);
          el.style.transform = `scale(${R.lerp(1.08, 1, p)})`;
          el.style.filter = p < 1 ? `blur(${(1 - p) * 8}px)` : 'none';
          const omt = el.querySelector('.k-omt');
          if (omt) {
            const second = el.querySelectorAll('.k-text, .k-sub');
            const q = R.prog(t, b.at + Math.min(1.1, b.dur * 0.4), 0.4, R.ease.outBack);
            second.forEach((e) => { e.style.opacity = String(q); e.style.transform = `translateY(${R.lerp(30, 0, q)}px)`; });
          }
        } else if (i === cur - 1) {
          const p = R.prog(t, beats[cur].at, 0.3);
          el.style.opacity = String(1 - p);
          el.style.transform = `scale(${1 - 0.06 * p})`;
          el.style.filter = 'none';
        } else {
          el.style.opacity = '0';
        }
      });
      slide.style.opacity = String(R.prog(t, beats[0].at - 0.2, 0.4));
      heads.forEach((h, i) => (h.style.transform = `translateY(${Math.sin(t * 2 + i * 1.3) * 4}px)`));
      reactions.forEach((w, i) => {
        const b = beats[i];
        const p = R.clamp((t - b.at - 0.4) / 1.2);
        w.style.opacity = p > 0 && p < 1 ? String(Math.sin(p * Math.PI)) : '0';
        w.style.transform = `translateY(${-120 * p}px) scale(${0.8 + 0.4 * p})`;
      });
    };
  },
});
