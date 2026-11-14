/* bgfx — background blur / replace for browser video calls (built for SP Jain ELO on Android Chrome).
   Runs as a bookmarklet. Hooks getUserMedia AND live WebRTC senders, so it works before or during class.
   Fail-safe: if anything breaks, the raw camera frame is sent, never a black frame. */
(function () {
  'use strict';
  var W = window, D = document;
  if (W.__bgfx) { W.__bgfx.open(); return; }

  var CDN = W.__BGFX_CDN || 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/';
  var KEY = 'bgfx-settings', IKEY = 'bgfx-image';
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  var S = { mode: 'blur', blur: 16, color: '#24384d' };
  try { var saved = JSON.parse(lsGet(KEY) || '{}'); for (var k in saved) S[k] = saved[k]; } catch (e) {}
  function persist() { lsSet(KEY, JSON.stringify(S)); }
  var bgImg = null;
  function setImg(src) { var i = new Image(); i.onload = function () { bgImg = i; ui(); }; i.src = src; }
  var savedImg = lsGet(IKEY); if (savedImg) setImg(savedImg);

  /* ---------- AI segmentation (MediaPipe Selfie Segmentation, landscape model) ---------- */
  var seg = null, segState = 'idle', segBusy = false, segFails = 0, pending = null;
  function loadSeg() {
    if (segState !== 'idle') return;
    segState = 'loading'; ui();
    try {
      var s = D.createElement('script');
      s.src = CDN + 'selfie_segmentation.js';
      s.crossOrigin = 'anonymous';
      s.onload = function () {
        try {
          seg = new W.SelfieSegmentation({ locateFile: function (f) { return CDN + f; } });
          seg.setOptions({ modelSelection: 1, selfieMode: false });
          seg.onResults(function (r) { var p = pending; pending = null; if (p) p(r); });
          seg.initialize().then(function () { if (segState === 'loading') { segState = 'ready'; ui(); } }, segFail);
        } catch (e) { segFail(e); }
      };
      s.onerror = segFail;
      (D.head || D.documentElement).appendChild(s);
    } catch (e) { segFail(e); }
    setTimeout(function () { if (segState === 'loading') segFail('timeout'); }, 60000);
  }
  function segFail(e) {
    segState = 'failed'; seg = null; segBusy = false;
    try { console.warn('[bgfx] AI model unavailable on this page; falling back to Spot mode.', e); } catch (_) {}
    ui();
  }

  /* ---------- per-camera processor ---------- */
  var procs = new Map(), outs = new WeakSet(), pcs = new Set();
  var nativeStop = MediaStreamTrack.prototype.stop;
  function isCam(t) {
    if (!t || t.kind !== 'video' || outs.has(t) || t.readyState !== 'live') return false;
    var st = {}; try { st = t.getSettings(); } catch (e) {}
    // Local cameras carry a groupId; remote (received) tracks and screen shares don't.
    if (!st.deviceId || !st.groupId || st.displaySurface || t.label === 'remote video') return false;
    return !remoteIds.has(t.id);
  }
  var remoteIds = new Set();
  function noteRemote(pc) { try { pc.getReceivers().forEach(function (r) { if (r.track) remoteIds.add(r.track.id); }); } catch (e) {} }
  function proc(raw, owns) {
    var p = procs.get(raw);
    if (p) { if (owns) p.owns = true; return p.out; }
    var v = D.createElement('video');
    v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.__bgfxMine = 1;
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01;pointer-events:none;z-index:-1';
    v.srcObject = new MediaStream([raw]);
    (D.body || D.documentElement).appendChild(v);
    v.play().catch(function () {});
    var c = D.createElement('canvas'); c.width = 640; c.height = 480;
    var out = c.captureStream().getVideoTracks()[0];
    outs.add(out);
    p = { raw: raw, out: out, v: v, c: c, x: c.getContext('2d'), owns: owns, dead: false, n: 0, fps: 0, t0: performance.now() };
    procs.set(raw, p);
    dress(p);
    raw.addEventListener('ended', function () { kill(p); });
    loop(p);
    if (S.mode !== 'off' && S.mode !== 'spot') loadSeg();
    ui();
    return out;
  }
  // Make the processed track look like the camera to the page.
  function dress(p) {
    var o = p.out, r = p.raw;
    o.stop = function () { kill(p); };
    o.getSettings = function () { var s = {}; try { s = r.getSettings(); } catch (e) {} s.width = p.c.width; s.height = p.c.height; return s; };
    o.getCapabilities = function () { return r.getCapabilities ? r.getCapabilities() : {}; };
    o.getConstraints = function () { return r.getConstraints(); };
    o.applyConstraints = function (c) { return r.applyConstraints(c); };
    try { Object.defineProperty(o, 'label', { get: function () { return r.label; } }); } catch (e) {}
    try { Object.defineProperty(o, 'enabled', { get: function () { return r.enabled; }, set: function (b) { r.enabled = b; } }); } catch (e) {}
  }
  function kill(p) {
    if (p.dead) return;
    p.dead = true; procs.delete(p.raw);
    try { nativeStop.call(p.out); } catch (e) {}
    if (p.owns) try { p.raw.stop(); } catch (e) {}
    try { p.v.srcObject = null; p.v.remove(); } catch (e) {}
    ui();
  }

  function loop(p) {
    var v = p.v;
    function next() {
      if (p.dead) return;
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(frame); else requestAnimationFrame(frame);
    }
    function done() { p.n++; var now = performance.now(); if (now - p.t0 >= 1000) { p.fps = Math.round(p.n * 1000 / (now - p.t0)); p.n = 0; p.t0 = now; } next(); }
    function frame() {
      if (p.dead) return;
      var w = v.videoWidth, h = v.videoHeight;
      if (!w || !h) { next(); return; }
      if (p.c.width !== w || p.c.height !== h) { p.c.width = w; p.c.height = h; }
      var m = S.mode;
      try {
        if (!p.raw.enabled) { p.x.fillStyle = '#000'; p.x.fillRect(0, 0, w, h); }
        else if (m === 'off') drawRaw(p);
        else if (m !== 'spot' && segState === 'ready' && !segBusy) {
          segBusy = true;
          pending = function (r) { try { compose(p, r.segmentationMask, r.image); } catch (e) { drawRaw(p); } };
          seg.send({ image: v }).then(function () {
            segBusy = false; segFails = 0;
            if (pending) { pending = null; drawRaw(p); }
            done();
          }, function (e) {
            segBusy = false; pending = null; drawRaw(p);
            if (++segFails > 5) segFail(e);
            done();
          });
          return;
        }
        else if (m !== 'spot' && segState === 'ready') drawRaw(p); // another camera holds the model this frame
        else compose(p, spotMask(p), v); // Spot mode, or AI still loading / unavailable
      } catch (e) { try { drawRaw(p); } catch (_) {} }
      done();
    }
    next();
  }
  function drawRaw(p) { p.x.drawImage(p.v, 0, 0, p.c.width, p.c.height); }
  function cv(o, key, w, h) { var c = o[key] || (o[key] = D.createElement('canvas')); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } return c; }

  function compose(p, mask, img) {
    var x = p.x, w = p.c.width, h = p.c.height, m = S.mode;
    // 1) background
    if (m === 'image' && bgImg) {
      var sc = Math.max(w / bgImg.naturalWidth, h / bgImg.naturalHeight), iw = bgImg.naturalWidth * sc, ih = bgImg.naturalHeight * sc;
      x.drawImage(bgImg, (w - iw) / 2, (h - ih) / 2, iw, ih);
    } else if (m === 'color' || m === 'image') {
      x.fillStyle = S.color; x.fillRect(0, 0, w, h);
    } else { // blur (and Spot): blur a quarter-size copy, then scale up — cheap on phones
      var sw = Math.max(16, w >> 2), sh = Math.max(16, h >> 2), r = Math.max(1, S.blur / 4), b = cv(p, 'b', sw, sh), bx = b.getContext('2d');
      bx.filter = 'blur(' + r + 'px)'; bx.drawImage(img, -2 * r, -2 * r, sw + 4 * r, sh + 4 * r); bx.filter = 'none';
      x.imageSmoothingEnabled = true; x.drawImage(b, 0, 0, w, h);
    }
    // 2) person = camera frame masked by the (slightly feathered) segmentation mask
    var f = cv(p, 'f', w, h), fx = f.getContext('2d');
    fx.globalCompositeOperation = 'copy';
    fx.filter = 'blur(' + Math.max(1, Math.round(w / 400)) + 'px)';
    fx.drawImage(mask, 0, 0, w, h);
    fx.filter = 'none';
    fx.globalCompositeOperation = 'source-in';
    fx.drawImage(img, 0, 0, w, h);
    fx.globalCompositeOperation = 'source-over';
    x.drawImage(f, 0, 0);
  }
  // No-AI fallback: soft oval around head and shoulders.
  function spotMask(p) {
    var w = p.c.width, h = p.c.height, m = cv(p, 'sm', w, h);
    if (m.__k === w + 'x' + h) return m;
    m.__k = w + 'x' + h;
    var g = m.getContext('2d'), land = w > h;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
    g.setTransform(land ? w * 0.32 : w * 0.48, 0, 0, land ? h * 0.75 : h * 0.55, w / 2, land ? h * 0.6 : h * 0.55);
    var gr = g.createRadialGradient(0, 0, 0.72, 0, 0, 1);
    gr.addColorStop(0, '#000'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(-1.5, -1.5, 3, 3);
    g.setTransform(1, 0, 0, 1, 0, 0);
    return m;
  }

  /* ---------- hooks: getUserMedia + WebRTC (also same-origin iframes) ---------- */
  var nativeReplace = W.RTCRtpSender && RTCRtpSender.prototype.replaceTrack;
  var nativeGetSenders = W.RTCPeerConnection && RTCPeerConnection.prototype.getSenders;
  function wrapStream(s) {
    try {
      var vt = s.getVideoTracks();
      for (var i = 0; i < vt.length; i++) if (isCam(vt[i])) { var o = proc(vt[i], true); s.removeTrack(vt[i]); s.addTrack(o); }
    } catch (e) {}
    return s;
  }
  function fixSender(snd) {
    try { if (isCam(snd.track)) nativeReplace.call(snd, proc(snd.track, false)).catch(function () {}); } catch (e) {}
  }
  function note(pc) { if (!pcs.has(pc)) { pcs.add(pc); setTimeout(function () { fixPc(pc); }, 0); } }
  function fixPc(pc) { noteRemote(pc); try { nativeGetSenders.call(pc).forEach(fixSender); } catch (e) {} }
  function wrap(obj, name, fn) { var f = obj && obj[name]; if (typeof f === 'function' && !f.__bgfx) { var g = fn(f); g.__bgfx = 1; obj[name] = g; } }
  function hook(win) {
    try { if (win.__bgfxHooked) return; win.__bgfxHooked = 1; } catch (e) { return; }
    var MD = win.MediaDevices && win.MediaDevices.prototype;
    wrap(MD, 'getUserMedia', function (f) { return function () { return f.apply(this, arguments).then(wrapStream); }; });
    var md = win.navigator.mediaDevices;
    if (md && Object.prototype.hasOwnProperty.call(md, 'getUserMedia'))
      wrap(md, 'getUserMedia', function (f) { return function () { return f.apply(this, arguments).then(wrapStream); }; });
    var PC = win.RTCPeerConnection && win.RTCPeerConnection.prototype;
    if (PC) {
      ['getStats', 'setLocalDescription', 'setRemoteDescription', 'createOffer', 'createAnswer', 'addIceCandidate', 'getSenders', 'getTransceivers', 'addStream']
        .forEach(function (n) { wrap(PC, n, function (f) { return function () { note(this); return f.apply(this, arguments); }; }); });
      wrap(PC, 'addTrack', function (f) { return function (t) { note(this); var a = [].slice.call(arguments); if (isCam(t)) a[0] = proc(t, false); return f.apply(this, a); }; });
      wrap(PC, 'addTransceiver', function (f) { return function (t) { note(this); var a = [].slice.call(arguments); if (t && typeof t !== 'string' && isCam(t)) a[0] = proc(t, false); return f.apply(this, a); }; });
    }
    var SP = win.RTCRtpSender && win.RTCRtpSender.prototype;
    wrap(SP, 'replaceTrack', function (f) { return function (t) { return f.call(this, isCam(t) ? proc(t, false) : t); }; });
    wrap(SP, 'getStats', function (f) { return function () { fixSender(this); return f.apply(this, arguments); }; });
  }
  function docs() {
    var out = [D];
    try { [].forEach.call(D.querySelectorAll('iframe'), function (fr) { try { if (fr.contentDocument) { hook(fr.contentWindow); out.push(fr.contentDocument); } } catch (e) {} }); } catch (e) {}
    return out;
  }
  // Catch a camera that was already running before the bookmarklet: swap it in previews + live senders.
  function sweep() {
    pcs.forEach(function (pc) { if (pc.signalingState === 'closed') pcs.delete(pc); else fixPc(pc); });
    docs().forEach(function (d) {
      [].forEach.call(d.querySelectorAll('video'), function (el) {
        if (el.__bgfxMine) return;
        var so = el.srcObject; if (!so || !so.getVideoTracks) return;
        so.getVideoTracks().forEach(function (t) {
          if (!isCam(t)) return;
          var o = proc(t, false);
          try { so.removeTrack(t); so.addTrack(o); el.srcObject = so; el.play && el.play().catch(function () {}); } catch (e) {}
        });
      });
    });
    procs.forEach(function (p) { if (p.v.paused) p.v.play().catch(function () {}); });
  }

  /* ---------- floating control (Shadow DOM, no innerHTML so it survives strict pages) ---------- */
  var host, root, panel, btn, dot, statusEl, rows = {}, chips = {};
  function el(tag, attrs, kids) {
    var e = D.createElement(tag);
    for (var a in (attrs || {})) { if (a === 'text') e.textContent = attrs[a]; else if (a.slice(0, 2) === 'on') e.addEventListener(a.slice(2), attrs[a]); else e.setAttribute(a, attrs[a]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  var CSS = ':host{all:initial}*{box-sizing:border-box;font-family:system-ui,-apple-system,Roboto,sans-serif}' +
    '.b{position:fixed;width:48px;height:48px;border-radius:50%;border:0;background:#111c;color:#fff;font-size:22px;box-shadow:0 2px 10px #0006;touch-action:none;z-index:2147483647}' +
    '.d{position:absolute;right:4px;top:4px;width:10px;height:10px;border-radius:50%;background:#888;border:2px solid #111}' +
    '.p{position:fixed;width:min(300px,calc(100vw - 20px));background:#16191dee;color:#eee;border-radius:16px;padding:14px;box-shadow:0 8px 30px #0008;z-index:2147483647;font-size:14px;display:none}' +
    '.h{display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:15px;margin-bottom:10px}' +
    '.x{background:none;border:0;color:#aaa;font-size:22px;padding:0 4px}' +
    '.c{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}' +
    '.c button{flex:1 0 28%;min-height:40px;border-radius:10px;border:1px solid #333;background:#23272d;color:#ddd;font-size:14px}' +
    '.c button.on{background:#3b82f6;border-color:#3b82f6;color:#fff}' +
    '.r{margin-bottom:12px;display:none}.r label{display:block;color:#aaa;font-size:12px;margin-bottom:6px}' +
    'input[type=range]{width:100%;height:32px}input[type=color]{width:100%;height:40px;border:0;background:none}' +
    '.k{width:100%;min-height:40px;border-radius:10px;border:1px dashed #555;background:#1d2025;color:#ddd}' +
    '.s{color:#9aa;font-size:12px;line-height:1.4}';
  function buildUI() {
    host = el('div', { id: 'bgfx-host' });
    root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    root.appendChild(el('style', { text: CSS }));
    dot = el('span', { 'class': 'd' });
    btn = el('button', { 'class': 'b', 'aria-label': 'Background effects', text: '✨' }, [dot]);
    var pos = (function () { try { return JSON.parse(lsGet('bgfx-pos')) || null; } catch (e) { return null; } })() || { r: 10, t: 84 };
    function place() { btn.style.right = pos.r + 'px'; btn.style.top = pos.t + 'px'; panel.style.right = '10px'; panel.style.top = Math.min(pos.t + 56, innerHeight - 340) + 'px'; }
    // drag to move, tap to open
    var drag = null;
    btn.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, r: pos.r, t: pos.t, moved: false }; btn.setPointerCapture(e.pointerId); });
    btn.addEventListener('pointermove', function (e) {
      if (!drag) return; var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 8) drag.moved = true;
      if (drag.moved) { pos.r = Math.max(0, Math.min(innerWidth - 48, drag.r - dx)); pos.t = Math.max(0, Math.min(innerHeight - 48, drag.t + dy)); place(); }
    });
    btn.addEventListener('pointerup', function () { if (drag && !drag.moved) toggle(); else lsSet('bgfx-pos', JSON.stringify(pos)); drag = null; });
    var modes = [['off', 'Off'], ['blur', 'Blur'], ['image', 'Image'], ['color', 'Colour'], ['spot', 'Spot']];
    var chipRow = el('div', { 'class': 'c' }, modes.map(function (m) {
      return (chips[m[0]] = el('button', { text: m[1], onclick: function () { setMode(m[0]); } }));
    }));
    var range = el('input', { type: 'range', min: '4', max: '40', value: String(S.blur), oninput: function (e) { S.blur = +e.target.value; persist(); } });
    rows.blur = el('div', { 'class': 'r' }, [el('label', { text: 'Blur strength' }), range]);
    rows.spot = el('div', { 'class': 'r' }, [el('label', { text: 'Blur strength' }), el('input', { type: 'range', min: '4', max: '40', value: String(S.blur), oninput: function (e) { S.blur = +e.target.value; range.value = e.target.value; persist(); } })]);
    var file = el('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: function (e) { var f = e.target.files && e.target.files[0]; if (f) pickImage(f); } });
    rows.image = el('div', { 'class': 'r' }, [file, el('button', { 'class': 'k', text: 'Choose background photo…', onclick: function () { file.click(); } })]);
    rows.color = el('div', { 'class': 'r' }, [el('label', { text: 'Background colour' }), el('input', { type: 'color', value: S.color, oninput: function (e) { S.color = e.target.value; persist(); } })]);
    statusEl = el('div', { 'class': 's' });
    panel = el('div', { 'class': 'p' }, [
      el('div', { 'class': 'h' }, [el('span', { text: 'Background' }), el('button', { 'class': 'x', text: '×', 'aria-label': 'Close', onclick: toggle })]),
      chipRow, rows.blur, rows.spot, rows.image, rows.color, statusEl
    ]);
    root.appendChild(btn); root.appendChild(panel);
    (D.body || D.documentElement).appendChild(host);
    place();
    W.addEventListener('resize', place);
  }
  function toggle() { panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; ui(); }
  function setMode(m) { S.mode = m; persist(); if (m !== 'off' && m !== 'spot') loadSeg(); ui(); }
  function pickImage(f) {
    var r = new FileReader();
    r.onload = function () {
      var i = new Image();
      i.onload = function () {
        var sc = Math.min(1, 1280 / Math.max(i.width, i.height)), c = D.createElement('canvas');
        c.width = Math.round(i.width * sc); c.height = Math.round(i.height * sc);
        c.getContext('2d').drawImage(i, 0, 0, c.width, c.height);
        var url = c.toDataURL('image/jpeg', 0.85);
        lsSet(IKEY, url); setImg(url); setMode('image');
      };
      i.src = r.result;
    };
    r.readAsDataURL(f);
  }
  function ui() {
    if (!panel) return;
    for (var m in chips) chips[m].className = S.mode === m ? 'on' : '';
    for (var r in rows) rows[r].style.display = S.mode === r ? 'block' : 'none';
    var cams = procs.size, fps = 0; procs.forEach(function (p) { fps = Math.max(fps, p.fps); });
    var ai = { idle: 'not loaded', loading: 'loading…', ready: 'ready', failed: 'blocked on this page → using Spot' }[segState];
    var lines = ['AI cut-out: ' + ai, cams ? 'Camera: processing · ' + fps + ' fps' : 'Camera: waiting — turn your camera on (or off and on again)'];
    if (S.mode === 'image' && !bgImg) lines.push('No photo chosen yet — showing colour.');
    statusEl.textContent = lines.join('\n'); statusEl.style.whiteSpace = 'pre-line';
    dot.style.background = S.mode === 'off' ? '#888' : !cams ? '#f59e0b' : (segState === 'ready' || S.mode === 'spot') ? '#22c55e' : segState === 'failed' ? '#ef4444' : '#f59e0b';
  }

  /* ---------- start ---------- */
  hook(W);
  try { buildUI(); } catch (e) { console.warn('[bgfx] UI failed', e); }
  if (S.mode !== 'off' && S.mode !== 'spot') loadSeg();
  sweep();
  setInterval(function () { sweep(); ui(); }, 1500);
  ui();
  W.__bgfx = {
    open: function () { if (panel) { panel.style.display = 'block'; ui(); } },
    setMode: setMode,
    setBlur: function (b) { S.blur = b; persist(); },
    setColor: function (c) { S.color = c; persist(); },
    state: function () { var f = []; procs.forEach(function (p) { f.push(p.fps); }); return { mode: S.mode, ai: segState, cameras: procs.size, fps: f }; }
  };
  try { console.info('[bgfx] active. Mode:', S.mode); } catch (e) {}
})();
