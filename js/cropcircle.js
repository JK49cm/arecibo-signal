// ARECIBO crop-circle renderer (browser port of arecibo_art/gen_arecibo_cropcircle.py).
// Bit 1 = flattened (pressed) crop, bit 0 = standing crop. Pure client-side; no network.
import { ARECIBO_BITS } from './arecibo-bits.js';

export const PALETTES = {
  day:   { field: [176,150,74], dark: [132,108,48], flat: [236,222,170], edge: [205,186,128], tram: [150,126,60], text: [60,45,20] },
  night: { field: [28,34,30],   dark: [14,18,16],   flat: [170,245,210], edge: [60,160,130],  tram: [40,50,44],  text: [170,245,210] },
};
const START = '10101011';

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function textToBits(text) {
  return Array.from(new TextEncoder().encode(text), b => b.toString(2).padStart(8, '0')).join('');
}
export function bitsToText(bits) {
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(out));
}
// Grid format (identical to the Python generator): header row = 8-bit byte length + 7 zero bits + start marker.
export function gridBitsForText(text, cols = 23) {
  const n = new TextEncoder().encode(text).length;
  if (n > 255) throw new Error('max 255 bytes');
  let body = textToBits(text);
  body += '0'.repeat((cols - (body.length % cols)) % cols);
  return n.toString(2).padStart(8, '0') + '0'.repeat(7) + START + body;
}
export function decodeGridBits(bits, cols = 23) {
  bits = bits.replace(/[^01]/g, '');
  if (bits.slice(15, 23) !== START) throw new Error('第 0 列找不到起始標記 10101011 · start marker 10101011 not found in row 0');
  const n = parseInt(bits.slice(0, 8), 2);
  return bitsToText(bits.slice(cols, cols + n * 8));
}

const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function wheatField(ctx, w, h, pal, rnd) {
  ctx.fillStyle = rgb(pal.field); ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 1;
  const n = Math.floor(w * h / 70);
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h, l = 3 + rnd() * 6, a = (60 + rnd() * 60) * Math.PI / 180, t = (rnd() - 0.5) * 44;
    ctx.strokeStyle = rgb(pal.field.map(v => Math.max(0, Math.min(255, v + t))));
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + l * Math.cos(a), y - l * Math.sin(a)); ctx.stroke();
  }
  // tramlines
  const gap = w / 7.5, off = rnd() * gap;
  ctx.strokeStyle = rgb(pal.tram); ctx.lineWidth = 3;
  for (let i = -1; i < 10; i++) {
    for (const dx of [0, 9]) {
      const x = off + i * gap + dx;
      ctx.beginPath(); ctx.moveTo(x - 0.06 * h, 0); ctx.lineTo(x + 0.06 * h, h); ctx.stroke();
    }
  }
  // vignette
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, rgb(pal.dark, 0)); g.addColorStop(1, rgb(pal.dark, 0.85));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

function disc(ctx, cx, cy, r, pal, rnd, swirl) {
  ctx.fillStyle = rgb(pal.edge); ctx.beginPath(); ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = rgb(pal.flat); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  if (swirl && r > 5) {
    ctx.strokeStyle = rgb(pal.edge); ctx.lineWidth = 1;
    for (let k = 0; k < 3; k++) {
      const rr = r * (0.35 + 0.22 * k), a0 = rnd() * Math.PI * 2;
      ctx.beginPath(); ctx.arc(cx, cy, rr, a0, a0 + 250 * Math.PI / 180); ctx.stroke();
    }
  }
}

function caption(ctx, w, h, txt, pal) {
  ctx.font = `${Math.max(12, Math.floor(w / 60))}px "DejaVu Sans Mono", ui-monospace, monospace`;
  ctx.fillStyle = rgb(pal.text); ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText(txt, w * 0.98, h * 0.985);
}

function withGlow(ctx, on, color, blur, fn) {
  ctx.save();
  if (on) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
  fn(); ctx.restore();
}

