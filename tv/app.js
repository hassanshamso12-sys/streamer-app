/* Streamer TV: the app for older TV browsers (Chrome 76-era engines on
 * LG / Hyundai webOS and Samsung Tizen). Plain JavaScript only: no "?.",
 * no "??", no replaceAll, no flex "gap". Reads the same account, addons,
 * profiles and lists as the Streamer app. */
(function () {
  'use strict';

  // ---------- Settings (public keys, same as the app) ----------
  var SUPABASE = 'https://hdndmqmnflhejregkzow.supabase.co';
  var SB_KEY = 'sb_publishable_7zY5ndyGWxX4NHh5RHcAmA_2HRUnGFZ';
  var DEFAULT_ADDONS = [
    'https://v3-cinemeta.strem.io/manifest.json',
    'https://torrentio.strem.fun/manifest.json',
    'https://opensubtitles-v3.strem.io/manifest.json'
  ];
  var PERSONAL_ROW = /torbox|usenet|web-?dl|real-?debrid|premiumize|alldebrid|debrid/i;

  // ---------- Small helpers ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function store(k, v) {
    try {
      if (v === undefined) { var s = localStorage.getItem('stv:' + k); return s ? JSON.parse(s) : null; }
      if (v === null) localStorage.removeItem('stv:' + k);
      else localStorage.setItem('stv:' + k, JSON.stringify(v));
    } catch (e) { return null; }
  }
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.classList.add('hidden'); }, ms || 3500);
  }
  function getJson(url, opts) {
    opts = opts || {};
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, opts.timeout || 20000) : 0;
    var init = { method: opts.method || 'GET', headers: opts.headers || {} };
    if (opts.body) init.body = JSON.stringify(opts.body);
    if (ctl) init.signal = ctl.signal;
    return fetch(url, init).then(function (r) {
      clearTimeout(timer);
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j && (j.error_description || j.msg || j.message)) || ('HTTP ' + r.status));
        return j;
      });
    });
  }
  function enc(s) { return encodeURIComponent(s); }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ---------- Account (Supabase, plain HTTP) ----------
  var auth = store('auth'); // {access, refresh, uid, email, exp}
  function authHeaders() {
    var h = { apikey: SB_KEY, 'Content-Type': 'application/json' };
    if (auth) h.Authorization = 'Bearer ' + auth.access;
    return h;
  }
  function saveSession(j) {
    auth = { access: j.access_token, refresh: j.refresh_token, uid: j.user.id,
      email: j.user.email, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    store('auth', auth);
  }
  function signIn(email, password) {
    return getJson(SUPABASE + '/auth/v1/token?grant_type=password',
      { method: 'POST', headers: authHeaders(), body: { email: email, password: password } })
      .then(saveSession);
  }
  function freshToken() {
    if (!auth) return Promise.resolve();
    if (Date.now() < auth.exp - 60000) return Promise.resolve();
    return getJson(SUPABASE + '/auth/v1/token?grant_type=refresh_token',
      { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
        body: { refresh_token: auth.refresh } })
      .then(saveSession)
      .catch(function () { signOut(); });
  }
  function signOut() {
    auth = null;
    store('auth', null); store('data', null); store('profile', null);
    data = { setup: {}, library: {} };
  }

  // The account's sources, addons (with the user's own debrid keys inside)
  // and library: My List, history, profiles, resume points.
  var data = store('data') || { setup: {}, library: {} };
  function loadAccount() {
    if (!auth) return Promise.resolve();
    return freshToken().then(function () {
      if (!auth) return;
      return getJson(SUPABASE + '/rest/v1/user_data?select=setup,library&user_id=eq.' + auth.uid,
        { headers: authHeaders() });
    }).then(function (rows) {
      if (rows && rows[0]) {
        data = { setup: rows[0].setup || {}, library: rows[0].library || {} };
        store('data', data);
      }
    });
  }

  // ---------- Membership (Hassan activates accounts) ----------
  var member = store('member'); // { user, ok, status, until }
  var contact = store('contact') || {};
  function loadContact() {
    return getJson(SUPABASE + '/rest/v1/app_contact?id=eq.1&select=whatsapp,phone,message',
      { headers: authHeaders() })
      .then(function (rows) { if (rows && rows[0]) { contact = rows[0]; store('contact', contact); } })
      .catch(function () {});
  }
  function checkMember() {
    loadContact();
    if (!auth) { member = null; return Promise.resolve(); }
    var uid = auth.uid;
    return freshToken().then(function () {
      if (!auth) return null;
      return getJson(SUPABASE + '/rest/v1/rpc/my_membership', { method: 'POST', headers: authHeaders(), body: {} });
    }).then(function (m) {
      if (!auth) { member = null; return; }
      m = m || { ok: false, status: 'waiting' };
      member = { user: uid, ok: !!m.ok, status: m.status, until: m.active_until || null, error: null };
      store('member', member);
    }).catch(function (e) {
      // Memberships not set up on the server yet: everyone may use it.
      if (/Could not find the function|my_membership/i.test(e.message || '')) {
        member = { user: uid, ok: true, status: 'active', until: null };
        return;
      }
      // Offline: the saved answer counts until its end date.
      if (member && member.user === uid) {
        if (member.until && new Date(member.until) < new Date()) member.ok = false;
        member.error = null;
      } else {
        member = { user: uid, ok: false, error: 'offline' };
      }
    });
  }
  function allowed() { return !!(auth && member && member.user === auth.uid && member.ok); }

  // ---------- Online dot on the admin page (supabase/presence.sql) ----------
  var deviceId = store('device_id');
  if (!deviceId) {
    deviceId = '';
    for (var i = 0; i < 32; i++) deviceId += Math.floor(Math.random() * 16).toString(16);
    store('device_id', deviceId);
  }
  var watchingNow = null, presenceMissing = false, onLimit = null;
  // The server also says when the account's screens are all in use
  // (supabase/screens.sql): the player then stops.
  function ping(leaving) {
    if (presenceMissing || !allowed()) return;
    var title = leaving ? null : watchingNow;
    freshToken().then(function () {
      if (!auth) return;
      return fetch(SUPABASE + '/rest/v1/rpc/ping', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ p_device_id: deviceId, p_device: 'Streamer TV',
          p_profile: (activeProfile() || {}).name || null,
          p_watching: title, p_leaving: !!leaving })
      }).then(function (r) {
        if (r.status === 404) { presenceMissing = true; return null; }
        return r.ok ? r.json() : null;
      }).then(function (j) {
        if (j && j.ok === false && title && title === watchingNow && onLimit) onLimit(j);
      });
    }).catch(function () {}); // offline: next minute
  }
  function watching(title) {
    if (title === watchingNow) return;
    watchingNow = title || null;
    ping(false);
  }
  setInterval(function () { if (!document.hidden) ping(false); }, 60000);
  document.addEventListener('visibilitychange', function () { ping(document.hidden); });

  // ---------- Profiles ----------
  function profiles() {
    var list = (data.library.profiles || []).slice();
    if (!list.some(function (p) { return p.id === 'main'; })) list.unshift({ id: 'main', name: 'Me' });
    return list;
  }
  function activeProfile() {
    var id = store('profile') || 'main';
    return profiles().filter(function (p) { return p.id === id; })[0] || profiles()[0];
  }
  function profileData() {
    var p = activeProfile();
    if (p.id === 'main') return data.library;
    return (data.library.profileData || {})[p.id] || {};
  }
  function myList() { return profileData().myList || []; }
  function recent() { return profileData().recent || []; }
  // Resume point: this device first, else the account's.
  function resumeAt(videoId) {
    var local = store('pos:' + activeProfile().id + ':' + videoId);
    if (local) return local / 1000;
    var p = (profileData().progress || {})['pos:addon:' + videoId];
    return p ? p / 1000 : 0;
  }
  function saveResume(videoId, sec, total) {
    var k = 'pos:' + activeProfile().id + ':' + videoId;
    if (sec < 30 || (total && sec > total - 120)) store(k, null);
    else store(k, Math.round(sec * 1000));
  }

  // ---------- Addons ----------
  function addons() {
    var list = (data.setup.addons || []).map(function (a) {
      return { url: a.url, m: a.manifest || {} };
    }).filter(function (a) { return a.url && a.m.id; });
    if (list.length) return list;
    return DEFAULT_ADDONS.map(function (u) { return { url: u, m: null }; });
  }
  function base(a) { return a.url.replace(/\/manifest\.json.*$/, ''); }
  function resources(m) {
    return (m.resources || []).map(function (r) {
      return typeof r === 'string' ? { name: r } : r;
    });
  }
  function supports(a, resource, type, id) {
    if (!a.m) return resource !== 'catalog';
    return resources(a.m).some(function (r) {
      if (r.name !== resource) return false;
      var types = r.types || a.m.types || [];
      var pre = r.idPrefixes || a.m.idPrefixes;
      if (types.length && types.indexOf(type) < 0) return false;
      if (pre && pre.length && !pre.some(function (p) { return id.indexOf(p) === 0; })) return false;
      return true;
    });
  }
  // Default addons without a saved manifest: fetch it once.
  function ensureManifests() {
    var list = addons();
    var missing = list.filter(function (a) { return !a.m; });
    if (!missing.length) return Promise.resolve();
    return Promise.all(missing.map(function (a) {
      return getJson(a.url).then(function (m) { a.m = m; }).catch(function () {});
    })).then(function () {
      data.setup.addons = list.filter(function (a) { return a.m; })
        .map(function (a) { return { url: a.url, manifest: a.m }; });
    });
  }
  function extras(c) {
    var list = (c.extra || []).map(function (e) { return { name: e.name, req: !!e.isRequired }; });
    (c.extraSupported || []).forEach(function (n) {
      if (!list.some(function (e) { return e.name === n; })) {
        list.push({ name: n, req: (c.extraRequired || []).indexOf(n) >= 0 });
      }
    });
    return list;
  }
  function browsable(c) { return !extras(c).some(function (e) { return e.req; }); }
  function searchable(c) { return extras(c).some(function (e) { return e.name === 'search'; }); }
  function onHome(a, c) {
    var vis = data.setup.catalogVisibility || {};
    var k = a.m.id + '|' + c.type + '|' + c.id;
    if (k in vis) return vis[k];
    return !(PERSONAL_ROW.test(a.m.name || '') || PERSONAL_ROW.test(a.m.id) || PERSONAL_ROW.test(c.name || ''));
  }
  function catalog(a, c, opts) {
    opts = opts || {};
    var ex = [];
    if (opts.search) ex.push('search=' + enc(opts.search));
    if (opts.skip) ex.push('skip=' + opts.skip);
    var url = base(a) + '/catalog/' + enc(c.type) + '/' + enc(c.id) + (ex.length ? '/' + ex.join('&') : '') + '.json';
    return getJson(url).then(function (j) {
      return (j.metas || []).map(function (m) { if (!m.type) m.type = c.type; return m; });
    });
  }
  function meta(type, id, from) {
    var list = addons().filter(function (a) { return a.m && supports(a, 'meta', type, id); });
    if (from) list.sort(function (x) { return x.url === from ? -1 : 1; });
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.resolve(null);
      var a = list[i++];
      return getJson(base(a) + '/meta/' + enc(type) + '/' + enc(id) + '.json')
        .then(function (j) { return j.meta || next(); })
        .catch(next);
    }
    return next();
  }
  function typeLabel(t) { return t === 'movie' ? 'Movies' : t === 'series' ? 'Series' : t === 'tv' ? 'TV' : t; }

  // ---------- Streams: which ones a TV browser can play, best first ----------
  var SERVICES = { TB: 'TorBox', RD: 'Real-Debrid', AD: 'AllDebrid', PM: 'Premiumize', DL: 'Debrid-Link', OC: 'Offcloud' };
  var DEBRID_TAG = /^\[([A-Za-z]{2,3})(\+| download|⚡|⬇️?|🔄|⏳)\]/;
  // What a stream is, from its name and description (same rules as the app).
  var AR_DUB = /مدبلج|دوبلاج|arabic[ ._-]?dub|\bar[ ._-]?dub|dub(bed)?[ ._-]?(in[ ._-])?arabic/i;
  var AR_AUDIO = /🇸🇦|🇪🇬|🇦🇪|🇱🇧|🇸🇾|🇯🇴|🇰🇼|🇶🇦|\barabic\b/i;
  var AR_SUBS = /مترجم|arabic[ ._-]?subs?\b/i;
  var MULTI = /multi[ ._-]?audio|dual[ ._-]?audio|\bmulti\b|\bdual\b|مدبلج\s*[|/]\s*مترجم/i;
  var OTHER_DUB = /\b(dub|dubbed|dvo|mvo|avo|lektor|lat|latino|castellano|vff|vfq|truefrench|french|spanish|german|italian|hindi|tamil|telugu|russian|rus|ukr|polish|pldub|turkish dub)\b/i;
  var CYRILLIC = /[Ѐ-ӿ]/;
  var CAM = /\b(cam|camrip|hdcam|ts|telesync|hdts|tc|telecine|scr|screener|hdtc)\b/i;
  function info(s) {
    var name = s.name || '', title = s.title || s.description || '';
    var raw = name + '\n' + title + '\n' + ((s.behaviorHints || {}).filename || '');
    var text = raw.toLowerCase();
    var tag = DEBRID_TAG.exec(name);
    var q = /2160p|\b4k\b|\buhd\b/.test(text) ? 2160 : /1080[pi]/.test(text) ? 1080 :
      /720p/.test(text) ? 720 : /480p|\bsd\b/.test(text) ? 480 : 0;
    var size = 0, m = /(?:💾|📦)\s*([\d.,]+)\s*(tb|gb|mb)/i.exec(raw);
    if (m) {
      var n = parseFloat(m[1].replace(',', '.'));
      size = n * (m[2].toLowerCase() === 'tb' ? 1048576 : m[2].toLowerCase() === 'gb' ? 1024 : 1);
    } else if ((s.behaviorHints || {}).videoSize) {
      size = s.behaviorHints.videoSize / 1048576;
    }
    var ready = tag ? (tag[2] === '+' || tag[2] === '⚡') :
      (/⚡\s*(tb|rd|ad|pm)\b/i.test(name) && !/check cache|⏳/i.test(raw));
    var svc = (tag && tag[1]) || ((/⚡\s*(tb|rd|ad|pm)\b/i.exec(name) || [])[1] || '');
    var arAudio = AR_DUB.test(raw) || AR_AUDIO.test(raw);
    return {
      s: s, q: q, sizeMb: size,
      service: SERVICES[svc.toUpperCase()] || (svc ? svc.toUpperCase() : 'Debrid'),
      action: !!(tag && tag[2] === '🔄'),
      debrid: !!tag || /⚡\s*(tb|rd|ad|pm)\b/i.test(name) || /\/resolve\//.test(s.url || ''),
      ready: ready,
      hevc: /x265|hevc|h\.?265/.test(text),
      av1: /\bav1\b/.test(text),
      tenBit: /10[ ._-]?bit|hi10/.test(text),
      badAudio: /\bdts|truehd|atmos|\bac3|ddp|eac3|dd\+|dd5/.test(text),
      mp4: /\.mp4|\bmp4\b|x264|h\.?264|\bavc\b/.test(text),
      cam: CAM.test(text),
      arabicAudio: arAudio,
      arabicDub: AR_DUB.test(raw),
      arabicSubs: AR_SUBS.test(raw) && !AR_DUB.test(raw),
      multi: MULTI.test(raw),
      otherDub: !arAudio && (OTHER_DUB.test(raw) || CYRILLIC.test(raw)),
      label: title.split('\n')[0] || name.split('\n').join(' ')
    };
  }
  // Higher = better. Like the app's Best pick, plus what TV browsers need:
  // they play only a file's default audio track (no switching), so dubs and
  // multi-audio files (often French / Russian first) go down.
  function score(x, lang) {
    if (!x.s.url || /^magnet:/.test(x.s.url) || x.action) return -1000;
    var group = x.cam ? 5 : (x.sizeMb && x.sizeMb < 100) ? 30 : x.q === 2160 ? 50 :
      (x.q === 480 || !x.q) ? 65 : 100;
    var gb = (x.sizeMb || 2048) / 1024;
    var s = group - (gb <= 1.5 ? 10 * gb : Math.min(15 + 2 * (gb - 1.5), 19));
    if (x.q === 1080) s += 2.5;
    if (x.debrid) s += x.ready ? 3 : -15;
    if (x.debrid && x.ready && (x.q === 720 || x.q === 1080) && !x.cam) s += 40;
    // Audio: your languages first.
    var turkish = lang === 'tr';
    if (turkish && x.arabicAudio && store('dub_tr') !== false) s += 30;
    else if (x.otherDub) s -= 30;
    if (x.multi && !(turkish && x.arabicAudio)) s -= 10;
    // TV browsers decode H.264 + normal audio; HEVC / 10-bit / DTS often fail.
    if (x.hevc) s -= x.tenBit ? 15 : 10;
    if (x.av1) s -= 45; // older TV browsers can't decode AV1 at all
    if (x.badAudio) s -= 12;
    if (x.mp4) s += 5;
    return s;
  }
  // Title's original language from TMDB ("tr", "ar", "en"…), cached.
  var TMDB = 'bfa916aebefd39ca1e7a95b0e92ee8a5';
  function originalLang(id, type) {
    var key = 'lang:' + id, saved = store(key);
    if (saved) return Promise.resolve(saved);
    var series = type === 'series';
    var req = /^tmdb:/.test(id)
      ? getJson('https://api.themoviedb.org/3/' + (series ? 'tv' : 'movie') + '/' + id.split(':')[1] + '?api_key=' + TMDB)
      : getJson('https://api.themoviedb.org/3/find/' + id.split(':')[0] + '?external_source=imdb_id&api_key=' + TMDB)
          .then(function (j) { return (series ? j.tv_results : j.movie_results)[0] || {}; });
    return req.then(function (r) {
      var l = r.original_language || '';
      if (l) store(key, l);
      return l;
    }).catch(function () { return ''; });
  }
  function streams(type, videoId, onUpdate) {
    var lang = '';
    Promise.all([ensureManifests(),
      originalLang(videoId.split(':')[0] === 'tmdb' ? videoId.split(':').slice(0, 2).join(':') : videoId.split(':')[0], type)
        .then(function (l) { lang = l; })])
      .then(function () { streamsNow(type, videoId, onUpdate, lang); });
  }
  function streamsNow(type, videoId, onUpdate, lang) {
    var list = addons().filter(function (a) { return a.m && supports(a, 'stream', type, videoId); });
    var all = [], left = list.length;
    if (!left) onUpdate(all, true);
    list.forEach(function (a) {
      getJson(base(a) + '/stream/' + enc(type) + '/' + enc(videoId) + '.json', { timeout: 30000 })
        .then(function (j) {
          (j.streams || []).forEach(function (s) {
            var x = info(s); x.addon = a.m.name; x.score = score(x, lang); x.lang = lang;
            if (x.score > -1000) all.push(x);
          });
        }).catch(function () {})
        .then(function () {
          left--;
          all.sort(function (p, q) { return q.score - p.score; });
          onUpdate(all, left === 0);
        });
    });
  }

  // ---------- Arabic dubs ----------
  // Posters: Aradeb's "Arabic Dubbed" lists, refreshed once a day.
  var dubIds = (store('dub_ids') || {}).ids || [];
  var dubListeners = [];
  function loadDubLists() {
    var saved = store('dub_ids') || {}, today = new Date().toISOString().slice(0, 10);
    if (saved.day === today) return Promise.resolve();
    return ensureManifests().then(function () {
      var aradeb = addons().filter(function (a) { return a.m && a.m.id === 'org.reptilia.aradeb'; })[0];
      if (!aradeb) return;
      var cats = (aradeb.m.catalogs || []).filter(function (c) { return /dubbed/i.test(c.id) && browsable(c); });
      var ids = [];
      return Promise.all(cats.map(function (c) {
        var skip = 0, page = 0;
        function next() {
          if (page++ >= 5) return Promise.resolve();
          return catalog(aradeb, c, { skip: skip }).then(function (items) {
            if (!items.length) return;
            items.forEach(function (m) { ids.push(m.id); });
            skip += items.length;
            return next();
          }).catch(function () {});
        }
        return next();
      })).then(function () {
        if (!ids.length) return;
        dubIds = ids;
        store('dub_ids', { day: today, ids: ids });
        dubListeners.forEach(function (f) { f(); });
      });
    });
  }
  function dubListed(id) { return dubIds.indexOf(id) >= 0; }
  // One title: does any stream have Arabic audio? (Series: episode 1.)
  var dubChecked = {};
  function dubCheck(type, id) {
    if (dubListed(id)) return Promise.resolve(true);
    if (id in dubChecked) return Promise.resolve(dubChecked[id]);
    var series = type === 'series';
    var videoId = series ? id + ':1:1' : id;
    return new Promise(function (resolve) {
      var found = false;
      streams(type, videoId, function (all, done) {
        if (!found && all.some(function (x) { return x.arabicAudio; })) { found = true; resolve(true); }
        if (done && !found) resolve(false);
      });
    }).then(function (v) { dubChecked[id] = v; return v; });
  }

  // ---------- Kids profiles: titles rated up to 15 ----------
  var KIDS_MAX = 15;
  var NAMED_AGE = { 'U': 0, 'UC': 0, 'PG': 8, '12A': 12, '15A': 15, 'R18': 18, 'G': 0, 'PG-13': 13,
    'R': 17, 'NC-17': 18, 'TV-Y': 0, 'TV-Y7': 7, 'TV-Y7-FV': 7, 'TV-G': 0, 'TV-PG': 10, 'TV-14': 14,
    'TV-MA': 17, 'E': 0, 'M': 15, 'MA15+': 15, 'R18+': 18, 'X18+': 18, 'RC': 18, 'AL': 0, 'L': 0,
    'TP': 0, 'A': 0, 'APTA': 0, 'T': 0, 'ER': 18 };
  var COUNTRIES = ['GB', 'IE', 'DE', 'NL', 'US', 'AU', 'BR', 'FR', 'CA', 'ES', 'IT'];
  function ageFor(country, cert) {
    var c = String(cert || '').toUpperCase().replace(/\s/g, '');
    if (!c || c === 'NR') return null;
    if (country === 'US' && c === 'PG') return 8;
    if (c in NAMED_AGE) return NAMED_AGE[c];
    var d = /(\d{1,2})/.exec(c);
    return d ? parseInt(d[1], 10) : null;
  }
  // Minimum age for a title (null = no rating found), cached on the TV.
  function ageOf(id, type) {
    var key = 'age:' + id, saved = store(key);
    if (saved !== null && saved !== undefined) return Promise.resolve(saved < 0 ? null : saved);
    var series = type === 'series';
    var find = /^tmdb:/.test(id)
      ? Promise.resolve(parseInt(id.split(':')[1], 10))
      : getJson('https://api.themoviedb.org/3/find/' + id.split(':')[0] + '?external_source=imdb_id&api_key=' + TMDB)
          .then(function (j) { var r = (series ? j.tv_results : j.movie_results)[0]; return r ? r.id : null; });
    return find.then(function (tid) {
      if (!tid) return null;
      return getJson('https://api.themoviedb.org/3/' + (series ? 'tv/' + tid + '/content_ratings' : 'movie/' + tid + '/release_dates') + '?api_key=' + TMDB)
        .then(function (j) {
          var by = {};
          (j.results || []).forEach(function (r) {
            var list = series ? [r.rating] : (r.release_dates || []).map(function (d) { return d.certification; });
            by[r.iso_3166_1] = list;
          });
          var order = COUNTRIES.concat(Object.keys(by));
          for (var i = 0; i < order.length; i++) {
            var list = by[order[i]];
            if (!list) continue;
            var best = null;
            list.forEach(function (cert) { var a = ageFor(order[i], cert); if (a !== null && (best === null || a > best)) best = a; });
            if (best !== null) return best;
          }
          return null;
        });
    }).then(function (age) {
      store(key, age === null ? -1 : age);
      return age;
    }).catch(function () { return null; });
  }
  function kidsOk(m) {
    return ageOf(m.id, m.type).then(function (age) {
      if (age === null) return !(m.genres || []).some(function (g) { return /horror/i.test(g); });
      return age <= KIDS_MAX;
    });
  }
  // In a Kids profile: drop titles rated over 15 (a few checks at a time).
  function forProfile(items) {
    if (!activeProfile().kids) return Promise.resolve(items);
    var ok = [], next = 0;
    function worker() {
      if (next >= items.length) return Promise.resolve();
      var i = next++;
      return kidsOk(items[i]).then(function (v) { ok[i] = v; return worker(); });
    }
    var workers = [];
    for (var w = 0; w < 6; w++) workers.push(worker());
    return Promise.all(workers).then(function () {
      return items.filter(function (m, i) { return ok[i]; });
    });
  }

  // ---------- Subtitles ----------
  function subLangs() {
    var saved = store('sublangs');
    return saved || ['ara', 'eng'];
  }
  function findSubtitles(type, videoId) {
    return ensureManifests().then(function () { return subtitlesNow(type, videoId); });
  }
  // SubDL: the app's source of Arabic subtitles (sent as .zip files).
  var SUBDL_KEY = 'subdl_YX4Wm7OuzYyEvUVwOmbwNo6x4Q4IzTb7z5GG9rz_aIg';
  var SUBDL_LANG = { ara: 'AR', eng: 'EN', fre: 'FR', tur: 'TR', spa: 'ES', ger: 'DE' };
  function fromSubdl(type, videoId) {
    var parts = videoId.split(':'), tmdb = parts[0] === 'tmdb';
    var id = tmdb ? parts[1] : parts[0];
    var season = parts[tmdb ? 2 : 1], episode = parts[tmdb ? 3 : 2];
    var langs = subLangs().map(function (l) { return SUBDL_LANG[l]; }).filter(Boolean);
    if (!langs.length) langs = ['AR', 'EN'];
    var q = 'https://api.subdl.com/api/v1/subtitles?api_key=' + SUBDL_KEY +
      (tmdb ? '&tmdb_id=' : '&imdb_id=') + id +
      '&type=' + (type === 'series' ? 'tv' : 'movie') +
      (season ? '&season_number=' + season : '') + (episode ? '&episode_number=' + episode : '') +
      '&languages=' + langs.join(',') + '&subs_per_page=30';
    var back = {};
    Object.keys(SUBDL_LANG).forEach(function (k) { back[SUBDL_LANG[k]] = k; });
    return getJson(q).then(function (j) {
      return (j.subtitles || []).map(function (x) {
        return { url: 'https://dl.subdl.com' + x.url, lang: back[(x.language || '').toUpperCase()] || 'und',
          zip: true, label: x.release_name || x.name || 'SubDL', source: 'SubDL',
          season: season, episode: episode };
      });
    }).catch(function () { return []; });
  }
  function subtitlesNow(type, videoId) {
    var list = addons().filter(function (a) { return a.m && supports(a, 'subtitles', type, videoId); });
    var jobs = list.map(function (a) {
      return getJson(base(a) + '/subtitles/' + enc(type) + '/' + enc(videoId) + '.json')
        .then(function (j) {
          return (j.subtitles || []).map(function (x) {
            return { url: x.url, lang: x.lang, label: x.id || (a.m.name || ''), source: a.m.name || '' };
          });
        })
        .catch(function () { return []; });
    });
    jobs.push(fromSubdl(type, videoId));
    return Promise.all(jobs).then(function (lists) {
      return [].concat.apply([], lists).filter(function (x) {
        return x.url && (x.zip || !/\.zip/i.test(x.url));
      });
    });
  }
  // Best first: your languages, then the release closest to the video file.
  function sortSubtitles(list, fileName) {
    var langs = subLangs();
    var words = String(fileName || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 1; });
    function match(x) {
      if (!words.length) return 0;
      var other = String(x.label || '').toLowerCase();
      return words.filter(function (w) { return other.indexOf(w) >= 0; }).length / words.length;
    }
    return list.map(function (x, i) { return { x: x, i: i, m: match(x) }; }).sort(function (a, b) {
      var la = langs.indexOf(a.x.lang), lb = langs.indexOf(b.x.lang);
      la = la < 0 ? 99 : la; lb = lb < 0 ? 99 : lb;
      return (la - lb) || (b.m - a.m) || (a.i - b.i);
    }).map(function (e) { return e.x; });
  }
  // Subtitle file bytes → text: UTF-8, UTF-16 or old Windows Arabic.
  function decodeSub(bytes) {
    try {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
      if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
    } catch (e) {
      return new TextDecoder('windows-1256').decode(bytes);
    }
  }
  // Downloads one subtitle (unzipping SubDL's) and returns its text.
  function subtitleText(x) {
    return fetch(x.url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      if (!x.zip) return decodeSub(new Uint8Array(buf));
      var files = window.STVunzip(buf).filter(function (f) { return /\.(srt|vtt)$/i.test(f.name); });
      if (!files.length) throw new Error('No subtitle in the zip');
      var pick = null;
      if (x.season && x.episode) {
        var re = new RegExp('s0*' + x.season + '[ ._-]*e0*' + x.episode + '(?!\\d)|\\b0*' + x.season + 'x0*' + x.episode + '(?!\\d)', 'i');
        pick = files.filter(function (f) { return re.test(f.name); })[0];
      }
      if (!pick) pick = files.sort(function (a, b) { return b.data.length - a.data.length; })[0];
      return decodeSub(pick.data);
    });
  }
  // SRT → WebVTT, so the TV browser's <track> can show it.
  function srtToVtt(srt) {
    return 'WEBVTT\n\n' + srt.replace(/\r/g, '')
      .replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2')
      .replace(/^\d+\n(?=\d\d:)/gm, '');
  }

  // ---------- Remote control: focus moves to the nearest item ----------
  var focused = null;
  function focusables() {
    var root = !$('player').classList.contains('hidden') ? $('sheet') : document;
    return [].slice.call(root.querySelectorAll('.f')).filter(function (e) {
      return e.offsetParent !== null;
    });
  }
  var lastContent = null; // where you were before going to the menu
  function inMenu(e) { return !!(e && e.closest && e.closest('#menu')); }
  // noScroll: the air mouse / pointer highlights without moving the page.
  function focus(e, noScroll) {
    if (!e) return;
    if (focused) focused.classList.remove('focus');
    if (focused && !inMenu(focused) && inMenu(e)) lastContent = focused;
    focused = e;
    e.classList.add('focus');
    if (e.tagName === 'INPUT' && !noScroll) e.focus();
    else if (document.activeElement && document.activeElement.blur && e.tagName !== 'INPUT') document.activeElement.blur();
    var strip = e.parentNode && e.parentNode.classList.contains('strip') ? e.parentNode : null;
    if (strip) strip.setAttribute('data-i', [].indexOf.call(strip.children, e));
    if (!noScroll) {
      // Keep it on screen: rows scroll sideways, pages scroll down.
      if (strip) {
        // Scroll the row only when the poster would leave the screen, so
        // rows stay lined up with each other.
        var rel = e.offsetLeft - strip.offsetLeft, w = e.offsetWidth;
        if (rel < strip.scrollLeft + 10) strip.scrollLeft = Math.max(0, rel - w * 0.4);
        else if (rel + w > strip.scrollLeft + strip.clientWidth - 30) strip.scrollLeft = rel + w * 1.4 - strip.clientWidth;
      }
      var sc = e.closest ? e.closest('.scroll, .rows, #sheet') : null;
      if (sc) {
        var r = e.getBoundingClientRect(), b = sc.getBoundingClientRect();
        if (r.bottom > b.bottom - 40) sc.scrollTop += r.bottom - b.bottom + 80;
        else if (r.top < b.top + 20) sc.scrollTop -= b.top - r.top + 60;
      }
    }
    if (e.onfocusitem) e.onfocusitem();
  }
  // Nearest item in a direction; content first, the menu only when there's
  // nothing else that way.
  function nearest(dir, items) {
    var a = focused.getBoundingClientRect();
    var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    var best = null, bestD = Infinity;
    items.forEach(function (e) {
      if (e === focused) return;
      var r = e.getBoundingClientRect();
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      var dx = x - ax, dy = y - ay, d;
      if (dir === 'left' && dx >= -2) return;
      if (dir === 'right' && dx <= 2) return;
      if (dir === 'up' && dy >= -2) return;
      if (dir === 'down' && dy <= 2) return;
      d = (dir === 'left' || dir === 'right') ? Math.abs(dx) + Math.abs(dy) * 3 : Math.abs(dy) + Math.abs(dx) * 0.6;
      if (d < bestD) { bestD = d; best = e; }
    });
    return best;
  }
  function stripCards(strip) { return [].filter.call(strip.children, function (c) { return c.classList.contains('f'); }); }
  function move(dir) {
    var items = focusables();
    if (!focused || items.indexOf(focused) < 0) return focus(items[0]);
    // In a row of posters: explicit, predictable moves.
    var strip = focused.parentNode && focused.parentNode.classList.contains('strip') ? focused.parentNode : null;
    if (strip) {
      var cards = stripCards(strip), i = cards.indexOf(focused);
      if (dir === 'right') { if (cards[i + 1]) focus(cards[i + 1]); return; }
      if (dir === 'left') {
        if (cards[i - 1]) return focus(cards[i - 1]);
        var menuItems = items.filter(inMenu);
        return focus(nearest('left', menuItems) || menuItems[0]);
      }
      // Up / down: the row above / below, where you were in it last time.
      var rows = [].slice.call(document.querySelectorAll('#page .strip')).filter(function (st) {
        return stripCards(st).length && st.offsetParent !== null;
      });
      var r = rows.indexOf(strip) + (dir === 'down' ? 1 : -1);
      if (r >= 0 && r < rows.length) {
        var target = stripCards(rows[r]);
        var at = parseInt(rows[r].getAttribute('data-i') || '0', 10);
        return focus(target[Math.min(at, target.length - 1)]);
      }
      // No row that way: whatever else is there (e.g. search box above).
      var other = nearest(dir, items.filter(function (e) { return !inMenu(e) && e.parentNode !== strip; }));
      if (other) focus(other);
      return;
    }
    // In the menu, ▶ goes back to where you were.
    if (inMenu(focused) && dir === 'right') {
      if (lastContent && document.body.contains(lastContent) && lastContent.offsetParent !== null) return focus(lastContent);
      var content = items.filter(function (e) { return !inMenu(e); });
      return focus(nearest('right', content) || content[0]);
    }
    if (inMenu(focused)) return focus(nearest(dir, items.filter(inMenu)));
    var pick = nearest(dir, items.filter(function (e) { return !inMenu(e); }));
    if (!pick && dir === 'left') pick = nearest('left', items.filter(inMenu));
    if (pick) focus(pick);
  }
  function focusFirst(root) {
    var e = (root || document).querySelector('.f');
    if (e) focus(e);
  }

  // ---------- Pages and going back ----------
  // Each page (and the player) is a step in the browser's history, so the
  // TV's Back button, which many TV browsers handle themselves, steps back
  // inside Streamer TV instead of leaving it.
  var stack = []; // functions that redraw earlier pages
  var current = null;
  function show(render, keepHistory) {
    if (current && !keepHistory) {
      stack.push(current);
      window.history.pushState({ stv: stack.length }, '');
    }
    current = render;
    $('page').innerHTML = '';
    focused = null;
    render($('page'));
    updateBackButton();
  }
  // Back key or on-screen Back: let the browser step back; popstate below
  // does the work, so both ways behave the same.
  function back() { window.history.back(); }
  function stepBack() {
    var sheet = $('sheet');
    if (!$('player').classList.contains('hidden')) {
      if (!sheet.classList.contains('hidden')) {
        // Back while the subtitle menu is open: close just the menu.
        sheet.classList.add('hidden');
        window.history.pushState({ stv: 'player' }, '');
        return;
      }
      return player.close();
    }
    if (!stack.length) return;
    current = stack.pop();
    $('page').innerHTML = '';
    focused = null;
    current($('page'));
    updateBackButton();
  }
  var lastPop = 0;
  window.addEventListener('popstate', function () { lastPop = Date.now(); stepBack(); });
  // Back key: if the TV's browser already stepped back (popstate), do
  // nothing more; otherwise step back ourselves.
  function backFromKey() {
    var t = Date.now();
    setTimeout(function () { if (lastPop < t) back(); }, 250);
  }
  window.history.replaceState({ stv: 0 }, '');
  function updateBackButton() {
    var b = $('backbtn');
    if (b) b.classList.toggle('hidden', !stack.length);
  }

  // ---------- Genres (TMDB), across every source ----------
  // Titles open by their IMDb id, so all stream addons search them together.
  // Series have no Romance / Thriller / Horror genre on TMDB: keywords instead.
  var GENRES = [
    ['Action', '💥', { with_genres: '28' }, { with_genres: '10759' }],
    ['Comedy', '😂', { with_genres: '35' }, { with_genres: '35' }],
    ['Romance', '❤️', { with_genres: '10749' }, { with_keywords: '9840', with_genres: '18|35', without_genres: '16' }],
    ['Thriller', '🔪', { with_genres: '53' }, { with_keywords: '316362' }],
    ['Drama', '🎭', { with_genres: '18' }, { with_genres: '18' }],
    ['Crime', '🕵️', { with_genres: '80' }, { with_genres: '80' }],
    ['Horror', '👻', { with_genres: '27' }, { with_keywords: '315058' }],
    ['Sci-Fi', '🚀', { with_genres: '878' }, { with_genres: '10765' }],
    ['Fantasy', '🧙', { with_genres: '14' }, { with_genres: '10765' }],
    ['Adventure', '🗺️', { with_genres: '12' }, { with_genres: '10759' }],
    ['Mystery', '🔍', { with_genres: '9648' }, { with_genres: '9648' }],
    ['Animation', '🎨', { with_genres: '16' }, { with_genres: '16' }],
    ['Family', '👨‍👩‍👧', { with_genres: '10751' }, { with_genres: '10751' }],
    ['War', '🎖️', { with_genres: '10752' }, { with_genres: '10768' }],
    ['History', '🏛️', { with_genres: '36' }, null],
    ['Documentary', '🎥', { with_genres: '99' }, { with_genres: '99' }],
    ['Western', '🤠', { with_genres: '37' }, { with_genres: '37' }],
    ['Music', '🎵', { with_genres: '10402' }, null]
  ].map(function (g) { return { name: g[0], movie: g[2], series: g[3], votes: 50 }; });
  // Countries and languages. Arabic titles get few TMDB votes, so lower bars.
  function region(name, key, value, votes, seriesFirst) {
    var q = {}; q[key] = value;
    return { name: name, movie: q, series: q, votes: votes, seriesFirst: seriesFirst };
  }
  var REGIONS = [
    region('Arabic', 'with_original_language', 'ar', 3, true),
    region('Egyptian', 'with_origin_country', 'EG', 3, true),
    region('Syrian', 'with_origin_country', 'SY', 1, true),
    region('Lebanese', 'with_origin_country', 'LB', 1, true),
    region('Gulf', 'with_origin_country', 'SA|AE|KW|QA|BH|OM', 1, true),
    region('Turkish', 'with_original_language', 'tr', 10, true),
    region('Korean', 'with_original_language', 'ko', 50, true),
    { name: 'Anime', movie: { with_original_language: 'ja', with_genres: '16' },
      series: { with_original_language: 'ja', with_genres: '16' }, votes: 50, seriesFirst: true },
    region('Indian', 'with_original_language', 'hi', 20, false),
    region('Spanish', 'with_original_language', 'es', 50, false)
  ];
  function regions() { return REGIONS; }
  function genres() {
    var kids = !!activeProfile().kids;
    return GENRES.filter(function (g) { return !(kids && g.name === 'Horror'); });
  }
  var IMG = 'https://image.tmdb.org/t/p/';
  function discoverGenre(g, series, page) {
    var q = series ? g.series : g.movie;
    if (!q) return Promise.resolve([]);
    var url = 'https://api.themoviedb.org/3/discover/' + (series ? 'tv' : 'movie') +
      '?api_key=' + TMDB + '&sort_by=popularity.desc&vote_count.gte=' + (g.votes || 50) + '&page=' + page;
    Object.keys(q).forEach(function (k) { url += '&' + k + '=' + encodeURIComponent(q[k]); });
    return getJson(url).then(function (j) {
      return (j.results || []).map(function (r) {
        var date = r.first_air_date || r.release_date || '';
        return { id: 'tmdb:' + r.id, tmdbId: r.id, type: series ? 'series' : 'movie',
          name: r.name || r.title || '', poster: r.poster_path ? IMG + 'w342' + r.poster_path : null,
          background: r.backdrop_path ? IMG + 'w1280' + r.backdrop_path : null,
          releaseInfo: date.slice(0, 4), description: r.overview || '',
          imdbRating: r.vote_average ? r.vote_average.toFixed(1) : null };
      });
    });
  }
  // TMDB title → IMDb id ("tt…") so Cinemeta, Torrentio… know it. Titles
  // without one (many Arabic series) stay "tmdb:…" for addons like Aradeb.
  function resolveTmdb(m) {
    if (!/^tmdb:/.test(m.id)) return Promise.resolve(m);
    var key = 'imdb:' + m.type + ':' + m.tmdbId, saved = store(key);
    var got = saved !== null && saved !== undefined ? Promise.resolve(saved)
      : getJson('https://api.themoviedb.org/3/' + (m.type === 'series' ? 'tv' : 'movie') + '/' + m.tmdbId +
          '/external_ids?api_key=' + TMDB).then(function (j) {
        var id = j.imdb_id || '';
        store(key, id);
        return id;
      }).catch(function () { return ''; });
    return got.then(function (id) {
      var out = {};
      Object.keys(m).forEach(function (k) { out[k] = m[k]; });
      if (id) out.id = id;
      return out;
    });
  }

  // Exposed for the other script parts (pages, player).
  window.STV = {
    $: $, el: el, store: store, toast: toast, getJson: getJson, fmtTime: fmtTime,
    auth: function () { return auth; }, signIn: signIn, signOut: signOut,
    loadAccount: loadAccount, checkMember: checkMember, allowed: allowed,
    ping: ping, watching: watching, onScreenLimit: function (fn) { onLimit = fn; },
    member: function () { return member; }, contact: function () { return contact; },
    data: function () { return data; },
    profiles: profiles, activeProfile: activeProfile, myList: myList, recent: recent,
    resumeAt: resumeAt, saveResume: saveResume,
    addons: addons, ensureManifests: ensureManifests, browsable: browsable,
    searchable: searchable, onHome: onHome, catalog: catalog, meta: meta,
    typeLabel: typeLabel, streams: streams, findSubtitles: findSubtitles,
    srtToVtt: srtToVtt, subLangs: subLangs, sortSubtitles: sortSubtitles,
    forProfile: forProfile, kidsOk: kidsOk, ageOf: ageOf, KIDS_MAX: KIDS_MAX,
    genres: genres, regions: regions, discoverGenre: discoverGenre, resolveTmdb: resolveTmdb,
    loadDubLists: loadDubLists, dubListed: dubListed, dubCheck: dubCheck,
    onDubLists: function (f) { dubListeners.push(f); },
    subtitleText: subtitleText,
    focus: focus, move: move, focusFirst: focusFirst, focused: function () { return focused; },
    show: show, back: back, backFromKey: backFromKey,
    pushPlayer: function () { window.history.pushState({ stv: 'player' }, ''); },
    updateBackButton: updateBackButton
  };
  var player = { close: function () {} };
  window.STV.setPlayer = function (p) { player = p; };
})();
