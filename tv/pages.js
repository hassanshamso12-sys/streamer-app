/* Streamer TV: the screens. */
(function () {
  'use strict';
  var S = window.STV, $ = S.$, el = S.el;

  // ---------- Side menu ----------
  // Icons drawn as SVG: TV fonts often lack symbols like ⌕.
  var ICONS = {
    back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
    search: '<circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
    home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" fill="currentColor"/>',
    list: '<path d="M6 3h12v18l-6-4-6 4z" fill="currentColor"/>',
    live: '<rect x="3" y="6" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M8 3l4 3 4-3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 10v5l4-2.5z" fill="currentColor"/>',
    genres: '<rect x="3" y="3" width="8" height="8" rx="2" fill="currentColor"/><rect x="13" y="3" width="8" height="8" rx="2" fill="currentColor"/><rect x="3" y="13" width="8" height="8" rx="2" fill="currentColor"/><rect x="13" y="13" width="8" height="8" rx="2" fill="currentColor"/>',
    account: '<circle cx="12" cy="8" r="4.2" fill="currentColor"/><path d="M4 21c1-5 4.5-7 8-7s7 2 8 7z" fill="currentColor"/>'
  };
  function icon(name) {
    return '<svg viewBox="0 0 24 24">' + ICONS[name] + '</svg>';
  }
  var MENU = [
    { id: 'search', label: 'Search' },
    { id: 'home', label: 'Home' },
    { id: 'genres', label: 'Categories' },
    { id: 'list', label: 'My List' },
    { id: 'live', label: 'Live TV' },
    { id: 'account', label: 'Profile' }
  ];
  var pages = {};
  function menu(active) {
    var m = $('menu');
    m.innerHTML = '';
    m.appendChild(el('div', 'logo', '▶'));
    // On-screen Back (shown when there's somewhere to go back to).
    var b = el('div', 'item f back');
    b.innerHTML = icon('back');
    b.id = 'backbtn';
    b.title = 'Back';
    b.onclick = function () { S.back(); };
    m.appendChild(b);
    MENU.forEach(function (it) {
      var b = el('div', 'item f' + (it.id === active ? ' on' : ''));
      b.innerHTML = icon(it.id);
      b.title = it.label;
      b.onclick = function () { open(it.id); };
      m.appendChild(b);
    });
  }
  function open(id) {
    // Not activated (or signed out): only the account page.
    if (id !== 'account' && !S.allowed()) id = 'account';
    menu(id);
    S.show(pages[id]);
  }

  // ---------- Posters ----------
  function card(m, onOpen) {
    var c = el('div', 'card f');
    c.setAttribute('data-id', m.id);
    if (S.dubListed(m.id)) c.appendChild(el('div', 'dub', 'مدبلج'));
    if (m.poster) c.style.backgroundImage = 'url("' + m.poster + '")';
    else c.appendChild(el('div', 'name', m.name || ''));
    c.onclick = function () { onOpen(m); };
    return c;
  }
  function openTitle(m, from) {
    if (/^tmdb:/.test(m.id) && m.tmdbId) {
      // From a genre page: find the IMDb id first, so every addon knows it.
      S.resolveTmdb(m).then(function (r) { S.show(function (root) { detail(root, r, null); }); });
      return;
    }
    S.show(function (root) { detail(root, m, from); });
  }
  function genreTile(g) {
    var t = el('div', 'card genre f');
    t.appendChild(el('div', 'gname', g.name));
    t.onclick = function () { S.show(function (root) { genrePage(root, g); }); };
    return t;
  }

  // ---------- Genres: every genre, then one genre's titles ----------
  pages.genres = function (root) {
    var sc = el('div', 'scroll pad');
    sc.appendChild(el('h1', '', 'Categories'));
    sc.appendChild(el('div', 'muted', 'Movies and series from every source together'));
    [['Genres', S.genres()], ['Countries & languages', S.regions()]].forEach(function (sec) {
      sc.appendChild(el('div', 'row-title', sec[0]));
      var g = el('div', 'grid genres');
      sec[1].forEach(function (x) { g.appendChild(genreTile(x)); });
      sc.appendChild(g);
    });
    root.appendChild(sc);
    S.focusFirst(sc);
  };
  function genrePage(root, g) {
    var sc = el('div', 'scroll pad');
    sc.appendChild(el('h1', '', g.name));
    var tabs = el('div');
    var grid = el('div', 'grid');
    sc.appendChild(tabs); sc.appendChild(grid);
    root.appendChild(sc);
    var series = !g.movie || !!g.seriesFirst, page = 0, busy = false, done = false, run = 0;
    function drawTabs() {
      tabs.innerHTML = '';
      if (!g.movie || !g.series) return;
      (g.seriesFirst ? [true, false] : [false, true]).forEach(function (sr) {
        var b = el('div', 'btn f' + (sr === series ? ' gold' : ''), sr ? 'Series' : 'Movies');
        b.onclick = function () {
          if (sr === series) return;
          series = sr; page = 0; done = false; busy = false; run++;
          grid.innerHTML = '';
          drawTabs();
          S.focus(tabs.children[(sr === !!g.seriesFirst) ? 0 : 1]);
          more();
        };
        tabs.appendChild(b);
      });
    }
    function more() {
      if (busy || done) return;
      busy = true;
      var mine = run;
      S.discoverGenre(g, series, page + 1).then(function (raw) {
        if (mine !== run) return null;
        page++;
        if (!raw.length || page >= 20) done = true;
        return S.forProfile(raw);
      }).then(function (items) {
        if (!items || mine !== run) return;
        items.forEach(function (m) {
          if (grid.querySelector('[data-id="' + m.id + '"]')) return;
          var cd = card(m, function (x) { openTitle(x, null); });
          cd.onfocusitem = function () {
            if (grid.lastChild && cd.offsetTop > grid.lastChild.offsetTop - 500) more();
          };
          grid.appendChild(cd);
        });
        if (!S.focused() || !sc.contains(S.focused())) S.focusFirst(grid);
        busy = false;
      }).catch(function () { busy = false; done = true; });
    }
    drawTabs();
    more();
  }

  // ---------- Home: preview on top, rows below ----------
  pages.home = function (root) {
    var hero = el('div'); hero.id = 'hero';
    var bg = el('div'); bg.id = 'hero-bg';
    var inf = el('div'); inf.id = 'hero-info';
    hero.appendChild(bg); hero.appendChild(inf);
    var rows = el('div', 'rows');
    root.appendChild(hero); root.appendChild(rows);
    var timer = 0;
    function preview(m) {
      clearTimeout(timer);
      timer = setTimeout(function () {
        bg.style.backgroundImage = m.background ? 'url("' + m.background + '")' : '';
        inf.innerHTML = '';
        // The name shows right away; the logo replaces it once it has loaded.
        var t = el('div', '', m.name); t.id = 'hero-title'; inf.appendChild(t);
        if (m.logo) {
          var img = new Image();
          img.onload = function () {
            if (!t.parentNode) return;
            img.id = 'hero-logo';
            t.parentNode.replaceChild(img, t);
          };
          img.src = m.logo;
        }
        var line = el('div', 'meta-line');
        line.appendChild(el('span', '', m.type === 'series' ? 'SERIES' : 'MOVIE'));
        if (m.releaseInfo) line.appendChild(el('span', '', m.releaseInfo));
        if (m.genres && m.genres[0]) line.appendChild(el('span', '', m.genres[0]));
        if (m.imdbRating) { var i = el('span'); i.appendChild(el('span', 'imdb', 'IMDb')); i.appendChild(document.createTextNode(' ' + m.imdbRating)); line.appendChild(i); }
        inf.appendChild(line);
        if (m.description) inf.appendChild(el('div', 'desc', m.description));
      }, 150);
    }
    var first = true;
    function addRow(title, sub, items, from, onMore) {
      if (!items.length) return;
      var r = el('div', 'row');
      var h = el('div', 'row-title', title);
      if (sub) h.appendChild(el('small', '', sub));
      var strip = el('div', 'strip');
      items.forEach(function (m) {
        var c = card(m, function (x) { openTitle(x, from); });
        c.onfocusitem = function () { preview(m); };
        strip.appendChild(c);
      });
      if (onMore) {
        var more = el('div', 'card more f', 'See all ›');
        more.onclick = onMore;
        strip.appendChild(more);
      }
      r.appendChild(h); r.appendChild(strip);
      rows.insertBefore(r, genreRow);
      if (first) { first = false; S.focusFirst(rows); }
    }
    var genreRow = el('div', 'row');
    genreRow.appendChild(el('div', 'row-title', 'Genres'));
    var gstrip = el('div', 'strip');
    S.genres().forEach(function (g) { gstrip.appendChild(genreTile(g)); });
    genreRow.appendChild(gstrip);
    rows.appendChild(genreRow);
    var regionRow = el('div', 'row');
    regionRow.appendChild(el('div', 'row-title', 'Countries & languages'));
    var rstrip = el('div', 'strip');
    S.regions().forEach(function (g) { rstrip.appendChild(genreTile(g)); });
    regionRow.appendChild(rstrip);
    rows.appendChild(regionRow);
    // My List first (it's yours), then each addon's rows in order.
    var mine = S.myList().map(function (e) { return { id: e.id, type: e.type, name: e.name, poster: e.poster, background: e.background, releaseInfo: e.releaseInfo }; });
    addRow('My List', '', mine.slice(0, 30), null);
    S.ensureManifests().then(function () {
      S.addons().forEach(function (a) {
        if (!a.m || !a.m.catalogs) return;
        a.m.catalogs.forEach(function (c) {
          if (!S.browsable(c) || !S.onHome(a, c)) return;
          var sub = S.typeLabel(c.type);
          var title = (c.name || '').toLowerCase() === sub.toLowerCase() ? sub : (c.name || c.id);
          S.catalog(a, c).then(S.forProfile).then(function (items) {
            addRow(title, title === sub ? '' : sub, items.slice(0, 30), a.url, function () {
              S.show(function (root) { grid(root, a, c, title); });
            });
          }).catch(function () {});
        });
      });
    });
  };

  // ---------- A whole row as a grid ("See all") ----------
  function grid(root, a, c, title) {
    var sc = el('div', 'scroll pad');
    sc.appendChild(el('h1', '', title));
    var g = el('div', 'grid');
    sc.appendChild(g);
    root.appendChild(sc);
    var skip = 0, busy = false, done = false;
    function more() {
      if (busy || done) return;
      busy = true;
      S.catalog(a, c, { skip: skip }).then(function (raw) {
        if (!raw.length) done = true;
        skip += raw.length;
        return S.forProfile(raw);
      }).then(function (items) {
        items.forEach(function (m) {
          var cd = card(m, function (x) { openTitle(x, a.url); });
          cd.onfocusitem = function () {
            // Near the end: load the next page.
            if (g.lastChild && cd.offsetTop > g.lastChild.offsetTop - 500) more();
          };
          g.appendChild(cd);
        });
        if (!S.focused() || !g.contains(S.focused())) S.focusFirst(g);
        busy = false;
      }).catch(function () { busy = false; done = true; });
    }
    more();
  }

  pages.live = function (root) { S.livePage(root); };

  // ---------- Search ----------
  pages.search = function (root) {
    var sc = el('div', 'scroll pad');
    sc.appendChild(el('h1', '', 'Search'));
    var input = el('input', 'f');
    input.placeholder = 'Movies and series… (press OK to type)';
    var results = el('div');
    sc.appendChild(input); sc.appendChild(results);
    root.appendChild(sc);
    var last = '';
    function run() {
      var q = input.value.trim();
      if (!q || q === last) return;
      last = q;
      results.innerHTML = '';
      S.addons().forEach(function (a) {
        if (!a.m || !a.m.catalogs) return;
        a.m.catalogs.forEach(function (c) {
          if (!S.searchable(c)) return;
          S.catalog(a, c, { search: q }).then(S.forProfile).then(function (items) {
            if (!items.length) return;
            var r = el('div', 'row');
            r.appendChild(el('div', 'row-title', S.typeLabel(c.type) + ' · ' + (a.m.name || '')));
            var strip = el('div', 'strip');
            items.slice(0, 30).forEach(function (m) { strip.appendChild(card(m, function (x) { openTitle(x, a.url); })); });
            r.appendChild(strip);
            results.appendChild(r);
          }).catch(function () {});
        });
      });
    }
    input.addEventListener('change', run);
    input.addEventListener('keydown', function (e) { if (e.keyCode === 13) run(); });
    S.focus(input);
  };

  // ---------- My List and Last watched ----------
  pages.list = function (root) {
    var sc = el('div', 'scroll pad');
    root.appendChild(sc);
    function section(title, items) {
      sc.appendChild(el('h2', '', title));
      if (!items.length) { sc.appendChild(el('div', 'muted', 'Nothing here yet.')); return; }
      var g = el('div', 'grid');
      items.forEach(function (m) { g.appendChild(card(m, function (x) { openTitle(x, x.addonUrl); })); });
      sc.appendChild(g);
    }
    sc.appendChild(el('h1', '', 'My List'));
    section('Saved', S.myList());
    section('Last watched', S.recent().map(function (e) { return e.item; }));
    S.focusFirst(sc);
  };

  // ---------- Profile: sign in, who's watching ----------
  pages.account = function (root) {
    var sc = el('div', 'scroll pad');
    root.appendChild(sc);
    if (!S.auth()) {
      sc.appendChild(el('h1', '', 'Sign in'));
      var cols = el('div', 'signin');
      var qrCol = el('div', 'qrcol hidden');
      var form = el('div', 'formcol');
      cols.appendChild(qrCol); cols.appendChild(form);
      sc.appendChild(cols);
      qrSignIn(qrCol);
      form.appendChild(el('p', 'muted', 'Use your Streamer account: your addons, TorBox, profiles and lists come with it.'));
      var email = el('input', 'f'); email.type = 'email'; email.placeholder = 'Email';
      var pw = el('input', 'f'); pw.type = 'password'; pw.placeholder = 'Password';
      var go = el('div', 'btn gold f', 'Sign in');
      go.onclick = function () {
        go.textContent = 'Signing in…';
        S.signIn(email.value.trim(), pw.value).then(S.loadAccount).then(S.checkMember).then(function () {
          toast('Signed in');
          open(S.allowed() ? 'home' : 'account');
        }).catch(function (e) {
          go.textContent = 'Sign in';
          toast('Could not sign in: ' + e.message, 5000);
        });
      };
      form.appendChild(email); form.appendChild(pw); form.appendChild(go);
      form.appendChild(el('p', 'muted', 'No account yet? Create one in the Streamer app or Streamer Lite, then sign in here.'));
      settings(sc);
      S.focus(email);
      return;
    }
    if (!S.allowed()) return blocked(sc);
    settings(sc);
    sc.appendChild(el('h1', '', 'Who’s watching?'));
    var wrap = el('div');
    var colors = ['#7c6cff', '#e5484d', '#34d399', '#f5c518', '#60a5fa', '#fb923c', '#ec4899', '#14b8a6'];
    S.profiles().forEach(function (p, i) {
      var t = el('div', 'profile f');
      var av = el('div', 'avatar', p.kids ? '☺' : (p.name || '?').charAt(0).toUpperCase());
      av.style.background = p.color ? '#' + (p.color >>> 0).toString(16).slice(2) : colors[i % colors.length];
      t.appendChild(av);
      t.appendChild(el('div', '', p.name + (p.id === S.activeProfile().id ? ' ✓' : '')));
      if (p.pin) t.appendChild(el('div', 'muted small', 'Passcode'));
      t.onclick = function () {
        function go() { S.store('profile', p.id); toast('Watching as ' + p.name); open('home'); }
        if (p.pin) askPin(root, p, go); else go();
      };
      wrap.appendChild(t);
    });
    sc.appendChild(wrap);
    sc.appendChild(el('p', 'muted', 'Signed in as ' + S.auth().email));
    var refresh = el('div', 'btn f', 'Refresh from account');
    refresh.onclick = function () { S.loadAccount().then(function () { toast('Updated'); open('account'); }); };
    var out = el('div', 'btn f', 'Sign out');
    out.onclick = function () { S.signOut(); toast('Signed out'); open('account'); };
    sc.appendChild(refresh); sc.appendChild(out);
    devices(sc);
    S.focusFirst(wrap);
  };

  // "Your devices": what's signed in to this account; sign others out.
  function devices(sc) {
    var box = el('div');
    sc.appendChild(box);
    S.myDevices().then(function (list) {
      if (!list || !document.body.contains(box)) return;
      box.appendChild(el('h2', '', 'Your devices'));
      list.forEach(function (d) {
        var me = d.device_id === S.deviceId();
        var row = el('div', 'devrow');
        row.appendChild(el('span', 'dot' + (d.online || me ? ' on' : '')));
        var info = el('div', 'devinfo');
        info.appendChild(el('div', 'devname', d.device + (me ? ' \u00b7 this TV' : '')));
        var sub = d.watching ? 'Watching ' + d.watching : (d.online || me ? 'Online now' : 'Last seen ' + ago(d.last_ping));
        info.appendChild(el('div', 'muted', sub + (d.profile ? ' \u00b7 ' + d.profile : '')));
        row.appendChild(info);
        if (!me) {
          var b = el('div', 'btn f', 'Sign out');
          b.onclick = function () {
            if (b.getAttribute('data-sure') !== '1') {
              b.setAttribute('data-sure', '1');
              b.textContent = 'Press again to sign out';
              return;
            }
            b.textContent = 'Signing out\u2026';
            S.signOutDevice(d.device_id).then(function (ended) {
              toast(ended ? d.device + ' is being signed out.'
                : d.device + ' hasn\u2019t checked in since the update. Open Streamer on it once, then try again.', 6000);
              open('account');
            }).catch(function (e) { b.textContent = 'Sign out'; toast('Could not sign it out: ' + e.message, 5000); });
          };
          row.appendChild(b);
        }
        box.appendChild(row);
      });
    }).catch(function () {});
  }
  function ago(iso) {
    var m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (!(m >= 0)) return 'a while ago';
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    if (m < 1440) return Math.floor(m / 60) + ' h ago';
    var d = Math.floor(m / 1440);
    return d === 1 ? 'yesterday' : d + ' days ago';
  }

  // Passcode pad for a locked profile (numbers on the remote work too).
  function askPin(root, p, done) {
    root.innerHTML = '';
    var sc = el('div', 'scroll pad pinpage');
    root.appendChild(sc);
    sc.appendChild(el('h1', '', 'Enter the passcode for ' + p.name));
    var dots = el('div', 'pindots');
    var msg = el('div', 'pinmsg', '');
    sc.appendChild(dots); sc.appendChild(msg);
    var digits = '';
    function draw() {
      dots.innerHTML = '';
      for (var i = 0; i < 4; i++) dots.appendChild(el('span', i < digits.length ? 'full' : ''));
    }
    function press(d) {
      if (digits.length >= 4) return;
      digits += d;
      msg.textContent = '';
      draw();
      if (digits.length === 4) {
        if (S.pinHash(p.id, digits) === p.pin) { stop(); done(); return; }
        digits = '';
        msg.textContent = 'Wrong passcode. Try again.';
        setTimeout(draw, 150);
      }
    }
    function onKey(e) {
      if (!document.body.contains(sc)) { stop(); return; }
      var k = e.key;
      if (k && k.length === 1 && k >= '0' && k <= '9') { press(k); e.preventDefault(); }
      else if (e.keyCode >= 48 && e.keyCode <= 57) { press(String(e.keyCode - 48)); e.preventDefault(); }
    }
    function stop() { document.removeEventListener('keydown', onKey, true); }
    document.addEventListener('keydown', onKey, true);
    var pad = el('div', 'pinpad');
    var first = null;
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'x', '0', '<'].forEach(function (k) {
      var b = el('div', 'btn f pinkey', k === 'x' ? 'Cancel' : (k === '<' ? 'Delete' : k));
      b.onclick = function () {
        if (k === 'x') { stop(); open('account'); }
        else if (k === '<') { digits = digits.slice(0, -1); draw(); }
        else press(k);
      };
      if (k === '1') first = b;
      pad.appendChild(b);
    });
    sc.appendChild(pad);
    // Forgot: the account password opens it (remove the passcode in the app).
    var forgot = el('div', 'btn f', 'Forgot passcode?');
    forgot.onclick = function () {
      forgot.classList.add('hidden');
      var pw = el('input', 'f'); pw.type = 'password'; pw.placeholder = 'Account password';
      var ok = el('div', 'btn gold f', 'Open ' + p.name);
      ok.onclick = function () {
        ok.textContent = 'Checking\u2026';
        S.signIn(S.auth().email, pw.value).then(function () { stop(); done(); })
          .catch(function () { ok.textContent = 'Open ' + p.name; toast('Wrong password.', 4000); });
      };
      sc.appendChild(el('p', 'muted', 'Enter the account password. To remove the passcode, edit the profile in the Streamer app.'));
      sc.appendChild(pw); sc.appendChild(ok);
      S.focus(pw);
    };
    sc.appendChild(forgot);
    draw();
    S.focus(first);
  }
  function toast(m, ms) { S.toast(m, ms); }
  S.onSignedOut(function () { open('account'); });

  // Signed in, but not active: why, and how to reach Hassan.
  function blocked(sc) {
    var m = S.member() || {}, c = S.contact() || {};
    var ended = m.until && new Date(m.until) < new Date() && (m.status === 'trial' || m.status === 'active');
    var box = el('div', 'blocked');
    box.appendChild(el('h1', '', m.error ? 'Can’t check your account'
      : ended ? 'Your subscription has ended'
      : m.status === 'off' ? 'Your account is turned off' : 'Waiting for activation'));
    box.appendChild(el('p', 'muted', m.error ? 'Check the internet connection, then try again.'
      : ended ? 'Renew it to keep watching.'
      : m.status === 'off' ? 'Get in touch to turn it back on.'
      : 'Your account is created. It works as soon as it’s activated.'));
    if (!m.error && (c.message || c.whatsapp || c.phone)) {
      var card = el('div', 'contact');
      if (c.message) card.appendChild(el('div', 'cmsg', c.message));
      if (c.whatsapp) card.appendChild(el('div', 'cline', 'WhatsApp  ' + c.whatsapp));
      if (c.phone) card.appendChild(el('div', 'cline', 'Phone  ' + c.phone));
      box.appendChild(card);
    }
    box.appendChild(el('p', 'muted', 'Signed in as ' + S.auth().email));
    var again = el('div', 'btn gold f', 'Check again');
    again.onclick = function () {
      again.textContent = 'Checking…';
      S.checkMember().then(function () { open(S.allowed() ? 'home' : 'account'); });
    };
    var out = el('div', 'btn f', 'Sign out');
    out.onclick = function () { S.signOut(); toast('Signed out'); open('account'); };
    box.appendChild(again); box.appendChild(out);
    sc.appendChild(box);
    S.focus(again);
  }

  // "Scan with your phone": a QR code that someone approves on their
  // phone (site/link). Stays hidden when the server isn't set up for it.
  var LINK_PAGE = 'https://hassanshamso12-sys.github.io/streamer-app/link/';
  function qrSignIn(box) {
    var code = null, made = 0, busy = false, timer = 0;
    function draw() {
      box.innerHTML = '';
      box.appendChild(el('h2', '', 'Sign in with your phone'));
      box.appendChild(el('p', 'muted', 'Point your phone\u2019s camera at the code, then tap \u201cSign in the TV\u201d on your phone.'));
      var frame = el('div', 'qrframe');
      frame.appendChild(window.QR.canvas(LINK_PAGE + '?c=' + code.code, 300));
      box.appendChild(frame);
      box.appendChild(el('p', 'muted', 'Or open ' + LINK_PAGE.replace('https://', '') + ' and enter'));
      box.appendChild(el('div', 'qrcode', code.code.slice(0, 4) + '-' + code.code.slice(4)));
    }
    function fresh() {
      made = Date.now();
      S.newLoginCode().then(function (c) {
        code = c;
        box.classList.remove('hidden');
        draw();
      }).catch(function (e) {
        code = null;
        // qr_login.sql not run yet: no QR, email and password only.
        if (/login_code_new|Could not find/i.test(e.message || '')) clearInterval(timer);
      });
    }
    function tick() {
      if (!document.body.contains(box)) { clearInterval(timer); return; }
      if (busy) return;
      if (!code) { if (Date.now() - made > 20000) fresh(); return; }
      if (Date.now() - made > 280000) { fresh(); return; } // codes last 5 minutes
      busy = true;
      S.loginCodeStatus(code).then(function (st) {
        if (st === 'expired') { busy = false; fresh(); return; }
        if (st !== 'approved') { busy = false; return; }
        box.innerHTML = '';
        box.appendChild(el('h2', '', 'Signing in\u2026'));
        return S.signInWithCode(code).then(S.loadAccount).then(S.checkMember).then(function () {
          clearInterval(timer);
          toast('Signed in');
          open(S.allowed() ? 'home' : 'account');
        }).catch(function (e) {
          busy = false;
          toast('Could not sign in: ' + e.message, 5000);
          fresh();
        });
      }).catch(function () { busy = false; }); // offline: try again
    }
    fresh();
    timer = setInterval(tick, 2500);
  }

  // Audio and subtitle choices (saved on this TV).
  function settings(sc) {
    sc.appendChild(el('h2', '', 'Audio & subtitles'));
    var dub = el('div', 'btn f');
    function drawDub() {
      var on = S.store('dub_tr') !== false;
      dub.textContent = 'Turkish titles: Arabic dub first · ' + (on ? 'ON' : 'OFF');
      dub.classList.toggle('gold', on);
    }
    dub.onclick = function () { S.store('dub_tr', S.store('dub_tr') === false); drawDub(); };
    drawDub();
    var sub = el('div', 'btn f');
    function drawSub() {
      var l = S.subLangs()[0];
      sub.textContent = 'Subtitles: ' + (l === 'eng' ? 'English first' : 'Arabic first');
    }
    sub.onclick = function () {
      S.store('sublangs', S.subLangs()[0] === 'eng' ? ['ara', 'eng'] : ['eng', 'ara']);
      drawSub();
    };
    drawSub();
    sc.appendChild(dub); sc.appendChild(sub);
    sc.appendChild(el('p', 'muted small', 'TV browsers can’t switch the audio inside a file, so the dub comes ' +
      'from picking the right stream: look for “Arabic dub · مدبلج” on streams, or let Best pick choose it.'));
  }

  // ---------- Title page ----------
  function detail(root, m, from) {
    var bg = el('div', 'detail-bg');
    if (m.background) bg.style.backgroundImage = 'url("' + m.background + '")';
    var sc = el('div', 'scroll');
    var d = el('div', 'detail');
    sc.appendChild(d);
    root.appendChild(bg); root.appendChild(sc);
    var head = el('div');
    d.appendChild(head);
    var body = el('div');
    d.appendChild(body);

    function drawHead(mm) {
      head.innerHTML = '';
      head.appendChild(el('h1', '', mm.name || ''));
      var line = el('div', 'meta-line');
      if (mm.imdbRating) { var i = el('span'); i.appendChild(el('span', 'imdb', 'IMDb')); i.appendChild(document.createTextNode(' ' + mm.imdbRating)); line.appendChild(i); }
      if (mm.releaseInfo) line.appendChild(el('span', '', mm.releaseInfo));
      if (mm.runtime) line.appendChild(el('span', '', mm.runtime));
      head.appendChild(line);
      (mm.genres || []).slice(0, 4).forEach(function (g) { head.appendChild(el('span', 'tag', g)); });
      if (mm.description) head.appendChild(el('p', 'desc', mm.description));
    }
    drawHead(m);
    body.appendChild(el('div', 'muted', 'Loading…'));

    S.meta(m.type, m.id, from).then(function (full) {
      full = full || m;
      if (!full.background && m.background) full.background = m.background;
      if (full.background) bg.style.backgroundImage = 'url("' + full.background + '")';
      drawHead(full);
      // Checks the streams for Arabic audio (also series and Torrentio).
      S.dubCheck(full.type, full.id).then(function (yes) {
        if (yes) head.insertBefore(el('span', 'tag gold', '🗣 Arabic dub available · مدبلج'), head.querySelector('.tag') || null);
      });
      body.innerHTML = '';
      var vids = full.videos || [];
      var series = vids.length && !(vids.length === 1 && vids[0].id === full.id);
      var go = function () { if (series) seasons(body, full); else streamList(body, full.type, full.id, full.name); };
      if (!S.activeProfile().kids) return go();
      S.kidsOk(full).then(function (ok) {
        if (ok) return go();
        S.ageOf(full.id, full.type).then(function (age) {
          body.appendChild(el('div', 'stream', age === null
            ? '🔒 Horror isn’t available in Kids profiles.'
            : '🔒 Rated ' + age + '+. Kids profiles can watch titles rated up to ' + S.KIDS_MAX + '.'));
        });
      });
    });
  }

  function seasons(body, m) {
    var vids = m.videos.slice().sort(function (a, b) {
      return (a.season || 0) - (b.season || 0) || (a.episode || 0) - (b.episode || 0);
    });
    var list = [];
    vids.forEach(function (v) { var s = v.season || 1; if (list.indexOf(s) < 0) list.push(s); });
    if (list.length > 1 && list[0] === 0) list.push(list.shift()); // specials last
    var bar = el('div'), eps = el('div');
    body.appendChild(el('h2', '', 'Episodes'));
    body.appendChild(bar); body.appendChild(eps);
    function pick(season, btn) {
      [].forEach.call(bar.children, function (b) { b.classList.remove('gold'); });
      if (btn) btn.classList.add('gold');
      eps.innerHTML = '';
      vids.filter(function (v) { return (v.season || 1) === season; }).forEach(function (v) {
        var code = v.season != null && v.episode != null ? 'S' + v.season + 'E' + v.episode + ' · ' : '';
        var e = el('div', 'ep f', code + (v.title || v.name || 'Episode'));
        var at = S.resumeAt(v.id);
        if (at) e.appendChild(el('span', 'muted', '   · resume ' + S.fmtTime(at)));
        e.onclick = function () {
          S.show(function (root) {
            var sc = el('div', 'scroll pad');
            root.appendChild(sc);
            sc.appendChild(el('h1', '', m.name));
            sc.appendChild(el('div', 'muted', code + (v.title || '')));
            var b = el('div'); sc.appendChild(b);
            streamList(b, m.type, v.id, m.name + ' · ' + code.replace(' · ', ''));
          });
        };
        eps.appendChild(e);
      });
    }
    list.forEach(function (s, i) {
      var b = el('div', 'btn f', s === 0 ? 'Specials' : 'Season ' + s);
      b.onclick = function () { pick(s, b); };
      bar.appendChild(b);
      if (i === 0) { pick(s, b); S.focus(b); }
    });
  }

  function streamList(body, type, videoId, title) {
    var head = el('h2', '', 'Finding streams…');
    var box = el('div');
    body.appendChild(head); body.appendChild(box);
    var focusedOnce = false;
    function tags(x) {
      var t = el('div');
      if (x.q) t.appendChild(el('span', 'tag', x.q === 2160 ? '4K' : x.q + 'p'));
      if (x.debrid) t.appendChild(el('span', 'tag' + (x.ready ? ' gold' : ''),
        x.ready ? '⚡ ' + x.service + ' · Ready' : x.service + ' · not cached'));
      if (x.sizeMb) t.appendChild(el('span', 'tag', x.sizeMb >= 1024 ? (x.sizeMb / 1024).toFixed(1) + ' GB' : Math.round(x.sizeMb) + ' MB'));
      if (x.arabicDub) t.appendChild(el('span', 'tag gold', 'Arabic dub · مدبلج'));
      else if (x.arabicAudio && x.multi) t.appendChild(el('span', 'tag gold', 'Arabic audio'));
      else if (x.arabicSubs) t.appendChild(el('span', 'tag', 'Arabic subs · مترجم'));
      if (x.otherDub) t.appendChild(el('span', 'tag warn', 'Dubbed (other language)'));
      else if (x.multi && !x.arabicAudio) t.appendChild(el('span', 'tag warn', 'Multi-audio: may start in another language'));
      if (x.av1 || x.hevc || x.badAudio) t.appendChild(el('span', 'tag warn', 'May not play on this TV'));
      t.appendChild(el('span', 'tag', x.addon || ''));
      return t;
    }
    function row(x, label, cls) {
      var s = el('div', 'stream f' + (cls ? ' ' + cls : ''));
      s.appendChild(el('div', 't', (label ? label + ' · ' : '') + x.label));
      s.appendChild(tags(x));
      s.onclick = function () {
        S.player.play({ url: x.s.url, title: title, type: type, videoId: videoId,
          subs: x.s.subtitles || [], fileName: ((x.s.behaviorHints || {}).filename) || x.label });
      };
      return s;
    }
    S.streams(type, videoId, function (all, done) {
      var keep = S.focused() && box.contains(S.focused()) ? S.focused().textContent : null;
      box.innerHTML = '';
      head.textContent = all.length ? 'Streams · ' + all.length + (done ? '' : ' (searching…)')
        : (done ? 'No streams this TV can play. Sign in (Profile) with TorBox connected.' : 'Finding streams…');
      if (!all.length) return;
      var best = all[0];
      // A second good choice: another quality, or a much smaller file
      // (for weak internet).
      var alt = all.slice(1).filter(function (x) {
        return x.score > 60 && (x.q !== best.q || (best.sizeMb && x.sizeMb && x.sizeMb < best.sizeMb * 0.6));
      })[0];
      box.appendChild(row(best, '★ BEST PICK', 'best'));
      if (alt) {
        var why = alt.q !== best.q ? alt.q + 'p' : 'smaller file';
        box.appendChild(row(alt, 'ALSO GOOD · ' + why, 'alt'));
      }
      box.appendChild(el('h2', '', 'All streams'));
      all.slice(0, 40).forEach(function (x) {
        if (x === best || x === alt) return;
        box.appendChild(row(x));
      });
      if (!focusedOnce) { focusedOnce = true; S.focus(box.querySelector('.f')); }
      else if (keep) {
        var again = [].filter.call(box.querySelectorAll('.f'), function (e) { return e.textContent === keep; })[0];
        if (again) S.focus(again);
      }
    });
  }

  window.STV.open = open;
})();
