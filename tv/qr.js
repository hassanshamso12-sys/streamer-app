/* QR codes for Streamer TV (sign in with your phone). Plain old JavaScript
 * for older TV browsers. Byte mode, error correction level M, versions 1-10
 * (up to 213 bytes: plenty for a link).
 *
 *   QR.make(text)          -> { size, dark: function (row, col) }
 *   QR.canvas(text, px)    -> <canvas> with a white border, about px wide
 */
(function () {
  'use strict';

  // ---------- Galois field 256 (polynomial 0x11D) ----------
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function gmul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }

  // Reed-Solomon error correction bytes for one block.
  var gens = {};
  function generator(n) {
    if (gens[n]) return gens[n];
    var g = [1];
    for (var i = 0; i < n; i++) {
      var next = new Array(g.length + 1);
      for (var k = 0; k < next.length; k++) next[k] = 0;
      for (var j = 0; j < g.length; j++) {
        next[j] ^= g[j];
        next[j + 1] ^= gmul(g[j], EXP[i]);
      }
      g = next;
    }
    gens[n] = g;
    return g;
  }
  function ecBytes(data, n) {
    var g = generator(n);
    var r = data.slice();
    for (var i = 0; i < n; i++) r.push(0);
    for (var p = 0; p < data.length; p++) {
      var c = r[p];
      if (!c) continue;
      for (var q = 0; q < g.length; q++) r[p + q] ^= gmul(g[q], c);
    }
    return r.slice(data.length);
  }

  // Level M per version: [ec bytes per block, blocks, data bytes per block,
  // blocks of the second kind, their data bytes].
  var BLOCKS = [null,
    [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0],
    [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]];
  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  function utf8(s) {
    var b = unescape(encodeURIComponent(s)), out = [];
    for (var i = 0; i < b.length; i++) out.push(b.charCodeAt(i));
    return out;
  }

  function codewords(bytes, v) {
    var t = BLOCKS[v];
    var total = t[1] * t[2] + t[3] * t[4];
    var bits = [];
    function put(num, len) { for (var i = len - 1; i >= 0; i--) bits.push((num >>> i) & 1); }
    put(4, 4); // byte mode
    put(bytes.length, v < 10 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) put(bytes[i], 8);
    if (bits.length + 4 <= total * 8) put(0, 4);
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (var b = 0; b < bits.length; b += 8) {
      var x = 0;
      for (var k = 0; k < 8; k++) x = (x << 1) | bits[b + k];
      data.push(x);
    }
    for (var pad = 0; data.length < total; pad++) data.push(pad % 2 ? 0x11 : 0xec);

    // Split into blocks, add error correction, interleave.
    var blocks = [], ecs = [], at = 0, n, m;
    for (n = 0; n < t[1] + t[3]; n++) {
      var len = n < t[1] ? t[2] : t[4];
      var d = data.slice(at, at + len);
      at += len;
      blocks.push(d);
      ecs.push(ecBytes(d, t[0]));
    }
    var out = [], most = Math.max(t[2], t[4]);
    for (m = 0; m < most; m++) {
      for (n = 0; n < blocks.length; n++) if (m < blocks[n].length) out.push(blocks[n][m]);
    }
    for (m = 0; m < t[0]; m++) {
      for (n = 0; n < ecs.length; n++) out.push(ecs[n][m]);
    }
    return out;
  }

  function bch(data, poly, shift) {
    var d = data << shift;
    var top = 0;
    while (poly >>> (top + 1)) top++;
    for (var i = shift + 10; i >= top; i--) if ((d >>> i) & 1) d ^= poly << (i - top);
    return (data << shift) | d;
  }

  var MASKS = [
    function (i, j) { return (i + j) % 2 === 0; },
    function (i) { return i % 2 === 0; },
    function (i, j) { return j % 3 === 0; },
    function (i, j) { return (i + j) % 3 === 0; },
    function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; },
    function (i, j) { return (i * j) % 2 + (i * j) % 3 === 0; },
    function (i, j) { return ((i * j) % 2 + (i * j) % 3) % 2 === 0; },
    function (i, j) { return ((i * j) % 3 + (i + j) % 2) % 2 === 0; }
  ];

  // One full symbol with the given mask. Cells: true/false, null = free.
  function build(v, words, mask) {
    var n = v * 4 + 17, r, c, i;
    var m = [];
    for (r = 0; r < n; r++) { m.push([]); for (c = 0; c < n; c++) m[r].push(null); }

    function finder(row, col) {
      for (var y = -1; y <= 7; y++) {
        for (var x = -1; x <= 7; x++) {
          if (row + y < 0 || row + y >= n || col + x < 0 || col + x >= n) continue;
          m[row + y][col + x] =
            (y >= 0 && y <= 6 && (x === 0 || x === 6)) ||
            (x >= 0 && x <= 6 && (y === 0 || y === 6)) ||
            (y >= 2 && y <= 4 && x >= 2 && x <= 4);
        }
      }
    }
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);

    var pos = ALIGN[v];
    for (i = 0; i < pos.length; i++) {
      for (var j = 0; j < pos.length; j++) {
        var ar = pos[i], ac = pos[j];
        if (m[ar][ac] !== null) continue;
        for (var y = -2; y <= 2; y++) {
          for (var x = -2; x <= 2; x++) {
            m[ar + y][ac + x] = y === -2 || y === 2 || x === -2 || x === 2 || (y === 0 && x === 0);
          }
        }
      }
    }

    for (i = 8; i < n - 8; i++) {
      if (m[i][6] === null) m[i][6] = i % 2 === 0;
      if (m[6][i] === null) m[6][i] = i % 2 === 0;
    }

    // Format: level M (00) and the mask.
    var f = bch(mask, 0x537, 10) ^ 0x5412;
    for (i = 0; i < 15; i++) {
      var on = ((f >>> i) & 1) === 1;
      if (i < 6) m[i][8] = on;
      else if (i < 8) m[i + 1][8] = on;
      else m[n - 15 + i][8] = on;
      if (i < 8) m[8][n - i - 1] = on;
      else if (i < 9) m[8][15 - i] = on;
      else m[8][14 - i] = on;
    }
    m[n - 8][8] = true;

    if (v >= 7) {
      var vb = bch(v, 0x1f25, 12);
      for (i = 0; i < 18; i++) {
        var bit = ((vb >>> i) & 1) === 1;
        m[Math.floor(i / 3)][i % 3 + n - 11] = bit;
        m[i % 3 + n - 11][Math.floor(i / 3)] = bit;
      }
    }

    // Data, in two-column zigzags from the bottom right.
    var test = MASKS[mask], byteAt = 0, bitAt = 7, row = n - 1, dir = -1;
    for (var col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (var k = 0; k < 2; k++) {
          if (m[row][col - k] !== null) continue;
          var dark = byteAt < words.length && ((words[byteAt] >>> bitAt) & 1) === 1;
          if (test(row, col - k)) dark = !dark;
          m[row][col - k] = dark;
          if (--bitAt < 0) { byteAt++; bitAt = 7; }
        }
        row += dir;
        if (row < 0 || row >= n) { row -= dir; dir = -dir; break; }
      }
    }
    return m;
  }

  // Lower is easier to scan (penalty rules from the QR standard).
  function penalty(m) {
    var n = m.length, p = 0, r, c, run, k;
    for (var pass = 0; pass < 2; pass++) {
      for (r = 0; r < n; r++) {
        run = 1;
        for (c = 1; c <= n; c++) {
          var same = c < n && (pass ? m[c][r] === m[c - 1][r] : m[r][c] === m[r][c - 1]);
          if (same) run++;
          else { if (run >= 5) p += run - 2; run = 1; }
        }
      }
    }
    for (r = 0; r < n - 1; r++) {
      for (c = 0; c < n - 1; c++) {
        var a = m[r][c];
        if (a === m[r][c + 1] && a === m[r + 1][c] && a === m[r + 1][c + 1]) p += 3;
      }
    }
    var pat1 = [true, false, true, true, true, false, true, false, false, false, false];
    var pat2 = [false, false, false, false, true, false, true, true, true, false, true];
    for (r = 0; r < n; r++) {
      for (c = 0; c + 11 <= n; c++) {
        var h1 = true, h2 = true, v1 = true, v2 = true;
        for (k = 0; k < 11; k++) {
          if (m[r][c + k] !== pat1[k]) h1 = false;
          if (m[r][c + k] !== pat2[k]) h2 = false;
          if (m[c + k][r] !== pat1[k]) v1 = false;
          if (m[c + k][r] !== pat2[k]) v2 = false;
        }
        p += 40 * ((h1 ? 1 : 0) + (h2 ? 1 : 0) + (v1 ? 1 : 0) + (v2 ? 1 : 0));
      }
    }
    var darkCount = 0;
    for (r = 0; r < n; r++) for (c = 0; c < n; c++) if (m[r][c]) darkCount++;
    p += 10 * Math.floor(Math.abs(darkCount * 20 - n * n * 10) / (n * n));
    return p;
  }

  function make(text, forceMask) {
    var bytes = utf8(text), v;
    for (v = 1; v <= 10; v++) {
      var t = BLOCKS[v];
      var cap = (t[1] * t[2] + t[3] * t[4]) * 8;
      if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= cap) break;
    }
    if (v > 10) throw new Error('Too long for a QR code');
    var words = codewords(bytes, v);
    var best = null, bestScore = 0;
    for (var mask = 0; mask < 8; mask++) {
      if (forceMask != null && mask !== forceMask) continue;
      var m = build(v, words, mask);
      var s = forceMask != null ? 0 : penalty(m);
      if (!best || s < bestScore) { best = m; bestScore = s; }
    }
    return {
      size: best.length,
      version: v,
      dark: function (r, c) { return best[r][c] === true; }
    };
  }

  function canvas(text, px) {
    var q = make(text), quiet = 4;
    var cells = q.size + quiet * 2;
    var scale = Math.max(1, Math.floor((px || 240) / cells));
    var cv = document.createElement('canvas');
    cv.width = cv.height = cells * scale;
    var g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#000';
    for (var r = 0; r < q.size; r++) {
      for (var c = 0; c < q.size; c++) {
        if (q.dark(r, c)) g.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    }
    return cv;
  }

  var api = { make: make, canvas: canvas };
  if (typeof window !== 'undefined') window.QR = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
