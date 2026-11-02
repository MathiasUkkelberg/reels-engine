/* Terminal: a coding-agent session going wrong. Typed commands, colored output, rising chaos. */
Reel.register('terminal', {
  build(root, ctx) {
    const { R, data, beats, fx } = ctx;
    const term = R.el('div', 'term', root);
    R.el('div', 'tbar', term, `<i></i><i></i><i></i><span class="ttitle small-ok">${R.rich(data.title)}</span>`);
    const body = R.el('div', 'tbody', term);
    const list = R.el('div', 'tlines', body);
    const PRE = { cmd: '$', agent: '⏺', out: ' ', error: '✗', success: '✓', warn: '⚠' };
    const lines = data.lines.map((l, i) => {
      const row = R.el('div', 'tl ' + l.kind, list);
      R.el('span', 'pre', row, PRE[l.kind]);
      const txt = R.el('span', 'txt', row);
      txt.innerHTML = R.rich(l.text);
      const full = txt.textContent;
      const b = beats[i];
      // Commands type slowly; agent lines stream fast; tool output appears at once.
      const typeDur = l.kind === 'cmd' ? Math.min(1.2, b.dur * 0.6) : l.kind === 'agent' ? Math.min(0.7, b.dur * 0.4) : 0.001;
      return { l, row, txt, full, b, typeDur, h: 0, y: 0 };
    });
    // Measure final heights, then hide.
    let y = 0;
    for (const L of lines) { L.y = y; L.h = L.row.getBoundingClientRect().height + 16; y += L.h; }
    const bodyH = body.clientHeight - 40;
    lines.forEach((L) => { L.row.style.position = 'absolute'; L.row.style.left = '0'; L.row.style.right = '0'; L.row.style.top = L.y + 'px'; });

    const cursor = R.el('span', 'cursor', null);
    const tint = R.el('div', 'redtint', fx);
    let fin = null;
    if (data.final) {
      fin = R.el('div', 'final', root, R.rich(data.final));
      R.fitHeight(fin, 64, 330, 40);
    }
    const tl = ctx.tl;
    const chaosStart = beats[Math.floor(beats.length * 0.55)].at;
    const chaosEnd = tl.contentEnd;
    const offsetAt = (t) => {
      let bottom = 0;
      for (const L of lines) if (t >= L.b.at) bottom = L.y + L.h;
      return Math.max(0, bottom - bodyH);
    };

    return (t) => {
      let active = null;
      for (const L of lines) {
        if (t < L.b.at) { L.row.style.visibility = 'hidden'; continue; }
        L.row.style.visibility = 'visible';
        const p = R.clamp((t - L.b.at) / L.typeDur);
        if (p < 1) {
          L.txt.textContent = R.typed(L.full, p);
          active = L;
        } else {
          L.txt.innerHTML = R.rich(L.l.text);
        }
        L.row.style.opacity = String(R.clamp((t - L.b.at) / 0.08));
      }
      // Blinking cursor on the line being typed (or the last line).
      const host = active || lines.filter((L) => t >= L.b.at).pop();
      if (host) {
        host.txt.appendChild(cursor);
        cursor.style.opacity = active || (t * 2.2) % 1 < 0.6 ? '1' : '0';
      }
      // Smooth auto-scroll.
      const evt = lines.map((L) => L.b.at).filter((x) => x <= t).pop();
      let off = offsetAt(t);
      if (evt !== undefined) off = R.lerp(offsetAt(evt - 1e-3), off, R.prog(t, evt, 0.25));
      list.style.transform = R.ty(-off);
      // Chaos: shake + red vignette ramping up toward the end.
      const chaos = data.chaos === 'rising' ? R.ease.inQuad(R.clamp((t - chaosStart) / Math.max(0.1, chaosEnd - chaosStart))) : 0;
      const amp = 14 * chaos;
      term.style.transform = amp > 0.3 ? `translate(${R.jitter(t, 20, 3) * amp}px, ${R.jitter(t, 20, 7) * amp}px) rotate(${R.jitter(t, 10, 5) * chaos * 0.8}deg)` : 'none';
      term.style.borderColor = chaos > 0.3 ? `rgba(255,84,104,${0.4 + 0.6 * chaos})` : '';
      tint.style.opacity = String(chaos * 0.85);
      if (fin) {
        const b = beats[beats.length - 1];
        const p = R.prog(t, b.at, 0.45, R.ease.outBack);
        fin.style.opacity = String(R.clamp(p * 2));
        fin.style.transform = `scale(${R.lerp(1.6, 1, p)}) rotate(${R.lerp(-12, -3, p)}deg)`;
      }
    };
  },
});
