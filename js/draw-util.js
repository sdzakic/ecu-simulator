(function () {
  const ECU = window.ECU;

  // Resize a canvas to its CSS width (and given CSS height) at device pixel ratio.
  function fit(canvas, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(50, canvas.clientWidth);
    const h = cssH;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = h + 'px';
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function rr(ctx, x, y, w, h, r) {
    w = Math.max(0, w); h = Math.max(0, h);
    r = Math.max(0, Math.min(r, w / 2, h / 2)); // arcTo throws on negative radii (e.g. zero-width canvas)
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function glow(ctx, color, blur) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  }
  function noGlow(ctx) {
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }

  // deterministic pseudo-noise
  function hash(n) {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  function mix(c1, c2, t) {
    const a = hex(c1), b = hex(c2);
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
  }
  function hex(c) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(c, a) {
    const h = hex(c);
    return `rgba(${h[0]},${h[1]},${h[2]},${a})`;
  }

  ECU.draw = { fit, rr, glow, noGlow, hash, mix, rgba };
  ECU.C = {
    bg: '#070b11', panel: '#0f1620', line: '#1d2836', line2: '#273547', text: '#dbe6f3', muted: '#7d8da3', dim: '#4d5d72',
    air: '#3fc6ff', hot: '#ff9f43', fuel: '#ffb020', exh: '#a2826c', spark: '#ffe45c', ok: '#3ee07a', warn: '#ffc043',
    bad: '#ff4d5e', info: '#62a8ff', cam: '#b98cff', accent: '#2ee6c5', metal: '#8a99ab', metalD: '#3b4859',
  };
})();
