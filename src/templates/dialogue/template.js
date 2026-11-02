/* Two simple icon characters talking in speech bubbles; each line can change the speaker's mood. */
Reel.register('dialogue', {
  build(root, ctx) {
    const { R, data, beats, height } = ctx;
    const COL = { green: 'var(--green)', amber: 'var(--amber)', cyan: 'var(--cyan)', purple: 'var(--purple)', coral: 'var(--coral)', red: 'var(--red)' };
    const defaults = ['cyan', 'coral'];
    const chars = R.el('div', 'chars', root);
    const area = R.el('div', 'area', root);
    area.style.bottom = '340px';
    const list = R.el('div', 'list', area);
    const face = (kind) => {
      // Eyes + mouths for each mood, drawn in a 200x200 box. Bot faces live on a screen.
      const eyeY = kind === 'bot' ? 92 : 88;
      return {
        happy: `<circle cx="72" cy="${eyeY}" r="11"/><circle cx="128" cy="${eyeY}" r="11"/><path d="M68 128 Q100 158 132 128" stroke-width="9" fill="none" stroke-linecap="round"/>`,
        neutral: `<circle cx="72" cy="${eyeY}" r="11"/><circle cx="128" cy="${eyeY}" r="11"/><path d="M74 136 L126 136" stroke-width="9" stroke-linecap="round"/>`,
        smug: `<path d="M58 ${eyeY} L86 ${eyeY}" stroke-width="9" stroke-linecap="round"/><path d="M114 ${eyeY} L142 ${eyeY}" stroke-width="9" stroke-linecap="round"/><path d="M76 132 Q110 150 134 124" stroke-width="9" fill="none" stroke-linecap="round"/>`,
        sweat: `<circle cx="72" cy="${eyeY}" r="11"/><circle cx="128" cy="${eyeY}" r="11"/><path d="M70 138 Q85 128 100 138 Q115 148 130 138" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M160 50 Q172 74 160 82 Q148 74 160 50Z" fill="#7fd8ff" stroke="none"/>`,
        shock: `<circle cx="72" cy="${eyeY}" r="16"/><circle cx="128" cy="${eyeY}" r="16"/><ellipse cx="100" cy="140" rx="16" ry="20"/>`,
        dead: `<path d="M60 ${eyeY - 12} l24 24 M84 ${eyeY - 12} l-24 24 M116 ${eyeY - 12} l24 24 M140 ${eyeY - 12} l-24 24" stroke-width="8" stroke-linecap="round"/><path d="M76 138 L124 138" stroke-width="8" stroke-linecap="round"/>`,
      };
    };
    const people = data.characters.map((c, i) => {
      const color = COL[c.color || defaults[i]];
      const el = R.el('div', 'ch ' + (i === 0 ? 'l' : 'r'), chars);
      const body = c.kind === 'bot'
        ? `<line x1="100" y1="6" x2="100" y2="28" stroke="${color}" stroke-width="8"/><circle cx="100" cy="6" r="10" fill="${color}"/><rect x="28" y="28" width="144" height="150" rx="36" fill="${color}"/><rect x="44" y="52" width="112" height="106" rx="22" fill="#0b1210"/>`
        : `<circle cx="100" cy="100" r="80" fill="${color}"/>`;
      const fg = c.kind === 'bot' ? color : '#0b1210';
      const moods = face(c.kind);
      el.innerHTML = `<svg width="230" height="253" viewBox="0 0 200 220">${body}<g class="face" fill="${fg}" stroke="${fg}">${moods.neutral}</g><rect x="40" y="186" width="120" height="34" rx="17" fill="${color}" opacity=".5"/></svg><div class="nm" style="color:${color}">${R.rich(c.name)}</div>`;
      return { el, color, moods, g: el.querySelector('.face'), mood: null, kind: c.kind };
    });
    const areaH = area.clientHeight;
    const GAP = 26;
    const bubs = data.lines.map((l, i) => {
      const who = people[l.who];
      const b = R.el('div', 'bub ' + (l.who === 0 ? 'l' : 'r'), list, `<span class="who small-ok" style="color:${who.color}">${R.rich(data.characters[l.who].name)}</span>${R.rich(l.text)}`);
      b.style.borderColor = who.color;
      return { b, h: b.getBoundingClientRect().height, beat: beats[i], l };
    });
    const layout = (t) => {
      let y = 0;
      const out = [];
      for (const x of bubs) { if (t < x.beat.at) break; out.push({ x, y }); y += x.h + GAP; }
      return { out, total: y - GAP };
    };
    const offAt = (t) => Math.max(0, layout(t).total - areaH);
    return (t) => {
      const L = layout(t);
      bubs.forEach((x) => (x.b.style.opacity = '0'));
      L.out.forEach(({ x, y }) => {
        x.b.style.top = y + 'px';
        const p = R.prog(t, x.beat.at, 0.32, R.ease.outBack);
        x.b.style.opacity = String(R.clamp(p * 1.5));
        x.b.style.transform = `translateY(${R.lerp(30, 0, p)}px) scale(${R.lerp(0.85, 1, p)})`;
        x.b.style.transformOrigin = x.l.who === 0 ? 'bottom left' : 'bottom right';
      });
      const evt = bubs.map((x) => x.beat.at).filter((a) => a <= t).pop();
      let off = offAt(t);
      if (evt !== undefined) off = R.lerp(offAt(evt - 1e-3), off, R.prog(t, evt, 0.3));
      list.style.transform = `translateY(${-off}px)`;
      // Moods: latest mood set by each character's most recent line.
      people.forEach((p, i) => {
        let mood = 'neutral', lastAt = -1;
        bubs.forEach((x) => { if (x.l.who === i && t >= x.beat.at) { lastAt = x.beat.at; if (x.l.mood) mood = x.l.mood; } });
        if (p.mood !== mood) { p.g.innerHTML = p.moods[mood]; p.mood = mood; }
        const since = t - lastAt;
        const hop = lastAt >= 0 && since < 0.4 ? Math.sin((since / 0.4) * Math.PI) * 26 : 0;
        const breathe = Math.sin(t * 2.2 + i) * 3;
        const shake = mood === 'shock' || mood === 'dead' ? R.jitter(t, 18, i + 3) * 4 : 0;
        p.el.style.transform = `translate(${shake}px, ${-hop + breathe}px)`;
      });
    };
  },
});
