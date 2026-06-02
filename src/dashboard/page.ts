/**
 * The dashboard page — a single self-contained HTML document (inline CSS + a
 * vanilla-canvas force-directed graph, zero external libraries, works offline).
 * Served by `dashboard/server.ts`. The frontend talks to three JSON endpoints
 * (`/api/graph`, `/api/recall`, `/api/maintain`) on the same origin.
 *
 * It deliberately uses NO template literals so it nests cleanly inside this TS
 * template string. Don't add backticks or ${...} to the embedded script.
 */
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>engram · memory</title>
<style>
  :root {
    --bg: #07090f; --panel: rgba(18,22,33,0.82); --line: rgba(255,255,255,0.08);
    --text: #c9d4e6; --muted: #66748c; --accent: #5b8def;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text);
    font: 13px/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace; overflow: hidden; }
  #app { position: fixed; inset: 0; }
  canvas { display: block; width: 100%; height: 100%; }

  .topbar { position: absolute; top: 0; left: 0; right: 0; z-index: 5; padding: 14px 18px 10px;
    display: flex; flex-direction: column; gap: 10px;
    background: linear-gradient(180deg, rgba(7,9,15,0.92) 0%, rgba(7,9,15,0) 100%); pointer-events: none; }
  .topbar > * { pointer-events: auto; }
  .searchrow { display: flex; gap: 8px; align-items: center; }
  #q { flex: 1; background: var(--panel); border: 1px solid var(--line); color: var(--text);
    border-radius: 9px; padding: 11px 14px; font: inherit; outline: none; backdrop-filter: blur(8px); }
  #q:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(91,141,239,0.18); }
  button { background: var(--panel); border: 1px solid var(--line); color: var(--text);
    border-radius: 8px; padding: 10px 14px; font: inherit; cursor: pointer; backdrop-filter: blur(8px);
    transition: border-color .15s, background .15s, transform .05s; }
  button:hover { border-color: var(--accent); }
  button:active { transform: translateY(1px); }
  button.primary { background: linear-gradient(180deg, #4f7fe6, #3f6fd6); border-color: #6c97ee; color: #fff; font-weight: 600; }
  .metarow { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
  .stats { color: var(--muted); letter-spacing: .3px; }
  .stats b { color: var(--text); font-weight: 600; }
  .right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .legend { display: flex; gap: 12px; flex-wrap: wrap; }
  .legend span { color: var(--muted); display: inline-flex; align-items: center; gap: 5px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; box-shadow: 0 0 6px currentColor; }
  .btns { display: flex; gap: 6px; }

  #panel { position: absolute; right: 16px; bottom: 16px; width: 340px; max-width: 42vw; z-index: 6;
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px;
    backdrop-filter: blur(10px); display: none; box-shadow: 0 12px 40px rgba(0,0,0,0.5); }
  #panel h3 { margin: 0 0 6px; font-size: 12px; color: var(--accent); letter-spacing: .4px; text-transform: uppercase; }
  #panel .body { color: var(--text); font-size: 13px; max-height: 30vh; overflow: auto; }
  #panel .tags { margin-top: 10px; display: flex; gap: 6px; flex-wrap: wrap; }
  #panel .tag { font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 6px; padding: 2px 7px; }
  #panel .close { position: absolute; top: 10px; right: 12px; color: var(--muted); cursor: pointer; border: none; background: none; padding: 0; }

  .hint { position: absolute; left: 18px; bottom: 14px; color: var(--muted); z-index: 4; font-size: 11px; }
  #toast { position: absolute; left: 50%; top: 64px; transform: translateX(-50%); z-index: 8;
    background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 14px;
    backdrop-filter: blur(8px); opacity: 0; transition: opacity .2s; pointer-events: none; }
</style>
</head>
<body>
<div id="app">
  <canvas id="c"></canvas>
  <div class="topbar">
    <div class="searchrow">
      <input id="q" placeholder="recall a memory — watch the neurons fire..." autocomplete="off" />
      <button id="recall" class="primary">recall ✨</button>
      <button id="reset">reset</button>
    </div>
    <div class="metarow">
      <div class="stats" id="stats">loading…</div>
      <div class="right">
        <div class="legend" id="legend"></div>
        <div class="btns">
          <button id="dream">🌙 dream</button>
          <button id="reindex">reindex</button>
          <button id="refresh">refresh</button>
        </div>
      </div>
    </div>
  </div>
  <div id="panel"><button class="close" id="panelClose">✕</button><h3 id="panelTitle">memory</h3><div class="body" id="panelBody"></div><div class="tags" id="panelTags"></div></div>
  <div class="hint">scroll to zoom · drag to pan · click a neuron</div>
  <div id="toast"></div>
</div>
<script>
"use strict";
(function () {
  var EDGE_COLORS = {
    similar: "#5b8def", temporal_next: "#22b8cf", temporal: "#22b8cf",
    about: "#8b7bb5", lesson_from: "#84cc16", lesson: "#84cc16",
    caused: "#ef4444", supersedes: "#f59e0b"
  };
  var EDGE_LABELS = [
    ["similar", "#5b8def"], ["temporal", "#22b8cf"], ["about", "#8b7bb5"],
    ["lesson", "#84cc16"], ["caused", "#ef4444"], ["supersedes", "#f59e0b"], ["archived", "#3a4256"]
  ];

  var canvas = document.getElementById("c");
  var ctx = canvas.getContext("2d");
  var DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  var W = 0, H = 0;
  function resize() {
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resize);

  var nodes = [], edges = [], byId = {}, palette = {};
  var view = { x: 0, y: 0, k: 1 };
  var alpha = 0;
  var hover = null, selected = null;

  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.style.opacity = "1";
    clearTimeout(t._h); t._h = setTimeout(function () { t.style.opacity = "0"; }, 1800);
  }

  function nodeColor(n) {
    if (n.archived) return "rgba(120,130,150,0.35)";
    var info = n.emotion ? palette[n.emotion] : null;
    if (info) {
      var sat = 55 + Math.round((n.emotionIntensity || 0.4) * 35);
      return "hsl(" + info.hue + "," + sat + "%,62%)";
    }
    var tierHue = { episodic: 210, semantic: 150, procedural: 38, working: 220 };
    var h = (n.tier && tierHue[n.tier] != null) ? tierHue[n.tier] : 215;
    return "hsl(" + h + ",45%,60%)";
  }
  function nodeRadius(n) {
    return 2.2 + (n.importance || 0) * 3.6 + Math.min(2.4, (n.salience || 0) * 1.2) + (n.useCount ? Math.min(2, Math.log(1 + n.useCount)) : 0);
  }

  function buildGraph(data) {
    palette = data.palette || {};
    byId = {};
    nodes = data.nodes.map(function (n) {
      var o = {};
      for (var key in n) o[key] = n[key];
      o.x = (Math.random() - 0.5) * 600;
      o.y = (Math.random() - 0.5) * 600;
      o.vx = 0; o.vy = 0; o.deg = 0; o.fire = 0;
      byId[o.id] = o; return o;
    });
    edges = [];
    for (var i = 0; i < data.edges.length; i++) {
      var e = data.edges[i];
      var s = byId[e.src], t = byId[e.dst];
      if (!s || !t) continue;
      s.deg++; t.deg++;
      edges.push({ s: s, t: t, type: e.type, weight: e.weight || 0.5 });
    }
    // center the view on first load
    view = { x: W / 2, y: H / 2, k: 0.85 };
    alpha = 1;
  }

  // ---- force simulation: grid repulsion + edge springs + gravity ----
  function step() {
    if (alpha < 0.005) { alpha = 0; return; }
    var n = nodes.length;
    var REP = 1400, SPRING = 0.012, GRAV = 0.018, DAMP = 0.86;
    // spatial grid for repulsion
    var cell = 60, grid = {};
    for (var i = 0; i < n; i++) {
      var a = nodes[i];
      var gx = Math.floor(a.x / cell), gy = Math.floor(a.y / cell);
      var key = gx + "," + gy;
      (grid[key] || (grid[key] = [])).push(a);
    }
    for (var i2 = 0; i2 < n; i2++) {
      var p = nodes[i2];
      var pgx = Math.floor(p.x / cell), pgy = Math.floor(p.y / cell);
      for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) {
        var bucket = grid[(pgx + ox) + "," + (pgy + oy)];
        if (!bucket) continue;
        for (var b = 0; b < bucket.length; b++) {
          var qn = bucket[b]; if (qn === p) continue;
          var dx = p.x - qn.x, dy = p.y - qn.y;
          var d2 = dx * dx + dy * dy + 0.01;
          if (d2 > 9000) continue;
          var f = REP / d2 * alpha;
          var d = Math.sqrt(d2);
          p.vx += (dx / d) * f; p.vy += (dy / d) * f;
        }
      }
    }
    for (var e = 0; e < edges.length; e++) {
      var ed = edges[e], s = ed.s, t = ed.t;
      var dx2 = t.x - s.x, dy2 = t.y - s.y;
      var dist = Math.sqrt(dx2 * dx2 + dy2 * dy2) + 0.01;
      var target = 48;
      var f2 = (dist - target) * SPRING * (0.4 + ed.weight) * alpha;
      var fx = (dx2 / dist) * f2, fy = (dy2 / dist) * f2;
      s.vx += fx; s.vy += fy; t.vx -= fx; t.vy -= fy;
    }
    for (var g = 0; g < n; g++) {
      var nd = nodes[g];
      nd.vx -= nd.x * GRAV * alpha; nd.vy -= nd.y * GRAV * alpha;
      nd.vx *= DAMP; nd.vy *= DAMP;
      nd.x += nd.vx; nd.y += nd.vy;
    }
    alpha *= 0.985;
  }

  function tx(x) { return x * view.k + view.x; }
  function ty(y) { return y * view.k + view.y; }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // edges
    ctx.lineWidth = 0.6;
    for (var e = 0; e < edges.length; e++) {
      var ed = edges[e], s = ed.s, t = ed.t;
      var lit = s.fire > 0.02 || t.fire > 0.02;
      var col = EDGE_COLORS[ed.type] || "#3a4256";
      ctx.strokeStyle = col;
      ctx.globalAlpha = lit ? 0.55 : 0.10 + ed.weight * 0.10;
      ctx.beginPath();
      ctx.moveTo(tx(s.x), ty(s.y));
      ctx.lineTo(tx(t.x), ty(t.y));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // nodes
    for (var i = 0; i < nodes.length; i++) {
      var nd = nodes[i];
      var r = nodeRadius(nd) * Math.max(0.6, Math.sqrt(view.k));
      var x = tx(nd.x), y = ty(nd.y);
      if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
      var c = nodeColor(nd);
      if (nd.fire > 0.02) {
        ctx.globalAlpha = Math.min(1, nd.fire);
        ctx.fillStyle = "#fff7e0";
        ctx.beginPath(); ctx.arc(x, y, r + 6 + nd.fire * 8, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = 0.25 * nd.fire;
        ctx.fillStyle = "#ffd479";
        ctx.beginPath(); ctx.arc(x, y, r + 12 + nd.fire * 16, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832);
      ctx.fillStyle = c; ctx.fill();
      if (nd === hover || nd === selected) {
        ctx.lineWidth = 1.5; ctx.strokeStyle = "#fff"; ctx.stroke();
      }
      if (nd.fire > 0.02) nd.fire *= 0.97;
    }
  }

  function frame() { step(); draw(); requestAnimationFrame(frame); }

  // ---- interaction ----
  var dragging = false, lastX = 0, lastY = 0, moved = false;
  canvas.addEventListener("mousedown", function (ev) { dragging = true; moved = false; lastX = ev.clientX; lastY = ev.clientY; });
  window.addEventListener("mouseup", function () { dragging = false; });
  window.addEventListener("mousemove", function (ev) {
    if (dragging) {
      var dx = ev.clientX - lastX, dy = ev.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      view.x += dx; view.y += dy; lastX = ev.clientX; lastY = ev.clientY;
    } else {
      hover = pick(ev.clientX, ev.clientY);
      canvas.style.cursor = hover ? "pointer" : "default";
    }
  });
  canvas.addEventListener("wheel", function (ev) {
    ev.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    var f = Math.exp(-ev.deltaY * 0.0012);
    var nk = Math.max(0.12, Math.min(6, view.k * f));
    view.x = mx - (mx - view.x) * (nk / view.k);
    view.y = my - (my - view.y) * (nk / view.k);
    view.k = nk;
  }, { passive: false });
  canvas.addEventListener("click", function (ev) {
    if (moved) return;
    var n = pick(ev.clientX, ev.clientY);
    if (n) showPanel(n); else hidePanel();
  });
  function pick(cx, cy) {
    var rect = canvas.getBoundingClientRect();
    var x = cx - rect.left, y = cy - rect.top, best = null, bd = 14;
    for (var i = 0; i < nodes.length; i++) {
      var nd = nodes[i];
      var dx = tx(nd.x) - x, dy = ty(nd.y) - y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bd) { bd = d; best = nd; }
    }
    return best;
  }

  function showPanel(n) {
    selected = n;
    document.getElementById("panel").style.display = "block";
    document.getElementById("panelTitle").textContent = (n.tier || "memory") + (n.archived ? " · archived" : "");
    document.getElementById("panelBody").textContent = n.label || "(no preview)";
    var tags = [];
    if (n.emotion) tags.push(n.emotion + (n.emotionIntensity ? " " + Math.round(n.emotionIntensity * 100) + "%" : ""));
    if (n.topic) tags.push(n.topic);
    tags.push("importance " + (n.importance || 0).toFixed(2));
    if (n.useCount) tags.push(n.useCount + "× recalled");
    var box = document.getElementById("panelTags"); box.innerHTML = "";
    for (var i = 0; i < tags.length; i++) {
      var s = document.createElement("span"); s.className = "tag"; s.textContent = tags[i]; box.appendChild(s);
    }
  }
  function hidePanel() { selected = null; document.getElementById("panel").style.display = "none"; }
  document.getElementById("panelClose").addEventListener("click", hidePanel);

  // ---- data + api ----
  function setStats(s, archived) {
    document.getElementById("stats").innerHTML =
      "<b>" + s.count + "</b> neurons · <b>" + s.edges + "</b> synapses · <b>" +
      s.entities + "</b> entities · <b>" + archived + "</b> archived";
  }
  function buildLegend() {
    var el = document.getElementById("legend"); el.innerHTML = "";
    for (var i = 0; i < EDGE_LABELS.length; i++) {
      var span = document.createElement("span");
      span.innerHTML = "<i class='dot' style='color:" + EDGE_LABELS[i][1] + ";background:" + EDGE_LABELS[i][1] + "'></i>" + EDGE_LABELS[i][0];
      el.appendChild(span);
    }
  }
  function load() {
    fetch("api/graph").then(function (r) { return r.json(); }).then(function (data) {
      buildGraph(data);
      var archived = 0; for (var i = 0; i < nodes.length; i++) if (nodes[i].archived) archived++;
      setStats(data.stats, archived);
    }).catch(function () { toast("failed to load graph"); });
  }

  function clearFire() { for (var i = 0; i < nodes.length; i++) nodes[i].fire = 0; }
  function doRecall() {
    var q = document.getElementById("q").value.trim();
    if (!q) return;
    clearFire();
    fetch("api/recall?q=" + encodeURIComponent(q) + "&k=8").then(function (r) { return r.json(); }).then(function (res) {
      var hit = 0;
      (res.results || []).forEach(function (m, idx) { var nd = byId[m.id]; if (nd) { nd.fire = 1; hit++; } });
      (res.trace && res.trace.activations || []).forEach(function (a) {
        var nd = byId[a.id]; if (nd && nd.fire < 0.6) nd.fire = Math.min(0.85, 0.3 + a.activation * 4);
      });
      (res.trace && res.trace.seeds || []).forEach(function (s) { var nd = byId[s.id]; if (nd && !nd.fire) nd.fire = 0.5; });
      alpha = Math.max(alpha, 0.15);
      toast(hit ? ("fired " + hit + " neuron" + (hit === 1 ? "" : "s")) : "no memory matched");
    }).catch(function () { toast("recall failed"); });
  }
  function maintain(kind) {
    toast(kind + "…");
    fetch("api/maintain?op=" + kind, { method: "POST" }).then(function (r) { return r.json(); }).then(function (res) {
      toast(res.message || (kind + " done")); load();
    }).catch(function () { toast(kind + " failed"); });
  }

  document.getElementById("recall").addEventListener("click", doRecall);
  document.getElementById("q").addEventListener("keydown", function (e) { if (e.key === "Enter") doRecall(); });
  document.getElementById("reset").addEventListener("click", function () {
    document.getElementById("q").value = ""; clearFire(); hidePanel();
    view = { x: W / 2, y: H / 2, k: 0.85 }; alpha = Math.max(alpha, 0.3);
  });
  document.getElementById("dream").addEventListener("click", function () { maintain("dream"); });
  document.getElementById("reindex").addEventListener("click", function () { maintain("reindex"); });
  document.getElementById("refresh").addEventListener("click", load);

  resize(); buildLegend(); load(); frame();
})();
</script>
</body>
</html>`;
