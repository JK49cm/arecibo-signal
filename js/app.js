import { renderMode, gridBitsForText, decodeGridBits } from './cropcircle.js';

// Anonymous use counter. Empty = not connected yet (nothing is sent anywhere).
// When our own first-party endpoint exists (see counter-worker/), set it here, e.g. 'https://count.arecibosignal.com'.
// It receives only "one more image was generated" — no cookies, no IP storage, no user text.
const COUNTER_URL = '';

const $ = s => document.querySelector(s);
const canvas = $('#cc');
let last = null;

function draw() {
  const mode = $('#mode').value, night = $('#night').checked;
  let text = $('#msg').value.trim() || 'WE ARE HERE // 1679';
  try {
    last = renderMode(canvas, mode, text, { size: 1200, night, seed: 1679 });
    $('#bitinfo').textContent = `${last.bits.length} bits`;
    $('#err').textContent = '';
  } catch (e) { $('#err').textContent = e.message; }
}
function ping(kind) {
  if (!COUNTER_URL) return;
  try { navigator.sendBeacon(`${COUNTER_URL}/hit?k=${encodeURIComponent(kind)}`); } catch (_) {}
}
function download() {
  const a = document.createElement('a');
  a.download = `arecibo-cropcircle-${$('#mode').value}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
  ping('download');
}
function showBits() {
  if (!last) return;
  const cols = $('#mode').value === 'ring' ? 32 : 23;
  const rows = [];
  for (let i = 0; i < last.bits.length; i += cols) rows.push(last.bits.slice(i, i + cols));
  $('#bits').value = rows.join('\n');
}
function decode() {
  try { $('#decoded').textContent = decodeGridBits($('#decin').value); }
  catch (e) { $('#decoded').textContent = '✗ ' + e.message; }
}

$('#mode').addEventListener('change', draw);
$('#night').addEventListener('change', draw);
$('#msg').addEventListener('input', () => { clearTimeout(window._t); window._t = setTimeout(draw, 250); });
$('#dl').addEventListener('click', download);
$('#showbits').addEventListener('click', showBits);
$('#decbtn').addEventListener('click', decode);
$('#decdemo').addEventListener('click', () => {
  const b = gridBitsForText('HELLO EARTH');
  $('#decin').value = b.match(/.{1,23}/g).join('\n');
  decode();
});
draw();
