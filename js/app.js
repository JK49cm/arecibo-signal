import { renderMode, gridBitsForText, decodeGridBits, textToBits, bitsToText, mulberry32, PALETTES } from './cropcircle.js';

// Anonymous use counter (DEPLOY_PLAN section 2). Empty = not connected: nothing is sent anywhere.
// When our own first-party endpoint exists (see counter-worker/), set it here, e.g. 'https://count.arecibosignal.com'.
// Only the "download" and "share" buttons send one content-less POST /hit?k=download|share.
// No cookies, no IP storage, no user text.
const COUNTER_URL = '';

const SITE = 'arecibosignal.com';
const CANONICAL_URL = 'https://arecibosignal.com/';
const WATERMARK = `${SITE} · #AreciboReply`;
const DEFAULT_SHARE_TEXT = 'I pressed my own crop circle. Can you decode it? #AreciboReply';
const DEFAULT_MSG = 'WE ARE HERE // 1679';
const MAX_CHARS = 120;
const MODES = ['grid', 'ring', 'arecibo'];
const BLOCK_MSG = '請放一句話，不放連結或地址 · Please use a sentence — no links or addresses.';
const PROMO_MSG = '請放一句話，不放推銷用語 · Please use a sentence — no promotional wording.';
const LONG_MSG = '太長了：中文約 85 字以內 · Too long for the grid (max 255 bytes; about 85 CJK characters).';
const guardMsg = s => isBlocked(s) === 'promo' ? PROMO_MSG : BLOCK_MSG;

const $ = s => document.querySelector(s);
const canvas = $('#cc');           // preview = exactly the 1200x1200 download
const art = document.createElement('canvas');
let state = null;                  // { mode, night, text, bits, challengeView }

// ---------- input guard: no links, no wallet addresses ----------
const URL_RE = /(https?:|ftp:|:\/\/|www\.|\bt\.me\b)/i;
const DOMAIN_RE = /[a-z0-9\u00a1-\uffff-]\s*[.。]\s*(com|net|org|io|xyz)\b/i;     // "scam . com", "詐騙。com"
const HOSTLIKE_RE = /\b[a-z0-9-]{2,63}[.。][a-z]{2,24}(\/|\b)/i;                    // e.g. scam.example
const SOL_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;                // base58, Solana-style
const looksLikeAddr = x => /\d/.test(x) && /[A-Z]/.test(x) && /[a-z]/.test(x);
const EVM_RE = /0x[0-9a-fA-F]{32,}/;
function despacedAddress(s) {
  const t = s.replace(/[\s\-_.·]/g, '');
  const m = t.match(/[1-9A-HJ-NP-Za-km-z]{32,}/g) || [];
  return m.some(x => /\d.*\d.*\d/.test(x) && /[A-Z]/.test(x) && /[a-z]/.test(x));
}
// ---------- scam / promo wording (audit #gen1 section 25) ----------
// Case-insensitive; full-width folded by NFKC; zero-width chars removed; letters may be split by spaces or symbols.
const SEP = '[^\\p{L}\\p{N}]{0,3}';
const spaced = w => [...w].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(SEP);
const PROMO_RES = [
  new RegExp(`(?<![\\p{L}\\p{N}])${spaced('presale')}`, 'iu'),
  new RegExp(`(?<![\\p{L}\\p{N}])${spaced('airdrop')}`, 'iu'),
  new RegExp(`(?<![\\p{L}\\p{N}])${spaced('dmme')}(?![\\p{L}])`, 'iu'),
  new RegExp(`(?<![\\p{L}\\p{N}])${spaced('ca')}\\s*:`, 'iu'),
  new RegExp(`(${spaced('預售')}|${spaced('预售')}|${spaced('空投')})`, 'u'),
  new RegExp(`${spaced('arecibo')}${SEP}(${spaced('token')}|${spaced('coin')}|${spaced('代幣')}|${spaced('代币')}|幣|币)`, 'iu'),
  /\$\s*[A-Za-z][A-Za-z0-9]{0,9}(?![A-Za-z0-9])/,      // $ABC, $ abc
  /\$\s*[A-Z](?:\s+[A-Z0-9]){1,9}(?![A-Za-z0-9])/,     // $ A B C
];
function isPromo(s) { return PROMO_RES.some(r => r.test(s)); }