export function renderGrid(canvas, bits, { cols = 23, size = 1200, night = false, seed = 1679, label = '' } = {}) {
  const pal = night ? PALETTES.night : PALETTES.day, rnd = mulberry32(seed);
  const rows = Math.floor(bits.length / cols);
  let cell = size * 0.86 / Math.max(cols, rows * 0.55);
  cell = Math.min(cell, (size * 1.55 * 0.9) / rows);
  const gw = cell * cols, gh = cell * rows, W = size, H = Math.floor(Math.max(W, gh / 0.9));
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  wheatField(ctx, W, H, pal, rnd);
  const x0 = (W - gw) / 2, y0 = (H - gh) / 2;
  withGlow(ctx, night, rgb(pal.flat, 0.9), cell * 0.6, () => {
    for (let i = 0; i < rows * cols; i++) {
      if (bits[i] !== '1') continue;
      const r = Math.floor(i / cols), c = i % cols;
      disc(ctx, x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell, cell * 0.42, pal, rnd, cell > 18);
    }
  });
  ctx.strokeStyle = rgb(pal.edge); ctx.lineWidth = Math.max(2, cell * 0.12);
  ctx.beginPath(); ctx.roundRect(x0 - cell * 0.6, y0 - cell * 0.6, gw + cell * 1.2, gh + cell * 1.2, cell); ctx.stroke();
  if (label) caption(ctx, W, H, label, pal);
}

export function renderRing(canvas, bits, { size = 1200, night = false, seed = 1679, label = '' } = {}) {
  const pal = night ? PALETTES.night : PALETTES.day, rnd = mulberry32(seed);
  const W = size, H = size; canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  wheatField(ctx, W, H, pal, rnd);
  const cx = W / 2, cy = H / 2, rings = [];
  for (let idx = 0, n = 0; idx < bits.length; n++) { const s = 16 + 8 * n; rings.push(bits.slice(idx, idx + s).padEnd(s, '0')); idx += s; }
  const rCore = W * 0.07, band = (W * 0.40 - rCore) / Math.max(1, rings.length);
  withGlow(ctx, night, rgb(pal.flat, 0.9), W / 80, () => {
    ctx.fillStyle = rgb(pal.flat); ctx.strokeStyle = rgb(pal.edge); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, rCore, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    rings.forEach((ring, k) => {
      const r1 = rCore + band * (k + 0.18), r2 = rCore + band * (k + 0.92), step = 2 * Math.PI / ring.length;
      for (let j = 0; j < ring.length; j++) {
        if (ring[j] !== '1') continue;
        const a0 = -Math.PI / 2 + j * step + step * 0.06, a1 = a0 + step * 0.88;
        ctx.beginPath(); ctx.arc(cx, cy, r2, a0, a1); ctx.arc(cx, cy, r1, a1, a0, true); ctx.closePath();
        ctx.fillStyle = rgb(pal.flat); ctx.fill(); ctx.lineWidth = 1; ctx.stroke();
      }
    });
    const R = rCore + band * rings.length + band * 0.9;
    for (let j = 0; j < 8; j++) {
      const a = -Math.PI / 2 + j * Math.PI / 4;
      disc(ctx, cx + R * Math.cos(a), cy + R * Math.sin(a), W * (j === 0 ? 0.022 : 0.013), pal, rnd, true);
    }
    ctx.strokeStyle = rgb(pal.edge); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  });
  if (label) caption(ctx, W, H, label, pal);
}

export function renderMode(canvas, mode, text, opts = {}) {
  if (mode === 'arecibo') {
    renderGrid(canvas, ARECIBO_BITS, { ...opts, label: opts.label === false ? '' : '1679 bits | 73x23 | ARECIBO 1974-11-16' });
    return { bits: ARECIBO_BITS };
  }
  if (mode === 'grid') {
    const bits = gridBitsForText(text);
    if (decodeGridBits(bits) !== text) throw new Error('自我檢查沒通過，請換一句試試 · self-check failed');
    renderGrid(canvas, bits, { ...opts, label: opts.label === false ? '' : `${bits.length} bits | 23-col grid | utf-8` });
    return { bits };
  }
  const bits = textToBits(text);
  renderRing(canvas, bits, { ...opts, label: opts.label === false ? '' : `${bits.length} bits | rings 16+8n | utf-8 | start=12h` });
  return { bits };
}
