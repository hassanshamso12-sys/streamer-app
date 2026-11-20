/* Small ZIP reader for subtitle downloads (SubDL sends .zip files).
 * Supports "stored" and "deflate" entries, which is what subtitle zips use.
 * Plain old JavaScript for TV browsers. window.STVunzip(arrayBuffer) returns
 * [{ name, data: Uint8Array }]. */
(function () {
  'use strict';

  // ---------- DEFLATE (RFC 1951) ----------
  function Tree() { this.table = new Uint16Array(16); this.trans = new Uint16Array(288); }
  var LEN_BITS = new Uint8Array(30), LEN_BASE = new Uint16Array(30);
  var DIST_BITS = new Uint8Array(30), DIST_BASE = new Uint16Array(30);
  var CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  function baseTable(bits, base, delta, first) {
    var i, sum;
    for (i = 0; i < delta; i++) bits[i] = 0;
    for (i = 0; i < 30 - delta; i++) bits[i + delta] = (i / delta) | 0;
    for (sum = first, i = 0; i < 30; i++) { base[i] = sum; sum += 1 << bits[i]; }
  }
  baseTable(LEN_BITS, LEN_BASE, 4, 3);
  baseTable(DIST_BITS, DIST_BASE, 2, 1);
  LEN_BITS[28] = 0; LEN_BASE[28] = 258;

  function buildTree(t, lengths, off, num) {
    var i, sum, offs = new Uint16Array(16);
    for (i = 0; i < 16; i++) t.table[i] = 0;
    for (i = 0; i < num; i++) t.table[lengths[off + i]]++;
    t.table[0] = 0;
    for (sum = 0, i = 0; i < 16; i++) { offs[i] = sum; sum += t.table[i]; }
    for (i = 0; i < num; i++) if (lengths[off + i]) t.trans[offs[lengths[off + i]]++] = i;
  }
  var FIXED_L = new Tree(), FIXED_D = new Tree();
  (function () {
    var i;
    for (i = 0; i < 7; i++) FIXED_L.table[i] = 0;
    FIXED_L.table[7] = 24; FIXED_L.table[8] = 152; FIXED_L.table[9] = 112;
    for (i = 0; i < 24; i++) FIXED_L.trans[i] = 256 + i;
    for (i = 0; i < 144; i++) FIXED_L.trans[24 + i] = i;
    for (i = 0; i < 8; i++) FIXED_L.trans[24 + 144 + i] = 280 + i;
    for (i = 0; i < 112; i++) FIXED_L.trans[24 + 144 + 8 + i] = 144 + i;
    for (i = 0; i < 5; i++) FIXED_D.table[i] = 0;
    FIXED_D.table[5] = 32;
    for (i = 0; i < 32; i++) FIXED_D.trans[i] = i;
  })();

  function inflate(src) {
    var pos = 0, tag = 0, bitcount = 0;
    var out = new Uint8Array(Math.max(1024, src.length * 4)), outLen = 0;
    function need(n) {
      if (outLen + n <= out.length) return;
      var bigger = new Uint8Array(Math.max(out.length * 2, outLen + n));
      bigger.set(out.subarray(0, outLen));
      out = bigger;
    }
    function bit() {
      if (!bitcount--) { tag = src[pos++]; bitcount = 7; }
      var b = tag & 1; tag >>>= 1; return b;
    }
    function bits(num, base) {
      if (!num) return base;
      while (bitcount < 24) { tag |= (src[pos++] || 0) << bitcount; bitcount += 8; }
      var val = tag & (0xffff >>> (16 - num));
      tag >>>= num; bitcount -= num;
      return val + base;
    }
    function sym(t) {
      while (bitcount < 24) { tag |= (src[pos++] || 0) << bitcount; bitcount += 8; }
      var sum = 0, cur = 0, len = 0, tg = tag;
      do {
        cur = 2 * cur + (tg & 1); tg >>>= 1; ++len;
        sum += t.table[len]; cur -= t.table[len];
      } while (cur >= 0);
      tag = tg; bitcount -= len;
      return t.trans[sum + cur];
    }
    function dynamic(lt, dt) {
      var lengths = new Uint8Array(288 + 32), clt = new Tree();
      var hlit = bits(5, 257), hdist = bits(5, 1), hclen = bits(4, 4), i, num, len, prev, sym2;
      for (i = 0; i < 19; i++) lengths[i] = 0;
      for (i = 0; i < hclen; i++) lengths[CLEN_ORDER[i]] = bits(3, 0);
      buildTree(clt, lengths, 0, 19);
      for (num = 0; num < hlit + hdist;) {
        sym2 = sym(clt);
        if (sym2 === 16) { prev = lengths[num - 1]; for (len = bits(2, 3); len; --len) lengths[num++] = prev; }
        else if (sym2 === 17) { for (len = bits(3, 3); len; --len) lengths[num++] = 0; }
        else if (sym2 === 18) { for (len = bits(7, 11); len; --len) lengths[num++] = 0; }
        else lengths[num++] = sym2;
      }
      buildTree(lt, lengths, 0, hlit);
      buildTree(dt, lengths, hlit, hdist);
    }
    function block(lt, dt) {
      for (;;) {
        var s = sym(lt);
        if (s === 256) return;
        if (s < 256) { need(1); out[outLen++] = s; continue; }
        s -= 257;
        var length = bits(LEN_BITS[s], LEN_BASE[s]);
        var d = sym(dt);
        var offs = outLen - bits(DIST_BITS[d], DIST_BASE[d]);
        need(length);
        for (var i = offs; i < offs + length; ++i) out[outLen++] = out[i];
      }
    }
    var last;
    do {
      last = bit();
      var type = bits(2, 0);
      if (type === 0) {
        // Stored block: drop the partial byte, read length.
        while (bitcount > 8) { pos--; bitcount -= 8; }
        bitcount = 0;
        var length = src[pos] | (src[pos + 1] << 8);
        pos += 4;
        need(length);
        out.set(src.subarray(pos, pos + length), outLen);
        outLen += length; pos += length;
      } else if (type === 1) {
        block(FIXED_L, FIXED_D);
      } else if (type === 2) {
        var lt = new Tree(), dt = new Tree();
        dynamic(lt, dt);
        block(lt, dt);
      } else {
        throw new Error('Bad zip data');
      }
    } while (!last);
    return out.subarray(0, outLen);
  }

  // ---------- ZIP (central directory) ----------
  function unzip(buffer) {
    var b = new Uint8Array(buffer), v = new DataView(buffer), files = [];
    var end = -1;
    for (var i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
      if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error('Not a zip file');
    var count = v.getUint16(end + 10, true), p = v.getUint32(end + 16, true);
    for (var n = 0; n < count; n++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      var method = v.getUint16(p + 10, true);
      var csize = v.getUint32(p + 20, true);
      var nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
      var local = v.getUint32(p + 42, true);
      var name = '';
      for (var k = 0; k < nameLen; k++) name += String.fromCharCode(b[p + 46 + k]);
      p += 46 + nameLen + extra + comment;
      var start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      var raw = b.subarray(start, start + csize);
      if (/\/$/.test(name)) continue; // folder
      try {
        files.push({ name: name, data: method === 0 ? raw : method === 8 ? inflate(raw) : null });
      } catch (e) { /* skip a broken entry */ }
    }
    return files.filter(function (f) { return f.data; });
  }

  window.STVunzip = unzip;
})();