// returns '' (ok), 'link' or 'promo'
export function isBlocked(s) {
  s = s.normalize('NFKC').replace(/[\p{Cf}]/gu, '');
  if (URL_RE.test(s) || DOMAIN_RE.test(s) || HOSTLIKE_RE.test(s) || (s.match(SOL_RE) || []).some(looksLikeAddr) || EVM_RE.test(s) || despacedAddress(s)) return 'link';
  return isPromo(s) ? 'promo' : '';
}

// ---------- base64url ----------
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
// Challenge links carry only the bits, packed and XOR-masked so the URL never shows the sentence in plain base64.
// (Not encryption: the bits are the puzzle itself and can always be read off the picture.)
function mask(bytes) { const r = mulberry32(0xA2EC1B0); return bytes.map(b => b ^ Math.floor(r() * 256)); }
function packBits(bits) {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') out[i >> 3] |= 128 >> (i & 7);
  return mask(out);
}
function unpackBits(bytes, n) {
  bytes = mask(bytes); let s = '';
  for (let i = 0; i < n; i++) s += (bytes[i >> 3] & (128 >> (i & 7))) ? '1' : '0';
  return s;
}

// ---------- rendering ----------
function bgFor(night) {
  const p = night ? PALETTES.night : PALETTES.day;
  return p.field.map((v, i) => Math.round(v * 0.15 + p.dark[i] * 0.85));
}
function infoLabel(mode, bits) {
  if (mode === 'arecibo') return '1679 bits | 73x23 | ARECIBO 1974-11-16';
  return mode === 'grid' ? `${bits.length} bits | 23-col grid | utf-8` : `${bits.length} bits | rings 16+8n | utf-8 | start=12h`;
}
function compose(target, W, H) {
  const pal = state.night ? PALETTES.night : PALETTES.day;
  target.width = W; target.height = H;
  const ctx = target.getContext('2d');
  const bg = bgFor(state.night);
  ctx.fillStyle = `rgb(${bg})`; ctx.fillRect(0, 0, W, H);
  const maxH = H > W ? H * 0.82 : H;
  const k = Math.min(W / art.width, maxH / art.height);
  const dw = art.width * k, dh = art.height * k;
  if (dw < W - 1 || dh < H - 1) {
    // empty area keeps the flat field colour; the art's edges are feathered into it
    const f = document.createElement('canvas'); f.width = Math.round(dw); f.height = Math.round(dh);
    const fx = f.getContext('2d'); fx.drawImage(art, 0, 0, f.width, f.height);
    fx.globalCompositeOperation = 'destination-in';
    const vert = dh < H - 1, e = 0.08;
    const g = vert ? fx.createLinearGradient(0, 0, 0, f.height) : fx.createLinearGradient(0, 0, f.width, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(e, 'rgba(0,0,0,1)'); g.addColorStop(1 - e, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    fx.fillStyle = g; fx.fillRect(0, 0, f.width, f.height);
    ctx.drawImage(f, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } else {
    ctx.drawImage(art, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  const fs = Math.max(14, Math.floor(W / 52));
  ctx.font = `${fs}px "DejaVu Sans Mono", ui-monospace, monospace`;
  ctx.textBaseline = 'bottom';
  ctx.shadowColor = state.night ? 'rgba(0,0,0,.9)' : 'rgba(236,222,170,.7)'; ctx.shadowBlur = 4;
  ctx.fillStyle = `rgb(${pal.text})`;
  ctx.textAlign = 'right'; ctx.fillText(WATERMARK, W * 0.98, H * 0.985);            // watermark, bottom-right
  ctx.font = `${Math.floor(fs * 0.8)}px "DejaVu Sans Mono", ui-monospace, monospace`;
  ctx.textAlign = 'left'; ctx.fillText(infoLabel(state.mode, state.bits), W * 0.02, H * 0.985); // bit count only, never the sentence
}

function setButtons(on) { for (const id of ['#dl', '#dlv', '#share', '#copy']) $(id).disabled = !on; }

function render(mode, night, text, challengeView) {
  // Encoding is untouched: renderMode() from cropcircle.js does all bit work.
  const r = renderMode(art, mode, text, { size: 1200, night, seed: 1679, label: false });
  state = { mode, night, text, bits: r.bits, challengeView };
  compose(canvas, 1200, 1200);
  $('#bitinfo').textContent = `${r.bits.length} bits`;
  $('#err').textContent = '';
  setButtons(true);
  updateLink();
}

function draw() {
  const mode = $('#mode').value, night = $('#night').checked;
  const raw = $('#msg').value.trim();
  const text = raw || DEFAULT_MSG;
  $('#bits').value = '';
  if (mode !== 'arecibo' && (isBlocked(text) || text.length > MAX_CHARS)) {
    state = null; setButtons(false); $('#sharelink').value = ''; $('#err').textContent = text.length > MAX_CHARS ? LONG_MSG : guardMsg(text); return;
  }
  try { render(mode, night, text, false); }
  catch (e) { state = null; setButtons(false); $('#sharelink').value = ''; $('#err').textContent = e.message === 'max 255 bytes' ? LONG_MSG : e.message; }
}

// ---------- share links (#...) ----------
function baseUrl() {
  return /^https?:$/.test(location.protocol) ? location.origin + location.pathname : CANONICAL_URL;
}
function hashFor() {
  const n = state.night ? 1 : 0;
  if (state.mode === 'arecibo') return `s=arecibo&n=${n}`;
  const challenge = state.challengeView || $('#challenge').checked;
  if (challenge) return `b=${b64u(packBits(state.bits))}&l=${state.bits.length}&s=${state.mode}&n=${n}`;
  return `m=${b64u(new TextEncoder().encode(state.text))}&s=${state.mode}&n=${n}`;
}
function shareLink() { return `${baseUrl()}#${hashFor()}`; }
function updateLink() { $('#sharelink').value = state ? shareLink() : ''; }

function textFromBits(mode, bits) {
  if (mode === 'grid') {
    if (bits.length % 23) throw new Error('bad length');
    const t = decodeGridBits(bits);
    if (gridBitsForText(t) !== bits) throw new Error('not a valid grid');
    return t;
  }
  if (bits.length % 8) throw new Error('bad length');
  const t = bitsToText(bits);
  if (textToBits(t) !== bits) throw new Error('not valid utf-8');
  return t;
}

function loadHash() {
  const h = location.hash.slice(1);
  if (!h || !/[bms]=/.test(h)) return false;
  const p = new URLSearchParams(h);
  const mode = MODES.includes(p.get('s')) ? p.get('s') : 'grid';
  const night = p.get('n') === '1';
  $('#mode').value = mode; $('#night').checked = night;
  try {
    if (mode === 'arecibo') { exitChallengeView(); render(mode, night, DEFAULT_MSG, false); return true; }
    if (p.has('b')) {
      const n = parseInt(p.get('l'), 10);
      if (!(n > 0 && n <= 4096)) throw new Error('bad length');
      const bits = unpackBits(unb64u(p.get('b')), n);
      const text = textFromBits(mode, bits);
      if (!text || text.length > MAX_CHARS || isBlocked(text)) throw new Error('blocked');
      enterChallengeView();
      render(mode, night, text, true);   // the sentence stays in memory only; never written to the page
      return true;
    }
    if (p.has('m')) {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(unb64u(p.get('m')));
      if (!text || text.length > MAX_CHARS || isBlocked(text)) throw new Error('blocked');
      exitChallengeView();
      $('#msg').value = text; $('#challenge').checked = false;
      render(mode, night, text, false);
      return true;
    }
  } catch (e) {
    exitChallengeView();
    $('#err').textContent = '這個分享連結無法開啟 · This share link cannot be opened.';
    state = null; setButtons(false);
    return true;
  }
  return false;
}

function enterChallengeView() {
  document.body.classList.add('challenge-view');
  $('#msg').value = ''; $('#msg').disabled = true; $('#mode').disabled = true;
  $('#challenge').checked = true; $('#challenge').disabled = true;
  $('#bits').value = ''; $('#cvbanner').hidden = false;
}
function exitChallengeView() {
  document.body.classList.remove('challenge-view');
  $('#msg').disabled = false; $('#mode').disabled = false; $('#challenge').disabled = false;
  $('#cvbanner').hidden = true;
}

// ---------- actions ----------
function ping(kind) {
  if (!COUNTER_URL) return;   // not connected: send nothing
  try { navigator.sendBeacon(`${COUNTER_URL}/hit?k=${encodeURIComponent(kind)}`); } catch (_) {}
}
function save(c, name) {
  const a = document.createElement('a');
  a.download = name; a.href = c.toDataURL('image/png'); a.click();
}
function download() {
  if (!state) return;
  save(canvas, `arecibo-cropcircle-${state.mode}-1200x1200.png`); ping('download');
}
function downloadVertical() {
  if (!state) return;
  const c = document.createElement('canvas'); compose(c, 1080, 1920);
  save(c, `arecibo-cropcircle-${state.mode}-1080x1920.png`); ping('download');
}
function shareX() {
  if (!state) return;
  let text = $('#sharetext').value.trim() || DEFAULT_SHARE_TEXT;
  if (isBlocked(text)) { $('#err').textContent = guardMsg(text); return; }
  const u = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareLink())}`;
  window.open(u, '_blank', 'noopener');
  ping('share');
}
async function copyLink() {
  if (!state) return;
  try { await navigator.clipboard.writeText(shareLink()); $('#copied').textContent = '已複製 · Copied'; }
  catch (_) { $('#sharelink').select(); $('#copied').textContent = ''; }
}
function showBits() {
  if (!state || state.challengeView) return;
  const cols = state.mode === 'ring' ? 32 : 23;
  const rows = [];
  for (let i = 0; i < state.bits.length; i += cols) rows.push(state.bits.slice(i, i + cols));
  $('#bits').value = rows.join('\n');
}
function decode() {
  try { $('#decoded').textContent = decodeGridBits($('#decin').value); }
  catch (e) { $('#decoded').textContent = '✗ ' + e.message; }
}

$('#sharetext').value = DEFAULT_SHARE_TEXT;
$('#mode').addEventListener('change', draw);
$('#night').addEventListener('change', () => state && state.challengeView ? render(state.mode, $('#night').checked, state.text, true) : draw());
$('#challenge').addEventListener('change', updateLink);
$('#msg').addEventListener('input', () => { clearTimeout(window._t); window._t = setTimeout(draw, 250); });
$('#dl').addEventListener('click', download);
$('#dlv').addEventListener('click', downloadVertical);
$('#share').addEventListener('click', shareX);
$('#copy').addEventListener('click', copyLink);
$('#showbits').addEventListener('click', showBits);
$('#makeown').addEventListener('click', () => {
  history.replaceState(null, '', location.pathname); exitChallengeView();
  $('#challenge').checked = false; $('#msg').value = DEFAULT_MSG; draw();
});
$('#decbtn').addEventListener('click', decode);
$('#decdemo').addEventListener('click', () => {
  const b = gridBitsForText('HELLO EARTH');
  $('#decin').value = b.match(/.{1,23}/g).join('\n');
  decode();
});
window.addEventListener('hashchange', () => { if (!loadHash()) draw(); });
if (!loadHash()) draw();
