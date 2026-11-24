/* Castle Hill Hub — charts for the Ask tab.
   Renders the answer Claude returns: { answer, charts: [ {kind: bar|column|line|stat|table, ...} ] }.
   Plain SVG/HTML, no library. All labels are inserted as text (never as HTML). */
(function () {
  const css = `
  .viz{--viz-surface:light-dark(#fcfcfb,#1a1a19);--viz-ink:light-dark(#0b0b0b,#f0efec);--viz-ink2:light-dark(#52514e,#c3c2b7);
    --viz-muted:#898781;--viz-grid:light-dark(#e1e0d9,#2c2c2a);--viz-base:light-dark(#c3c2b7,#383835);--viz-dim:light-dark(#d6d5ce,#3a3a37);
    --s1:light-dark(#2a78d6,#3987e5);--s2:light-dark(#eb6834,#d95926);--s3:light-dark(#1baf7a,#199e70);
    background:var(--viz-surface);border:1px solid var(--line);border-radius:14px;padding:14px 16px 12px;margin-top:12px;color:var(--viz-ink);position:relative}
  .viz h4{margin:0;font-size:16px}.viz .vsub{margin:2px 0 8px;color:var(--viz-ink2);font-size:13px}
  .viz svg{display:block;width:100%;overflow:visible}.viz svg text{fill:var(--viz-muted);font:12px system-ui,-apple-system,"Segoe UI",sans-serif}
  .viz svg text.v{fill:var(--viz-ink2);font-weight:600}.viz svg .mk{cursor:default}.viz svg .mk:hover,.viz svg .mk:focus{opacity:.8;outline:none}
  .viz .leg{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:13px;color:var(--viz-ink2);margin:2px 0 6px}
  .viz .leg i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}
  .viz .leg i.ln{height:2px;width:14px;border-radius:1px;vertical-align:3px}
  .viz .hb{display:grid;grid-template-columns:minmax(90px,38%) 1fr;gap:6px 10px;align-items:center;font-size:14px}
  .viz .hb .nm{color:var(--viz-ink2);overflow-wrap:anywhere}.viz .hb .tr{position:relative;height:20px}
  .viz .hb .br{position:absolute;top:0;height:20px;cursor:default}.viz .hb .br:focus{outline:2px solid var(--viz-ink2);outline-offset:2px}
  .viz .hb .vl{position:absolute;top:1px;font-weight:600;color:var(--viz-ink2);white-space:nowrap;font-size:13px}
  .viz .tip{position:absolute;pointer-events:none;background:var(--viz-surface);border:1px solid var(--viz-grid);box-shadow:0 4px 14px rgba(0,0,0,.15);
    border-radius:8px;padding:7px 10px;font-size:13px;display:none;z-index:3;min-width:120px}
  .viz .tip b{display:block;font-size:15px;color:var(--viz-ink)}.viz .tip .tl{color:var(--viz-ink2)}
  .viz .tip .row{display:flex;gap:8px;align-items:center;justify-content:space-between}.viz .tip .row span{color:var(--viz-ink2)}
  .viz .tip .row i{display:inline-block;width:12px;height:2px;margin-right:6px;vertical-align:3px}
  .viz .tgl{background:none;border:0;color:var(--blue);font:inherit;font-size:13px;cursor:pointer;padding:8px 0 0;min-height:32px}
  .viz table{border-collapse:collapse;width:100%;font-size:13px;margin-top:6px}
  .viz th,.viz td{text-align:right;padding:6px 8px;border-bottom:1px solid var(--viz-grid);font-variant-numeric:tabular-nums;white-space:nowrap}
  .viz th:first-child,.viz td:first-child{text-align:left;white-space:normal}.viz th{color:var(--viz-ink2);font-weight:600}
  .viz .twrap{overflow-x:auto}
  .viz .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
  .viz .tile{border:1px solid var(--viz-grid);border-radius:10px;padding:10px 12px}.viz .tile .lb{color:var(--viz-ink2);font-size:13px}
  .viz .tile .vv{font-size:26px;font-weight:600;line-height:1.2}.viz .tile .nt{color:var(--viz-muted);font-size:12px}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  const SER = ["var(--s1)", "var(--s2)", "var(--s3)"];
  const SVGNS = "http://www.w3.org/2000/svg";
  function h(tag, attrs, text) { const e = document.createElement(tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; }
  function s(tag, attrs, text) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; }
  const num = v => (typeof v === "number" && isFinite(v)) ? v : (v === null || v === undefined || v === "" ? null : (isFinite(+v) ? +v : null));

  function fmt(v, unit, compact) {
    if (v == null) return "—";
    const a = Math.abs(v), sign = v < 0 ? "−" : "";
    if (unit === "percent") return sign + (a >= 10 ? a.toFixed(0) : a.toFixed(1)).replace(/\.0$/, "") + "%";
    const pre = unit === "usd" ? "$" : "";
    if (compact) {
      if (a >= 1e6) return sign + pre + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M";
      if (a >= 1e4) return sign + pre + (a / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "K";
    }
    const d = unit === "usd" ? 0 : (a % 1 ? (a < 10 ? 2 : 1) : 0);
    return sign + pre + a.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  }
  function niceTicks(min, max, n) {
    if (min === max) { max = min + 1; }
    const span = max - min, step0 = span / Math.max(1, n), mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(x => x >= step0) || 10 * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, t = [];
    for (let x = lo; x <= hi + step / 2; x += step) t.push(+x.toFixed(10));
    return t;
  }

  /* tooltip shared per card */
  function tooltip(card) {
    const tip = h("div", { class: "tip", role: "status" }); card.appendChild(tip);
    return {
      show(x, y, build) { tip.replaceChildren(); build(tip); tip.style.display = "block";
        const W = card.clientWidth, tw = tip.offsetWidth; tip.style.left = Math.max(4, Math.min(W - tw - 4, x + 12)) + "px"; tip.style.top = Math.max(4, y - tip.offsetHeight - 10) + "px"; },
      hide() { tip.style.display = "none"; }
    };
  }
  const localXY = (card, ev) => { const r = card.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };

  function legend(card, series, kind) {
    if (series.length < 2) return;
    const lg = h("div", { class: "leg" });
    series.forEach((sr, i) => { const it = h("span"); it.appendChild(h("i", { class: kind === "line" ? "ln" : "", style: "background:" + SER[i] })); it.appendChild(document.createTextNode(sr.name)); lg.appendChild(it); });
    card.appendChild(lg);
  }
  function tableView(card, c) {
    const btn = h("button", { class: "tgl", type: "button", "aria-expanded": "false" }, "Show Table");
    const wrap = h("div", { class: "twrap", hidden: "" });
    const t = h("table"), hr = h("tr");
    hr.appendChild(h("th", {}, ""));
    c.series.forEach(sr => hr.appendChild(h("th", {}, sr.name)));
    const th = h("thead"); th.appendChild(hr); t.appendChild(th);
    const tb = h("tbody");
    c.labels.forEach((lb, i) => { const tr = h("tr"); tr.appendChild(h("td", {}, lb)); c.series.forEach(sr => tr.appendChild(h("td", {}, fmt(sr.values[i], c.unit)))); tb.appendChild(tr); });
    t.appendChild(tb); wrap.appendChild(t);
    btn.onclick = () => { const open = wrap.hasAttribute("hidden"); if (open) wrap.removeAttribute("hidden"); else wrap.setAttribute("hidden", ""); btn.textContent = open ? "Hide Table" : "Show Table"; btn.setAttribute("aria-expanded", String(open)); };
    card.appendChild(btn); card.appendChild(wrap);
  }

  /* ---------- horizontal ranked bars (one series) ---------- */
  function barChart(card, c) {
    const sr = c.series[0], vals = sr.values.map(num);
    const min = Math.min(0, ...vals.filter(v => v != null)), max = Math.max(0, ...vals.filter(v => v != null));
    const span = (max - min) || 1, zero = (0 - min) / span * 100;
    const grid = h("div", { class: "hb" }); card.appendChild(grid);
    const tip = tooltip(card);
    // leave room on the right for the value label
    const room = 26;
    c.labels.forEach((lb, i) => {
      const v = vals[i];
      grid.appendChild(h("div", { class: "nm" }, lb));
      const tr = h("div", { class: "tr" });
      if (v != null) {
        const w = Math.abs(v) / span * (100 - room), left = v >= 0 ? zero * (100 - room) / 100 : (zero * (100 - room) / 100) - w;
        const dim = c.highlight != null && c.highlight !== i;
        const br = h("div", { class: "br", tabindex: "0", "aria-label": `${lb}: ${fmt(v, c.unit)}`,
          style: `left:${left}%;width:max(2px,${w}%);background:${dim ? "var(--viz-dim)" : SER[0]};border-radius:${v >= 0 ? "0 4px 4px 0" : "4px 0 0 4px"}` });
        const show = ev => { const [x, y] = ev.type === "focus" ? [br.offsetLeft + br.offsetWidth, tr.offsetTop + grid.offsetTop] : localXY(card, ev); tip.show(x, y, t => { t.appendChild(h("b", {}, fmt(v, c.unit))); t.appendChild(h("span", { class: "tl" }, lb)); }); };
        br.addEventListener("pointermove", show); br.addEventListener("focus", show);
        br.addEventListener("pointerleave", tip.hide); br.addEventListener("blur", tip.hide);
        tr.appendChild(br);
        const vl = h("div", { class: "vl", style: v >= 0 ? `left:calc(${left + w}% + 6px)` : `right:calc(${100 - left}% + 6px)` }, fmt(v, c.unit, true));
        tr.appendChild(vl);
      }
      grid.appendChild(tr);
    });
  }

  /* ---------- columns and lines over categories (≤3 series) ---------- */
  function xyChart(card, c, kind) {
    const W = Math.max(280, card.clientWidth - 32), H = Math.round(Math.min(300, Math.max(200, W * 0.42)));
    const series = c.series.map(sr => ({ name: sr.name, values: sr.values.map(num) }));
    const all = series.flatMap(sr => sr.values).filter(v => v != null);
    if (!all.length) return;
    let lo = Math.min(...all), hi = Math.max(...all);
    if (kind === "column") { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    else { const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.1 || 1; lo = (lo >= 0 && lo - pad < 0) ? 0 : lo - pad; hi = hi + pad; }
    const ticks = niceTicks(lo, hi, 4); lo = ticks[0]; hi = ticks[ticks.length - 1];
    const tickLabels = ticks.map(t => fmt(t, c.unit, true));
    const ml = Math.max(...tickLabels.map(t => t.length)) * 7 + 10, mr = kind === "line" ? 56 : 8, mt = 18, mb = 28;
    const pw = W - ml - mr, ph = H - mt - mb, n = c.labels.length;
    const y = v => mt + ph - (v - lo) / (hi - lo) * ph;
    const band = pw / n, x = i => ml + band * (i + 0.5);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": c.title || "Chart" });
    ticks.forEach((t, k) => {
      svg.appendChild(s("line", { x1: ml, x2: W - mr, y1: y(t), y2: y(t), stroke: t === 0 ? "var(--viz-base)" : "var(--viz-grid)", "stroke-width": 1 }));
      svg.appendChild(s("text", { x: ml - 8, y: y(t) + 4, "text-anchor": "end" }, tickLabels[k]));
    });
    const every = Math.ceil(n / Math.max(1, Math.floor(pw / 56)));
    c.labels.forEach((lb, i) => { if (i % every === 0 || i === n - 1) svg.appendChild(s("text", { x: x(i), y: H - 8, "text-anchor": "middle" }, lb)); });
    card.appendChild(svg);
    const tip = tooltip(card);
    const readout = (i, t) => {
      t.appendChild(h("span", { class: "tl" }, c.labels[i]));
      series.forEach((sr, k) => { const r = h("div", { class: "row" }); const nm = h("span"); if (series.length > 1) nm.appendChild(h("i", { style: "background:" + SER[k] })); nm.appendChild(document.createTextNode(series.length > 1 ? sr.name : "")); r.appendChild(nm); r.appendChild(h("b", {}, fmt(sr.values[i], c.unit))); t.appendChild(r); });
    };
    if (kind === "column") {
      const gap = 2, bw = Math.min(24, (band * 0.7 - gap * (series.length - 1)) / series.length), gw = bw * series.length + gap * (series.length - 1);
      const zeroY = y(0);
      let best = null;
      series.forEach((sr, k) => sr.values.forEach((v, i) => { if (v == null) return;
        const bx = x(i) - gw / 2 + k * (bw + gap), top = Math.min(y(v), zeroY), hgt = Math.max(1, Math.abs(y(v) - zeroY)), r = Math.min(4, bw / 2, hgt);
        const up = v >= 0;
        const d = up ? `M${bx},${zeroY} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + bw - r} Q${bx + bw},${top} ${bx + bw},${top + r} V${zeroY} Z`
                     : `M${bx},${zeroY} V${top + hgt - r} Q${bx},${top + hgt} ${bx + r},${top + hgt} H${bx + bw - r} Q${bx + bw},${top + hgt} ${bx + bw},${top + hgt - r} V${zeroY} Z`;
        const dim = c.highlight != null && c.highlight !== i && series.length === 1;
        const p = s("path", { d, fill: dim ? "var(--viz-dim)" : SER[k], class: "mk", tabindex: "0", "aria-label": `${c.labels[i]}${series.length > 1 ? ", " + sr.name : ""}: ${fmt(v, c.unit)}` });
        const hit = s("rect", { x: x(i) - band / 2, y: mt, width: band, height: ph, fill: "transparent" });
        const show = ev => { const [px, py] = ev.type === "focus" ? [bx, top] : localXY(card, ev); tip.show(px, py, t => readout(i, t)); };
        [p, hit].forEach(el => { el.addEventListener("pointermove", show); el.addEventListener("pointerleave", tip.hide); });
        p.addEventListener("focus", show); p.addEventListener("blur", tip.hide);
        svg.insertBefore(hit, svg.firstChild.nextSibling); svg.appendChild(p);
        if (series.length === 1 && (best == null || Math.abs(v) > Math.abs(best.v))) best = { v, x: bx + bw / 2, y: up ? top - 6 : top + hgt + 14 };
      }));
      const hl = c.highlight != null && series.length === 1 && series[0].values[c.highlight] != null
        ? { v: series[0].values[c.highlight], i: c.highlight } : null;
      const lab = hl ? { v: hl.v, x: x(hl.i), y: hl.v >= 0 ? y(hl.v) - 6 : y(hl.v) + 14 } : best;
      if (lab) svg.appendChild(s("text", { x: lab.x, y: lab.y, "text-anchor": "middle", class: "v" }, fmt(lab.v, c.unit, true)));
    } else {
      const cross = s("line", { y1: mt, y2: mt + ph, stroke: "var(--viz-base)", "stroke-width": 1, visibility: "hidden" });
      svg.appendChild(cross);
      series.forEach((sr, k) => {
        let d = "", pen = false;
        sr.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + x(i) + "," + y(v); pen = true; });
        svg.appendChild(s("path", { d, fill: "none", stroke: SER[k], "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
        let li = -1; sr.values.forEach((v, i) => { if (v != null) li = i; });
        if (li >= 0) {
          svg.appendChild(s("circle", { cx: x(li), cy: y(sr.values[li]), r: 4, fill: SER[k], stroke: "var(--viz-surface)", "stroke-width": 2 }));
          if (series.length <= 3) svg.appendChild(s("text", { x: x(li) + 8, y: y(sr.values[li]) + 4 + (k - (series.length - 1) / 2) * 0, class: "v" }, fmt(sr.values[li], c.unit, true)));
        }
      });
      const hit = s("rect", { x: ml, y: mt, width: pw, height: ph, fill: "transparent", tabindex: "0", "aria-label": (c.title || "Chart") + ". Use left and right arrows to read values." });
      let cur = n - 1;
      const at = (i, px, py) => { cur = i; cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible"); tip.show(px, py, t => readout(i, t)); };
      hit.addEventListener("pointermove", ev => { const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) * (W / r.width); const i = Math.max(0, Math.min(n - 1, Math.round((sx - ml) / band - 0.5))); const [px, py] = localXY(card, ev); at(i, px, py); });
      hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); tip.hide(); });
      hit.addEventListener("focus", () => at(cur, (x(cur) / W) * card.clientWidth, 40));
      hit.addEventListener("blur", () => { cross.setAttribute("visibility", "hidden"); tip.hide(); });
      hit.addEventListener("keydown", e => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); const i = Math.max(0, Math.min(n - 1, cur + (e.key === "ArrowRight" ? 1 : -1))); at(i, (x(i) / W) * card.clientWidth, 40); } });
      svg.appendChild(hit);
    }
  }

  function statTiles(card, c) {
    const g = h("div", { class: "tiles" });
    (c.items || []).slice(0, 4).forEach(it => {
      const t = h("div", { class: "tile" });
      t.appendChild(h("div", { class: "lb" }, it.label || ""));
      const v = num(it.value); t.appendChild(h("div", { class: "vv" }, v == null ? String(it.value ?? "—") : fmt(v, it.unit || c.unit, Math.abs(v) >= 1e5)));
      if (it.note) t.appendChild(h("div", { class: "nt" }, it.note));
      g.appendChild(t);
    });
    card.appendChild(g);
  }
  function plainTable(card, c) {
    const wrap = h("div", { class: "twrap" }), t = h("table"), hr = h("tr");
    (c.columns || []).forEach(col => hr.appendChild(h("th", {}, col)));
    const th = h("thead"); th.appendChild(hr); t.appendChild(th);
    const tb = h("tbody");
    (c.rows || []).slice(0, 60).forEach(row => { const tr = h("tr"); (row || []).forEach(cell => tr.appendChild(h("td", {}, cell == null ? "" : String(cell)))); tb.appendChild(tr); });
    t.appendChild(tb); wrap.appendChild(t); card.appendChild(wrap);
  }

  function valid(c) {
    if (!c || typeof c !== "object") return false;
    if (c.kind === "stat") return Array.isArray(c.items) && c.items.length > 0;
    if (c.kind === "table") return Array.isArray(c.columns) && Array.isArray(c.rows);
    if (!["bar", "column", "line"].includes(c.kind)) return false;
    if (!Array.isArray(c.labels) || !Array.isArray(c.series) || !c.series.length) return false;
    c.labels = c.labels.slice(0, 36).map(String);
    c.series = c.series.slice(0, c.kind === "bar" ? 1 : 3).map(sr => ({ name: String(sr.name || ""), values: (sr.values || []).slice(0, c.labels.length) }));
    if (c.highlight != null && !(Number.isInteger(c.highlight) && c.highlight >= 0 && c.highlight < c.labels.length)) c.highlight = null;
    return true;
  }

  function renderChart(host, c) {
    const card = h("figure", { class: "viz" }); card.style.margin = "12px 0 0"; host.appendChild(card);
    if (c.title) card.appendChild(h("h4", {}, c.title));
    if (c.subtitle) card.appendChild(h("p", { class: "vsub" }, c.subtitle));
    const draw = () => {
      [...card.children].forEach(ch => { if (!/^H4$/.test(ch.tagName) && !ch.classList.contains("vsub")) ch.remove(); });
      if (c.kind === "stat") return statTiles(card, c);
      if (c.kind === "table") return plainTable(card, c);
      legend(card, c.series, c.kind);
      if (c.kind === "bar") barChart(card, c); else xyChart(card, c, c.kind);
      tableView(card, c);
    };
    draw();
    if (c.kind === "column" || c.kind === "line") {
      let w = card.clientWidth, t;
      new ResizeObserver(() => { if (Math.abs(card.clientWidth - w) < 8) return; w = card.clientWidth; clearTimeout(t); t = setTimeout(draw, 120); }).observe(card);
    }
  }

  window.hubRenderAnswer = function (host, res) {
    host.replaceChildren();
    const box = h("div", { class: "answer" }, res && res.answer ? res.answer : "No answer came back.");
    host.appendChild(box);
    (res && Array.isArray(res.charts) ? res.charts : []).slice(0, 3).forEach(c => { if (valid(c)) renderChart(host, c); });
  };
})();
