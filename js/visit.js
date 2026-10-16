// Cookie-free page-visit counter (AN333). Sends one content-free +1 to Abacus.
// Keys: visit (all) + visit-<utm_source> (whitelisted). No cookies, no storage, no text, no wallet.
(function () {
  var BASE = 'https://abacus.jasoncameron.dev/hit/arecibosignal/';
  var OK = ['bluesky', 'mastodon', 'lemmy', 'x', 'telegram'];
  function hit(k) {
    try { fetch(BASE + k, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', keepalive: true }).catch(function () {}); } catch (e) {}
  }
  var src = '';
  try { src = (new URLSearchParams(location.search).get('utm_source') || '').toLowerCase(); } catch (e) {}
  hit('visit');
  hit('visit-' + (OK.indexOf(src) >= 0 ? src : (src ? 'other' : 'direct')));
})();
