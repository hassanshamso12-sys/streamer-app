// TV remotes (LG webOS, Samsung Tizen): turn the Back key into Escape,
// which Streamer treats as "go back". Also register Samsung media keys.
(function () {
  var BACK = { 461: true, 10009: true }; // LG, Samsung
  document.addEventListener('keydown', function (e) {
    if (!BACK[e.keyCode]) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var target = document.activeElement || document.body;
    ['keydown', 'keyup'].forEach(function (type) {
      target.dispatchEvent(new KeyboardEvent(type, {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
      }));
    });
  }, true);
  try {
    if (window.tizen && tizen.tvinputdevice) {
      ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaFastForward', 'MediaRewind',
       'ChannelUp', 'ChannelDown'].forEach(function (k) {
        try { tizen.tvinputdevice.registerKey(k); } catch (_) {}
      });
    }
  } catch (_) {}
})();
