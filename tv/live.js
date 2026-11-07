/* Streamer TV: Live TV from the account's playlists (same channel ids as
 * the app, so favourites match). Plain JavaScript for old TV browsers. */
(function () {
  'use strict';
  var S = window.STV, el = S.el;
  var ADULT = /xxx|adult|porn|\+ ?18|18 ?\+|for adults|erotic|للكبار|\bsexy?\b/i;
  var VOD = /\.(mp4|mkv|avi|mov|wmv|flv|webm)(\?|$)/i;
  var cache = null; // { channels, problems }

  function parseM3u(text, sourceId) {
    var out = [], lines = String(text || '').split(/\r?\n/), attrs = {}, title = null, grp = null, index = 0;
    var attrRe = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
    lines.forEach(function (raw) {
      var line = raw.trim(), m;
      if (!line) return;
      if (line.indexOf('#EXTINF') === 0) {
        attrs = {};
        attrRe.lastIndex = 0;
        while ((m = attrRe.exec(line))) attrs[m[1]] = m[2];
        var comma = line.lastIndexOf(',');
        title = comma >= 0 ? line.slice(comma + 1).trim() : '';
        grp = null;
      } else if (line.indexOf('#EXTGRP:') === 0) {
        grp = line.slice(8).trim();
      } else if (line.charAt(0) !== '#' && title !== null) {
        var ch = { id: sourceId + ':' + (index++), name: title || attrs['tvg-name'] || 'Channel',
          url: line, logo: attrs['tvg-logo'] || null, group: attrs['group-title'] || grp || 'Other' };
        if (!VOD.test(line)) out.push(ch); // live only (films are elsewhere)
        title = null; attrs = {};
      }
    });
    return out;
  }

  // A page served over https can't load http playlists (the browser blocks it).
  function blocked(url) { return location.protocol === 'https:' && /^http:/i.test(url); }

  function loadSource(src) {
    var type = src.type;
    if (type === 'm3uFile' || type === 'm3uText') {
      if (src.playlistText) return Promise.resolve(parseM3u(src.playlistText, src.id));
      return Promise.reject(new Error('too big to sync from the app'));
    }
    if (type === 'stream') {
      return Promise.resolve([{ id: src.id, name: src.name, url: src.url, logo: src.logo, group: src.group || 'My streams' }]);
    }
    if (blocked(src.url)) return Promise.reject(new Error('uses http, which TV browsers block on secure pages'));
    if (type === 'm3u') {
      return fetch(src.url).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }).then(function (t) { return parseM3u(t, src.id); });
    }
    if (type === 'xtream') {
      var base = src.url.replace(/\/+$/, '');
      var auth = 'username=' + encodeURIComponent(src.username || '') + '&password=' + encodeURIComponent(src.password || '');
      return Promise.all([
        S.getJson(base + '/player_api.php?' + auth + '&action=get_live_categories'),
        S.getJson(base + '/player_api.php?' + auth + '&action=get_live_streams')
      ]).then(function (r) {
        var cats = {};
        (r[0] || []).forEach(function (c) { cats[c.category_id] = c.category_name; });
        var u = encodeURIComponent(src.username || ''), p = encodeURIComponent(src.password || '');
        return (r[1] || []).map(function (s) {
          return { id: src.id + ':' + s.stream_id, name: s.name || 'Channel',
            url: base + '/live/' + u + '/' + p + '/' + s.stream_id + '.m3u8',
            logo: s.stream_icon || null, group: cats[s.category_id] || 'Other' };
        });
      });
    }
    return Promise.resolve([]);
  }

  function loadAll() {
    if (cache) return Promise.resolve(cache);
    var sources = (S.data().setup.sources || []);
    var problems = [], channels = [];
    return Promise.all(sources.map(function (src) {
      return loadSource(src).then(function (list) {
        list.forEach(function (c) { c.source = src.name; });
        channels = channels.concat(list);
      }).catch(function (e) { problems.push(src.name + ': ' + e.message); });
    })).then(function () {
      cache = { channels: channels, problems: problems };
      return cache;
    });
  }

  function favorites() {
    var p = S.activeProfile(), lib = S.data().library;
    var d = p.id === 'main' ? lib : ((lib.profileData || {})[p.id] || {});
    return d.favorites || [];
  }

  function groups(channels) {
    var kids = !!S.activeProfile().kids, seen = {}, list = [];
    var favs = favorites();
    if (channels.some(function (c) { return favs.indexOf(c.id) >= 0; })) list.push('★ Favorites');
    channels.forEach(function (c) {
      if (seen[c.group] || (kids && ADULT.test(c.group))) return;
      seen[c.group] = true;
      list.push(c.group);
    });
    return list;
  }
  function inGroup(channels, g) {
    var favs = favorites();
    return channels.filter(function (c) { return g === '★ Favorites' ? favs.indexOf(c.id) >= 0 : c.group === g; });
  }

  // Categories on the left, channels on the right.
  S.livePage = function (root) {
    var sc = el('div', 'scroll pad live');
    sc.appendChild(el('h1', '', 'Live TV'));
    var note = el('div', 'muted', 'Loading your channels…');
    sc.appendChild(note);
    var wrap = el('div', 'live-wrap');
    var left = el('div', 'live-groups'), right = el('div', 'live-channels');
    wrap.appendChild(left); wrap.appendChild(right);
    sc.appendChild(wrap);
    root.appendChild(sc);
    loadAll().then(function (c) {
      if (!c.channels.length) {
        note.textContent = (S.data().setup.sources || []).length
          ? 'None of your playlists could load in this browser.'
          : 'No channels yet. Sign in (Profile), or add playlists in the Streamer app.';
      } else {
        note.textContent = c.channels.length + ' channels';
      }
      if (c.problems.length) {
        var p = el('div', 'muted small', 'Not available on this TV page: ' + c.problems.join(' · ') +
          '. These still work in the Streamer app.');
        sc.insertBefore(p, wrap);
      }
      var gs = groups(c.channels);
      function show(g, btn) {
        [].forEach.call(left.children, function (b) { b.classList.remove('gold'); });
        if (btn) btn.classList.add('gold');
        right.innerHTML = '';
        var list = inGroup(c.channels, g);
        list.forEach(function (ch, i) {
          var t = el('div', 'chan f');
          if (ch.logo) {
            var img = el('img'); img.src = ch.logo;
            img.onerror = function () { img.style.display = 'none'; };
            t.appendChild(img);
          }
          t.appendChild(el('div', 'chan-name', ch.name));
          t.onclick = function () { play(list, i); };
          right.appendChild(t);
        });
      }
      gs.forEach(function (g, i) {
        var b = el('div', 'btn f grp', g);
        b.onclick = function () { show(g, b); S.focusFirst(right); };
        b.onfocusitem = function () { show(g, b); };
        left.appendChild(b);
        if (i === 0) { show(g, b); S.focus(b); }
      });
    });
  };

  function play(list, i) {
    var ch = list[i];
    S.player.play({ url: ch.url, title: ch.name, type: 'tv', videoId: 'live:' + ch.id, live: true,
      list: list, index: i, subs: [] });
  }
  S.playChannel = play;
})();
