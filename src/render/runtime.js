/*
 * Reel runtime (browser side).
 *
 * Every template is a pure function of time: build(root, ctx) returns update(t), and update(t)
 * must set every animated property from t alone (no CSS transitions, no timers, no Date.now()).
 * The renderer drives a virtual clock with seek(t) frame by frame, so output is deterministic and
 * frames can be captured in parallel and in any order.
 */
(() => {
  const R = (window.Reel = {});
  R.templates = {};
  R.register = (id, impl) => (R.templates[id] = impl);

  // ---------- math / easing ----------
  R.clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  R.lerp = (a, b, p) => a + (b - a) * p;
  R.ease = {
    linear: (p) => p,
    inQuad: (p) => p * p,
    outQuad: (p) => 1 - (1 - p) * (1 - p),
    outCubic: (p) => 1 - Math.pow(1 - p, 3),
    inCubic: (p) => p * p * p,
    inOutCubic: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    outBack: (p) => {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
    },
    outElastic: (p) => (p === 0 || p === 1 ? p : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  };
  /** Eased progress of an animation that starts at `start` and lasts `dur` seconds. */
  R.prog = (t, start, dur, ease = R.ease.outCubic) => ease(R.clamp((t - start) / Math.max(dur, 1e-6)));
  /** Deterministic pseudo-random in [-1, 1] for (t, seed): used for shake / glitch. */
  R.noise = (t, seed = 1) => {
    const x = Math.sin(t * 91.7 * seed + seed * 12.9898) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  };
  /** Quantised noise: changes value `hz` times per second (looks like a jittery glitch). */
  R.jitter = (t, hz = 24, seed = 1) => R.noise(Math.floor(t * hz) / hz, seed);

  // ---------- DOM helpers ----------
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  /** Escape text and turn *word* into an accent-coloured <em>. */
  R.rich = (s) => esc(s).replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/\n/g, '<br>');
  R.el = (tag, cls, parent, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  };
  /** Text revealed by typing progress p (emoji-safe). */
  R.typed = (s, p) => {
    const chars = Array.from(s);
    return chars.slice(0, Math.round(chars.length * R.clamp(p))).join('');
  };
  /** Shrink font-size until the element's content fits its box. Call at build time (fonts are loaded). */
  R.fit = (el, max, min = 30, step = 2) => {
    let size = max;
    el.style.fontSize = size + 'px';
    while (size > min && (el.scrollHeight > el.clientHeight + 6 || el.scrollWidth > el.clientWidth + 2)) {
      size -= step;
      el.style.fontSize = size + 'px';
    }
    return size;
  };
  /** Shrink until the element's text is no wider than its box (ignores vertical glyph overflow). */
  R.fitWidth = (el, max, min = 30, step = 2) => {
    let size = max;
    el.style.fontSize = size + 'px';
    while (size > min && el.scrollWidth > el.clientWidth + 2) {
      size -= step;
      el.style.fontSize = size + 'px';
    }
    return size;
  };
  /** Shrink until the element is at most `maxH` px tall (for auto-height elements). */
  R.fitHeight = (el, max, maxH, min = 30, step = 2) => {
    let size = max;
    el.style.fontSize = size + 'px';
    while (size > min && (el.getBoundingClientRect().height > maxH || el.scrollWidth > el.clientWidth + 2)) {
      size -= step;
      el.style.fontSize = size + 'px';
    }
    return size;
  };
  /**
   * Scale the font sizes of `els` together (from their current computed sizes) to the largest factor in
   * [minK, maxK] at which `box` is at most `maxH` px tall. Used to fill the screen with big text.
   */
  R.scaleToFit = (box, els, maxH, minK = 0.6, maxK = 1.4) => {
    const base = els.map((e) => parseFloat(getComputedStyle(e).fontSize));
    const apply = (k) => els.forEach((e, i) => (e.style.fontSize = Math.round(base[i] * k) + 'px'));
    let k = maxK;
    apply(k);
    while (k > minK && box.getBoundingClientRect().height > maxH) {
      k -= 0.03;
      apply(k);
    }
    return k;
  };
  /** Apply a standard "appear" state: fade + rise + slight scale. p in [0,1]. */
  R.appear = (el, p, { dy = 40, scale = 0.96, dx = 0 } = {}) => {
    el.style.opacity = String(R.clamp(p * 1.4));
    // At rest: no transform at all, so text is rasterised exactly like a fresh page (deterministic frames).
    if (p >= 1) {
      el.style.transform = 'none';
      return;
    }
    const s = R.lerp(scale, 1, p);
    el.style.transform = `translate(${R.lerp(dx, 0, p)}px, ${R.lerp(dy, 0, p)}px) scale(${s})`;
  };
  /** translateY snapped to whole pixels (fractional offsets make static text shimmer between frames). */
  R.ty = (y) => (Math.abs(y) < 0.5 ? 'none' : `translateY(${Math.round(y)}px)`);
  R.show = (el, on) => (el.style.visibility = on ? 'visible' : 'hidden');

  // ---------- background ----------
  /** Paint glow + scanlines (static) and the grid (moving) into canvases, using theme.css variables. */
  R.paintBackground = (bg) => {
    const cs = getComputedStyle(document.getElementById('stage'));
    const v = (n, d) => (cs.getPropertyValue(n).trim() || d);
    const accent = v('--accent', '#3dff8f');
    const W = 1080, H = 1920;
    const glow = R.el('canvas', null, bg);
    glow.width = W; glow.height = H;
    const g = glow.getContext('2d');
    g.fillStyle = v('--bg', '#07090a');
    g.fillRect(0, 0, W, H);
    const radial = (cx, cy, r, alpha) => {
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, accent);
      grd.addColorStop(1, 'transparent');
      g.globalAlpha = alpha;
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    };
    radial(W / 2, -200, 1150, parseFloat(v('--bg-glow-top', '0.17')));
    radial(W / 2, H + 250, 950, parseFloat(v('--bg-glow-bottom', '0.08')));
    g.fillStyle = `rgba(255,255,255,${parseFloat(v('--bg-scan-alpha', '0.018'))})`;
    for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 2);
    const cell = parseFloat(v('--bg-grid-size', '60'));
    const grid = R.el('canvas', null, bg);
    grid.width = W; grid.height = H + cell * 2;
    const q = grid.getContext('2d');
    q.globalAlpha = parseFloat(v('--bg-grid-alpha', '0.07'));
    q.fillStyle = accent;
    for (let x = 0; x <= W; x += cell) q.fillRect(x, 0, 1, grid.height);
    for (let y = 0; y <= grid.height; y += cell) q.fillRect(0, y, W, 1);
    grid.cell = cell;
    return grid;
  };

  // ---------- boot ----------
  R.boot = async () => {
    const spec = window.__SPEC__;
    const tl = window.__TIMELINE__;
    const stage = document.getElementById('stage');
    stage.dataset.accent = spec.accent || 'green';
    if (document.fonts && document.fonts.ready) await document.fonts.ready;

    const grid = R.paintBackground(document.getElementById('bg'));
    const hook = document.getElementById('hook');
    const content = document.getElementById('content');
    const fx = document.getElementById('fx');
    const wm = document.getElementById('wm');
    const cur = wm.querySelector('.cur');

    hook.innerHTML = R.rich(spec.hook);
    hook.style.maxHeight = 'none';
    // Biggest size (≤ 84px) at which the hook fits in 3 lines / 290px.
    R.fitHeight(hook, 84, 290, 48);
    const hookRect = hook.getBoundingClientRect();
    const contentTop = Math.round(hookRect.bottom + 40);
    content.style.top = contentTop + 'px';

    const ctx = { spec, data: spec.data, tl, beats: tl.beats, fx, stage, R, width: content.clientWidth, height: content.clientHeight };
    const impl = R.templates[spec.template];
    if (!impl) throw new Error('Template not registered: ' + spec.template);
    const update = impl.build(content, ctx);

    const D = tl.duration;
    const gridCycles = Math.max(1, Math.round(D / 5));
    const blinkPeriod = D / Math.max(1, Math.round(D / 1.0));

    R.seek = (t) => {
      R.t = t;
      // Ambient background: moves exactly N grid cells over the reel so the last frame matches the first.
      grid.style.transform = `translateY(${(((t / D) * grid.cell * gridCycles) % grid.cell) - grid.cell}px)`;
      // Hook
      if (tl.hookIn > 0) {
        const p = R.prog(t, 0, tl.hookIn, R.ease.outCubic);
        hook.style.opacity = String(R.clamp(p * 1.2));
        hook.style.transform = `translateY(${R.lerp(14, 0, p)}px) scale(${R.lerp(0.97, 1, p)})`;
      } else {
        hook.style.opacity = '1';
        hook.style.transform = 'none';
      }
      // Watermark cursor
      cur.style.opacity = (t % blinkPeriod) < blinkPeriod / 2 ? '1' : '0';
      // Template
      update(t);
      // Loop tail: everything the template added fades back to the empty first-frame state.
      if (tl.loop && t > tl.contentEnd) {
        const p = R.prog(t, tl.contentEnd, tl.loopTail - 1 / tl.fps, R.ease.inOutCubic);
        content.style.opacity = String(1 - p);
        content.style.transform = `translateY(${-24 * p}px)`;
        fx.style.opacity = String(1 - p);
      } else {
        content.style.opacity = '1';
        content.style.transform = 'none';
        fx.style.opacity = '1';
      }
    };

    R.seek(0);
    window.__reel = { ready: true, seek: R.seek, duration: D, fps: tl.fps, qa: R.qa };
    if (window.__PREVIEW__) R.mountPreview();
  };

  // ---------- QA: safe zones + readability ----------
  /** Visible text elements outside Instagram's safe zones, and the smallest key font size. */
  R.qa = (safe) => {
    const W = 1080, H = 1920;
    const zone = { left: 0, top: safe.top, right: W - safe.right, bottom: H - safe.bottom };
    const out = [];
    let minFont = Infinity;
    const visible = (el) => {
      for (let e = el; e && e.id !== 'stage'; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.15) return false;
      }
      return true;
    };
    const walker = document.createTreeWalker(document.getElementById('stage'), NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim()) continue;
      const el = node.parentElement;
      if (!el || seen.has(el) || el.closest('#wm') || el.closest('.deco')) continue;
      seen.add(el);
      if (!visible(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const b = range.getBoundingClientRect();
      // Visible part only: intersect with every clipping ancestor (overflow hidden/clip).
      const r = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
      for (let e = el; e && e.id !== 'stage'; e = e.parentElement) {
        const ov = getComputedStyle(e).overflow;
        if (ov.includes('hidden') || ov.includes('clip')) {
          const c = e.getBoundingClientRect();
          r.left = Math.max(r.left, c.left); r.top = Math.max(r.top, c.top);
          r.right = Math.min(r.right, c.right); r.bottom = Math.min(r.bottom, c.bottom);
        }
      }
      if (r.right - r.left < 2 || r.bottom - r.top < 2) continue;
      if (r.right < 0 || r.left > W || r.bottom < 0 || r.top > H) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (!el.closest('.small-ok')) minFont = Math.min(minFont, fs);
      const tol = 3;
      const bad = [];
      if (r.top < zone.top - tol) bad.push(`top ${Math.round(r.top)}<${zone.top}`);
      if (r.bottom > zone.bottom + tol) bad.push(`bottom ${Math.round(r.bottom)}>${zone.bottom}`);
      if (r.right > zone.right + tol) bad.push(`right ${Math.round(r.right)}>${zone.right}`);
      if (r.left < zone.left - tol) bad.push(`left ${Math.round(r.left)}<0`);
      if (bad.length) out.push({ text: node.textContent.trim().slice(0, 40), where: bad.join(', ') });
    }
    const hook = document.getElementById('hook');
    return {
      violations: out,
      minFontPx: minFont === Infinity ? null : minFont,
      hookOpacity: parseFloat(getComputedStyle(hook).opacity),
    };
  };

  // ---------- preview UI (npm run preview) ----------
  R.mountPreview = () => {
    const tl = window.__TIMELINE__;
    const D = tl.duration;
    const wrap = document.getElementById('wrap');
    const bar = document.getElementById('bar');
    const range = bar.querySelector('input[type=range]');
    const label = bar.querySelector('.time');
    const playBtn = bar.querySelector('.play');
    const safeBtn = bar.querySelector('.safe');
    const overlay = document.getElementById('safe-overlay');
    const fit = () => {
      const s = Math.min((window.innerHeight - 70) / 1920, (window.innerWidth - 20) / 1080);
      wrap.style.transform = `scale(${s})`;
      wrap.parentElement.style.width = 1080 * s + 'px';
      wrap.parentElement.style.height = 1920 * s + 'px';
    };
    fit();
    window.addEventListener('resize', fit);
    let playing = true, t0 = performance.now(), offset = 0;
    const setT = (t) => {
      R.seek(t);
      range.value = String(t);
      label.textContent = `${t.toFixed(2)}s / ${D}s · beat ${1 + tl.beats.filter((b) => b.at <= t).length - 1 || 0}`;
    };
    const tick = () => {
      if (playing) setT((((performance.now() - t0) / 1000 + offset) % D));
      requestAnimationFrame(tick);
    };
    range.max = String(D);
    range.addEventListener('input', () => { playing = false; playBtn.textContent = '▶ play'; setT(parseFloat(range.value)); });
    playBtn.addEventListener('click', () => {
      playing = !playing;
      playBtn.textContent = playing ? '❚❚ pause' : '▶ play';
      if (playing) { offset = parseFloat(range.value); t0 = performance.now(); }
    });
    safeBtn.addEventListener('click', () => overlay.classList.toggle('on'));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); playBtn.click(); }
      if (e.key === 's') safeBtn.click();
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        playing = false; playBtn.textContent = '▶ play';
        setT(R.clamp(parseFloat(range.value) + (e.key === 'ArrowRight' ? 1 : -1) / tl.fps, 0, D));
      }
    });
    tick();
    // Live reload when the spec file changes
    let version = window.__VERSION__;
    setInterval(async () => {
      try {
        const v = await (await fetch('/__version')).text();
        if (version && v !== version) location.reload();
        version = v;
      } catch {}
    }, 800);
  };
})();
