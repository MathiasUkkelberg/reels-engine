/* Fake chat: user vs AI, message by message with typing indicators. */
Reel.register('chat', {
  build(root, ctx) {
    const { R, data, beats } = ctx;
    const head = R.el('div', 'chat-head', root);
    R.el('div', 'chat-av', head, '✳');
    const meta = R.el('div', 'chat-meta', head);
    R.el('div', 'chat-name', meta, R.rich(data.ai_name));
    const status = R.el('div', 'chat-status small-ok', meta, 'online');
    const area = R.el('div', 'chat-area', root);
    const list = R.el('div', 'chat-list', area);
    const areaH = area.clientHeight;

    const rows = data.messages.map((m, i) => {
      const row = R.el('div', 'chat-row ' + m.from, list);
      const bubble = R.el('div', 'chat-bubble', row, R.rich(m.text));
      let dots = null, dotsH = 0;
      const msgH = row.getBoundingClientRect().height;
      if (m.from === 'ai') {
        bubble.style.display = 'none';
        dots = R.el('div', 'chat-dots', row, '<i></i><i></i><i></i>');
        dotsH = row.getBoundingClientRect().height;
        dots.style.display = 'none';
        bubble.style.display = '';
      }
      const b = beats[i];
      const typeDur = m.from === 'ai' ? Math.min(0.85, b.dur * 0.32) : 0;
      return { m, row, bubble, dots, msgH, dotsH, b, typeDur, showAt: b.at + typeDur };
    });

    // Layout at time t: which rows are visible, in which state, and the total height.
    const layout = (t) => {
      let y = 0;
      const out = [];
      for (const r of rows) {
        if (t < r.b.at) break;
        const typing = r.dots && t < r.showAt;
        const h = typing ? r.dotsH : r.msgH;
        out.push({ r, y, typing });
        y += h;
      }
      return { items: out, total: y };
    };
    const offsetAt = (t) => Math.max(0, layout(t).total - areaH);
    const events = [];
    rows.forEach((r) => { events.push(r.b.at); if (r.dots) events.push(r.showAt); });

    return (t) => {
      const L = layout(t);
      const visible = new Set(L.items.map((x) => x.r));
      let typingNow = false;
      for (const r of rows) {
        if (!visible.has(r)) { r.row.style.display = 'none'; continue; }
        r.row.style.display = 'flex';
      }
      for (const { r, y, typing } of L.items) {
        r.row.style.top = y + 'px';
        if (typing) {
          typingNow = true;
          r.bubble.style.display = 'none';
          r.dots.style.display = 'flex';
          R.appear(r.dots, R.prog(t, r.b.at, 0.18), { dy: 20, scale: 0.9 });
          r.dots.querySelectorAll('i').forEach((d, k) => {
            const ph = ((t - r.b.at) * 2.6 - k * 0.18) % 1;
            d.style.transform = `translateY(${-10 * Math.max(0, Math.sin(ph * Math.PI * 2))}px)`;
            d.style.opacity = String(0.45 + 0.55 * Math.max(0, Math.sin(ph * Math.PI * 2)));
          });
        } else {
          if (r.dots) r.dots.style.display = 'none';
          r.bubble.style.display = '';
          const p = R.prog(t, r.showAt, 0.32, R.ease.outBack);
          R.appear(r.bubble, p, { dy: 26, scale: 0.86 });
        }
      }
      status.textContent = typingNow ? data.ai_name + ' is typing…' : 'online';
      status.classList.toggle('typing', typingNow);
      // Smooth scroll when the list grows past the area.
      const e = events.filter((x) => x <= t).pop();
      let off = offsetAt(t);
      if (e !== undefined) {
        const prev = offsetAt(e - 1e-3);
        off = R.lerp(prev, off, R.prog(t, e, 0.3, R.ease.outCubic));
      }
      list.style.transform = `translateY(${-off}px)`;
    };
  },
});
