/* Streamer TV: the player, the remote keys, and start-up. */
(function () {
  'use strict';
  var S = window.STV, $ = S.$, el = S.el;
  var video = $('video'), box = $('player'), osd = $('osd'), sheet = $('sheet');
  var cur = null, hls = null, osdTimer = 0, saveTimer = 0, track = null;
  var subTrack = null, lastCueText = '';

  // Controls show on any key or pointer movement and hide after a few
  // seconds of playing (not while paused or while a button is chosen).
  var btns = [].slice.call(osd.querySelectorAll('.pbtn'));
  // Small back arrow, always in the corner (the OSD's "Back" covers it
  // while the controls show).
  S.$('pback').onclick = function () { S.back(); };
  var pf = -1; // which control button the remote is on (-1 = none)
  function showOsd() {
    osd.classList.remove('off');
    box.classList.remove('idle');
    box.classList.add('osd-on');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () {
      if (!video.paused && sheet.classList.contains('hidden')) {
        osd.classList.add('off');
        box.classList.add('idle');
        box.classList.remove('osd-on');
        setBtn(-1);
      }
    }, 4500);
  }
  function osdVisible() { return !osd.classList.contains('off'); }
  function setBtn(i) {
    btns.forEach(function (b) { b.classList.remove('focus'); });
    pf = i;
    if (i >= 0) btns[i].classList.add('focus');
  }
  function press(a) {
    showOsd();
    if (a === 'back') return S.back();
    if (a === 'play') return video.paused ? video.play() : video.pause();
    if (a === 'rew') return seek(-10);
    if (a === 'fwd') return seek(10);
    if (a === 'subs') return openSheet();
  }
  function seek(sec) {
    video.currentTime = Math.max(0, Math.min((video.duration || 1e9) - 1, video.currentTime + sec));
    tick();
  }
  btns.forEach(function (b, i) {
    b.onclick = function () { setBtn(i); press(b.getAttribute('data-a')); };
    b.onmouseover = function () { setBtn(i); };
  });
  box.addEventListener('mousemove', showOsd);
  function tick() {
    var d = video.duration || 0, t = video.currentTime || 0;
    if (!isFinite(d)) d = 0;
    $('osd-fill').style.width = d ? (t / d * 100) + '%' : '0';
    var b = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
    $('osd-buf').style.width = d ? (b / d * 100) + '%' : '0';
    $('osd-time').textContent = (cur && cur.live) || !isFinite(d) ? '● LIVE' : S.fmtTime(t) + ' / ' + S.fmtTime(d);
    var p = osd.querySelector('[data-a="play"]');
    if (p) p.textContent = video.paused ? '▶' : '❚❚';
  }
  video.addEventListener('timeupdate', function () {
    tick();
    if (subTrack) drawCues(subTrack); // reliable on every TV
  });
  video.addEventListener('progress', tick);
  video.addEventListener('waiting', function () { $('spinner').classList.remove('hidden'); });
  video.addEventListener('playing', function () { $('spinner').classList.add('hidden'); showOsd(); });
  video.addEventListener('pause', function () { tick(); showOsd(); });
  video.addEventListener('error', function () {
    if (!cur || hls) return; // hls.js reports its own errors
    var url = cur.url, m3u8 = /\.m3u8(\?|$)/i.test(url);
    var httpOnHttps = location.protocol === 'https:' && /^http:/i.test(url);
    if (m3u8 && !triedHls && !httpOnHttps && window.Hls && Hls.isSupported()) return useHls(url);
    playbackFailed();
  });

  function save() {
    if (cur && video.duration) S.saveResume(cur.videoId, video.currentTime, video.duration);
  }

  function play(item) {
    cur = item;
    S.watching((item.live ? 'Live TV: ' : '') + (item.title || ''));
    box.classList.remove('hidden');
    sheet.classList.add('hidden');
    $('osd-title').textContent = item.title || '';
    $('spinner').classList.remove('hidden');
    setBtn(-1);
    showOsd();
    S.pushPlayer(); // so the TV's Back closes the player, not the page
    box.classList.toggle('live', !!item.live);
    $('osd-hint').textContent = item.live
      ? 'OK pause · ▲ ▼ change channel · Back exit'
      : 'OK pause · ◀ ▶ 10 s · ▼ buttons · ▲ subtitles · Back exit';
    var at = item.live ? 0 : S.resumeAt(item.videoId);
    if (hls) { hls.destroy(); hls = null; }
    startSource(item);
    video.onloadedmetadata = function () {
      if (at && at < video.duration - 60) video.currentTime = at;
      video.play();
    };
    clearInterval(saveTimer);
    if (item.live) { clearTrack(); return; }
    saveTimer = setInterval(save, 10000);
    loadSubtitle(item);
  }
  // HLS (live TV, some films): hls.js first, because it handles streams
  // with separate audio tracks (like MTV Lebanon) that TV players reject.
  // The TV's own player is the fallback, and the only option for http
  // streams on this secure page. If one fails, the other is tried.
  var triedNative = false, triedHls = false;
  function startSource(item) {
    triedNative = triedHls = false;
    var m3u8 = /\.m3u8(\?|$)/i.test(item.url);
    var httpOnHttps = location.protocol === 'https:' && /^http:/i.test(item.url);
    if (m3u8 && !httpOnHttps && window.Hls && Hls.isSupported()) useHls(item.url);
    else useNative(item.url);
  }
  function useHls(url) {
    triedHls = true;
    if (hls) { hls.destroy(); hls = null; }
    hls = new Hls({ maxBufferLength: 30 });
    hls.on(Hls.Events.ERROR, function (ev, d) {
      if (!d.fatal) return;
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR && !d.details.match(/manifest/i)) return hls.startLoad();
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR) return hls.recoverMediaError();
      hls.destroy(); hls = null;
      if (!triedNative && video.canPlayType('application/vnd.apple.mpegurl')) useNative(url);
      else playbackFailed();
    });
    hls.loadSource(url);
    hls.attachMedia(video);
  }
  function useNative(url) {
    triedNative = true;
    if (hls) { hls.destroy(); hls = null; }
    video.src = url;
  }
  function playbackFailed() {
    $('spinner').classList.add('hidden');
    S.toast(cur && cur.live
      ? 'This channel isn’t playing in this TV’s browser right now. Try another channel, or the Streamer app.'
      : 'This TV can’t play this file. Go back and choose another stream (H.264 / MP4 work best).', 7000);
  }

  // Live TV: next / previous channel in the same category.
  function zap(step) {
    if (!cur || !cur.list) return;
    var n = cur.list.length, i = (cur.index + step + n) % n;
    var next = cur.list[i];
    var item = { url: next.url, title: next.name, type: 'tv', videoId: 'live:' + next.id, live: true,
      list: cur.list, index: i, subs: [] };
    window.history.back(); // replace the player step instead of adding one
    setTimeout(function () { play(item); }, 60);
  }

  // The best subtitle in your languages: the stream's own, else the addons'.
  function loadSubtitle(item) {
    clearTrack();
    var own = (item.subs || []).map(function (s) { return { url: s.url, lang: s.lang }; });
    S.findSubtitles(item.type, item.videoId).then(function (found) {
      if (!cur || cur !== item) return;
      cur.subList = S.sortSubtitles(own.concat(found), item.fileName);
      var langs = S.subLangs();
      var best = cur.subList.filter(function (s) { return langs.indexOf(s.lang) >= 0; })[0];
      if (best) useSubtitle(best);
    });
  }
  function clearTrack() {
    if (track) { track.parentNode.removeChild(track); track = null; }
    $('subs').innerHTML = '';
    subTrack = null;
    lastCueText = '';
  }
  function drawCues(tt) {
    var box2 = $('subs');
    var cues = tt.activeCues || [];
    var key = '';
    for (var j = 0; j < cues.length; j++) key += cues[j].startTime + '|';
    if (key === lastCueText) return; // unchanged: don't redraw
    lastCueText = key;
    box2.innerHTML = '';
    for (var i = 0; i < cues.length; i++) {
      var span = document.createElement('span');
      span.textContent = String(cues[i].text || '').replace(/<[^>]+>/g, '');
      box2.appendChild(span);
      box2.appendChild(document.createElement('br'));
    }
  }
  function useSubtitle(s) {
    clearTrack();
    if (!s) return;
    S.subtitleText(s).then(function (txt) {
      var vtt = /^WEBVTT/.test(txt) ? txt : S.srtToVtt(txt);
      track = document.createElement('track');
      track.kind = 'subtitles';
      track.srclang = s.lang || 'und';
      track.default = true;
      track.src = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      video.appendChild(track);
      // Drawn by us (above the controls when they show), not by the browser.
      setTimeout(function () {
        var tt = video.textTracks[video.textTracks.length - 1];
        if (!tt) return;
        tt.mode = 'hidden';
        subTrack = tt;
        tt.oncuechange = function () { drawCues(tt); };
      }, 300);
      cur.sub = s;
    }).catch(function () { S.toast('Could not load that subtitle.'); });
  }

  // ▲ in the player: subtitles and (when the file has several) audio.
  function openSheet() {
    sheet.innerHTML = '';
    sheet.classList.remove('hidden');
    sheet.appendChild(el('h2', '', 'Subtitles'));
    var off = el('div', 'opt f' + (!cur.sub ? ' on' : ''), 'Off');
    off.onclick = function () { clearTrack(); cur.sub = null; closeSheet(); };
    sheet.appendChild(off);
    (cur.subList || []).slice(0, 20).forEach(function (s) {
      var o = el('div', 'opt f' + (cur.sub === s ? ' on' : ''),
        (s.lang || '?').toUpperCase() + ' · ' + String(s.label || s.source || '').slice(0, 42));
      o.onclick = function () { useSubtitle(s); closeSheet(); };
      sheet.appendChild(o);
    });
    var at = video.audioTracks;
    if (at && at.length > 1) {
      sheet.appendChild(el('h2', '', 'Audio'));
      for (var i = 0; i < at.length; i++) {
        (function (t) {
          var o = el('div', 'opt f' + (t.enabled ? ' on' : ''), (t.language || t.label || 'Track').toUpperCase());
          o.onclick = function () {
            for (var j = 0; j < at.length; j++) at[j].enabled = at[j] === t;
            closeSheet();
          };
          sheet.appendChild(o);
        })(at[i]);
      }
    }
    S.focusFirst(sheet);
  }
  function closeSheet() { sheet.classList.add('hidden'); }

  function close() {
    save();
    clearInterval(saveTimer);
    video.pause();
    if (hls) { hls.destroy(); hls = null; }
    video.removeAttribute('src');
    video.load();
    clearTrack();
    box.classList.add('hidden');
    closeSheet();
    setBtn(-1);
    cur = null;
    S.watching(null);
  }

  // Too many screens on this account: stop and say why.
  S.onScreenLimit(function (j) {
    if (!cur) return;
    var max = j.max, others = (j.playing || []).map(function (x) {
      return x.device + (x.profile ? ' (' + x.profile + ')' : '') + (x.watching ? ': ' + x.watching : '');
    });
    window.history.back(); // closes the player, like the Back key
    S.toast('Too many screens. ' +
      (max ? 'This account can play on ' + max + (max === 1 ? ' screen' : ' screens') + ' at the same time. ' : '') +
      (others.length ? 'Playing now: ' + others.join(' / ') + '. ' : '') +
      'Stop one of them, then try again.', 12000);
  });

  // Signed out from another device: stop playing.
  S.onSignedOut(function () { if (cur) window.history.back(); });

  var player = { play: play, close: close };
  S.player = player;
  S.setPlayer(player);

  // ---------- Remote keys ----------
  // LG Back = 461, Samsung Back = 10009, plus Escape / Backspace on PCs.
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    var inInput = document.activeElement && document.activeElement.tagName === 'INPUT';
    var playing = !box.classList.contains('hidden');
    var sheetOpen = playing && !sheet.classList.contains('hidden');
    if (k === 461 || k === 10009 || k === 27 || (k === 8 && !inInput)) {
      e.preventDefault();
      return S.backFromKey();
    }
    if (playing && !sheetOpen) {
      if (cur && cur.live && (k === 37 || k === 39) && pf < 0) { e.preventDefault(); return; }
      var wasHidden = !osdVisible();
      showOsd();
      var ok = k === 13 || k === 415 || k === 19 || k === 179;
      // On the button row: ◀ ▶ choose, OK presses, ▲ leaves the row.
      if (pf >= 0 && !wasHidden) {
        e.preventDefault();
        if (k === 37) return setBtn(pf === 1 ? 0 : Math.max(1, pf - 1));
        if (k === 39) return setBtn(pf === 0 ? 2 : Math.min(btns.length - 1, pf + 1));
        if (k === 38) return setBtn(pf === 0 ? -1 : 0);
        if (k === 40) return setBtn(pf === 0 ? 2 : -1);
        if (ok) return press(btns[pf].getAttribute('data-a'));
        return;
      }
      if (ok) { e.preventDefault(); video.paused ? video.play() : video.pause(); return; }
      if (k === 37 || k === 412) { e.preventDefault(); return seek(-10); }
      if (k === 39 || k === 417) { e.preventDefault(); return seek(10); }
      if (cur && cur.live && (k === 38 || k === 33)) { e.preventDefault(); return zap(-1); }
      if (cur && cur.live && (k === 40 || k === 34)) { e.preventDefault(); return zap(1); }
      if (k === 38) { e.preventDefault(); return openSheet(); }
      if (k === 40) { e.preventDefault(); return setBtn(2); } // onto ❚❚
      return;
    }
    var dir = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' }[k];
    if (dir) {
      // Typing in a box: left / right move the cursor, up / down leave it.
      if (inInput && (dir === 'left' || dir === 'right')) return;
      e.preventDefault();
      S.move(dir);
      return;
    }
    if (k === 13 && !inInput) {
      var f = S.focused();
      if (f && f.onclick) { e.preventDefault(); f.onclick(); }
    }
  });
  // Mouse / Magic Remote pointer: clicking focuses and opens.
  // Air mouse / Magic Remote: hovering highlights without moving the page;
  // the wheel (or ▲ ▼) scrolls.
  document.addEventListener('mouseover', function (e) {
    var t = e.target.closest ? e.target.closest('.f') : null;
    if (t && t !== S.focused()) S.focus(t, true);
  });
  document.addEventListener('wheel', function (e) {
    var t = e.target.closest ? e.target.closest('.strip, .rows, .scroll, #sheet') : null;
    if (!t) return;
    if (t.classList.contains('strip') && Math.abs(e.deltaX) > Math.abs(e.deltaY)) t.scrollLeft += e.deltaX;
    else {
      var sc = t.classList.contains('strip') ? t.closest('.rows, .scroll') : t;
      if (sc) sc.scrollTop += e.deltaY;
    }
    e.preventDefault();
  }, { passive: false });
  window.addEventListener('beforeunload', save);

  // Samsung Tizen: ask for the media keys.
  try {
    if (window.tizen && tizen.tvinputdevice) {
      ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaRewind', 'MediaFastForward'].forEach(function (k) {
        tizen.tvinputdevice.registerKey(k);
      });
    }
  } catch (err) {}

  // ---------- Start ----------
  S.loadAccount().catch(function () {}).then(S.checkMember).then(function () {
    S.open(S.allowed() ? 'home' : 'account');
    S.ping(false); // online now
    endsSoonNote();
    S.loadDubLists(); // poster labels, once a day
  });
  // "Your subscription ends in 2 days": once a day, in the last 3 days.
  function endsSoonNote() {
    var m = S.member();
    if (!S.allowed() || !m || !m.until) return;
    var until = new Date(m.until), left = until - new Date();
    if (left <= 0 || left > 3 * 86400000) return;
    var d = new Date(), today = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    if (S.store('ends_note') === today) return;
    S.store('ends_note', today);
    var a = new Date(until.getFullYear(), until.getMonth(), until.getDate());
    var b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var days = Math.round((a - b) / 86400000);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var date = until.getDate() + ' ' + months[until.getMonth()];
    var when = days <= 0 ? 'today' : days === 1 ? 'tomorrow (' + date + ')' : 'in ' + days + ' days (' + date + ')';
    var wa = (S.contact() || {}).whatsapp;
    setTimeout(function () {
      S.toast('Your ' + (m.status === 'trial' ? 'trial' : 'subscription') + ' ends ' + when + '. ' +
        (wa ? 'To keep watching, renew on WhatsApp: ' + wa : 'Get in touch to renew and keep watching.'), 20000);
    }, 2500);
  }

  // Every 3 hours: still active? (Hassan may turn an account off.)
  setInterval(function () {
    S.checkMember().then(function () { if (!S.allowed()) S.open('account'); });
  }, 3 * 3600 * 1000);
  // When the dubbed lists arrive, label posters already on screen.
  S.onDubLists(function () {
    [].forEach.call(document.querySelectorAll('.card[data-id]'), function (c) {
      if (S.dubListed(c.getAttribute('data-id')) && !c.querySelector('.dub')) c.appendChild(el('div', 'dub', 'مدبلج'));
    });
  });
})();
