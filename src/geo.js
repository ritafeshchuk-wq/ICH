/* ИЧ — геоподоснова (DXF МГГТ) на чертеже и спецификация проекта.
   Геоподоснова читается целиком: слои, блоки (в т.ч. привязанные внешние ссылки A$C…), тексты.
   На ИЧ переносится окно вокруг сети — на исходных слоях и цветах. */
(function () {
'use strict';
const I = window.ICH, num = I.num;

// ---------------- чтение DXF целиком ----------------
const KEEP = new Set([0, 1, 2, 3, 7, 8, 10, 11, 20, 21, 40, 41, 42, 43, 44, 45, 50, 51, 62, 66, 67, 70, 71, 72, 73, 90, 210, 220, 230]);
function readGeo(text) {
  const ln = text.split(/\r?\n/), n = ln.length;
  const layers = new Map(), blocks = new Map(), model = [];
  let sec = null, tab = null, blk = null, ent = null, inHead = false;
  const close = () => {
    if (!ent) return;
    if (sec === 'TABLES' && ent.t === 'LAYER') {
      const g = ent.g, nm = gv(g, 2), c = +gv(g, 62, 7), fl = +gv(g, 70, 0);
      if (nm != null) layers.set(nm, { c: Math.abs(c) || 7, off: c < 0 || (fl & 1) === 1 });
    } else if (sec === 'BLOCKS' && blk && !inHead) blk.e.push(ent);
    else if (sec === 'ENTITIES') model.push(ent);
    ent = null;
  };
  for (let i = 0; i + 1 < n; i += 2) {
    const c = parseInt(ln[i], 10), v = ln[i + 1];
    if (c === 0) {
      close();
      const t = v.trim();
      if (t === 'SECTION') { sec = (ln[i + 3] || '').trim(); i += 2; continue; }
      if (t === 'ENDSEC') { sec = null; continue; }
      if (sec === 'TABLES') { if (t === 'TABLE' || t === 'ENDTAB') continue; ent = { t, g: [] }; continue; }
      if (sec === 'BLOCKS') {
        if (t === 'BLOCK') { blk = { name: null, bx: 0, by: 0, e: [] }; inHead = true; continue; }
        if (t === 'ENDBLK') { if (blk && blk.name != null) blocks.set(blk.name, blk); blk = null; inHead = false; continue; }
        inHead = false; ent = { t, g: [] }; continue;
      }
      if (sec === 'ENTITIES') { ent = { t, g: [] }; continue; }
      continue;
    }
    if (sec === 'BLOCKS' && inHead && blk) { if (c === 2 && blk.name == null) blk.name = v.trim(); else if (c === 10) blk.bx = +v; else if (c === 20) blk.by = +v; continue; }
    if (ent && KEEP.has(c)) ent.g.push(c, v);
  }
  close();
  return { layers, blocks, model, count: model.length };
}
function gv(g, code, def) { for (let i = 0; i < g.length; i += 2) if (g[i] === code) return g[i + 1]; return def; }
const gn = (g, code, def) => { const v = gv(g, code); return v == null ? def : +v; };

// ---------------- разворот в простые примитивы ----------------
const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
const ap = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
const ID = [1, 0, 0, 1, 0, 0], MIR = [-1, 0, 0, 1, 0, 0];
const ocs = g => gn(g, 230, 1) < 0 ? MIR : ID;   // выдавливание (0,0,−1): ось X зеркальна
function arcPts(cx, cy, r, a0, a1) {
  while (a1 <= a0) a1 += 360;
  const k = Math.max(4, Math.ceil((a1 - a0) / 8)), out = [];
  for (let i = 0; i <= k; i++) { const a = (a0 + (a1 - a0) * i / k) * Math.PI / 180; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}
function bulgePts(p, q, b) {
  if (!b) return [];
  const th = 4 * Math.atan(b), dx = q[0] - p[0], dy = q[1] - p[1], c = Math.hypot(dx, dy); if (c < 1e-9) return [];
  const r = c / (2 * Math.sin(th / 2)), mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, h = r * Math.cos(th / 2);
  const cx = mx - dy / c * h, cy = my + dx / c * h, a0 = Math.atan2(p[1] - cy, p[0] - cx), k = Math.max(2, Math.ceil(Math.abs(th) / (Math.PI / 18))), out = [];
  for (let i = 1; i < k; i++) { const a = a0 + th * i / k; out.push([cx + Math.abs(r) * Math.cos(a), cy + Math.abs(r) * Math.sin(a)]); }
  return out;
}
const cleanText = s => String(s).replace(/%%[uUoO]/g, '').replace(/%%[cC]/g, '%%c');
function mtextPlain(s) {
  return String(s).replace(/\\[Pp]/g, '\n').replace(/\\[~]/g, ' ').replace(/\\[ACcFfHhQqTtWwp][^;]*;/g, '').replace(/\\[LlOoKk]/g, '')
    .replace(/\\S([^;]*?)[\^#\/]([^;]*);/g, '$1/$2').replace(/[{}]/g, '').replace(/\\\\/g, '\\');
}
// обход: cb(prim) для каждого примитива в мировых координатах; win — [x0,y0,x1,y1] для отсечения
function explode(G, win, cb, opt) {
  opt = opt || {};
  const inWin = pts => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; pts.forEach(p => { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); }); return !win || (c >= win[0] && a <= win[2] && d >= win[1] && b <= win[3]); };
  const layerOf = (l, pl) => (l === '0' && pl) ? pl : l;
  const colorOf = (g, lay, pc) => { const c = gn(g, 62, 256); if (c === 0) return pc || 7; if (c === 256) { const L = G.layers.get(lay); return L ? L.c : 7; } return Math.abs(c); };
  const hidden = lay => { const L = G.layers.get(lay); return L && L.off; };
  function walk(list, M, pl, pc, depth) {
    let lastIns = null;
    for (const e of list) {
      const g = e.g, t = e.t;
      if (gv(g, 67) === '1') continue;                         // лист (paper space)
      const lay = layerOf(String(gv(g, 8, '0')).trim(), pl);
      if (t === 'ATTRIB' && lastIns) { if (!hidden(lay) && !(gn(g, 70, 0) & 1)) text(g, lastIns.M0, lay, colorOf(g, lay, pc), false); continue; }
      if (t === 'SEQEND') {
        const p = walk._pl; walk._pl = null; lastIns = null;
        if (p && p.pts.length > 1 && inWin(p.pts)) cb({ t: 'P', l: p.lay, c: p.col, p: p.pts, closed: p.closed });
        continue;
      }
      if (t === 'VERTEX') { if (walk._pl) walk._pl.pts.push(ap(walk._pl.M, gn(g, 10, 0), gn(g, 20, 0))); continue; }
      if (hidden(lay)) continue;
      const col = colorOf(g, lay, pc), O = mul(M, ocs(g));
      if (t === 'LINE') { const p = [ap(M, gn(g, 10, 0), gn(g, 20, 0)), ap(M, gn(g, 11, 0), gn(g, 21, 0))]; if (inWin(p)) cb({ t: 'L', l: lay, c: col, p }); }
      else if (t === 'LWPOLYLINE') {
        const xs = [], ys = [], bs = []; let cur = -1;
        for (let i = 0; i < g.length; i += 2) { if (g[i] === 10) { xs.push(+g[i + 1]); bs.push(0); cur = xs.length - 1; } else if (g[i] === 20) ys.push(+g[i + 1]); else if (g[i] === 42 && cur >= 0) bs[cur] = +g[i + 1]; }
        const closed = (gn(g, 70, 0) & 1) === 1, raw = xs.map((x, i) => [x, ys[i]]), pts = [];
        raw.forEach((p, i) => { pts.push(p); const q = raw[i + 1] || (closed ? raw[0] : null); if (q && bs[i]) bulgePts(p, q, bs[i]).forEach(z => pts.push(z)); });
        const w = pts.map(p => ap(O, p[0], p[1])); if (w.length > 1 && inWin(w)) cb({ t: 'P', l: lay, c: col, p: w, closed });
      }
      else if (t === 'CIRCLE' || t === 'ARC') {
        const cx = gn(g, 10, 0), cy = gn(g, 20, 0), r = gn(g, 40, 0);
        const sc = Math.sqrt(Math.abs(O[0] * O[3] - O[1] * O[2])), uni = Math.abs(Math.hypot(O[0], O[1]) - Math.hypot(O[2], O[3])) < 1e-6 * sc;
        if (t === 'CIRCLE' && uni) { const c = ap(O, cx, cy); if (inWin([[c[0] - r * sc, c[1] - r * sc], [c[0] + r * sc, c[1] + r * sc]])) cb({ t: 'C', l: lay, c: col, x: c[0], y: c[1], r: r * sc }); }
        else { const w = (t === 'CIRCLE' ? arcPts(cx, cy, r, 0, 360) : arcPts(cx, cy, r, gn(g, 50, 0), gn(g, 51, 360))).map(p => ap(O, p[0], p[1])); if (inWin(w)) cb({ t: 'P', l: lay, c: col, p: w, closed: t === 'CIRCLE' }); }
      }
      else if (t === 'ELLIPSE') {
        const cx = gn(g, 10, 0), cy = gn(g, 20, 0), mx = gn(g, 11, 0), my = gn(g, 21, 0), ra = gn(g, 40, 1), a0 = gn(g, 41, 0), a1 = gn(g, 42, 2 * Math.PI);
        const L = Math.hypot(mx, my), ux = mx / L, uy = my / L, k = 36, w = [];
        let b = a1; while (b <= a0) b += 2 * Math.PI;
        for (let i = 0; i <= k; i++) { const a = a0 + (b - a0) * i / k, x = L * Math.cos(a), y = L * ra * Math.sin(a); w.push(ap(O, cx + x * ux - y * uy, cy + x * uy + y * ux)); }
        if (inWin(w)) cb({ t: 'P', l: lay, c: col, p: w, closed: false });
      }
      else if (t === 'SPLINE' || t === 'LEADER') {
        const xs = [], ys = []; for (let i = 0; i < g.length; i += 2) { if (g[i] === 10) xs.push(+g[i + 1]); else if (g[i] === 20) ys.push(+g[i + 1]); }
        const w = xs.map((x, i) => ap(M, x, ys[i])); if (w.length > 1 && inWin(w)) cb({ t: 'P', l: lay, c: col, p: w, closed: false });
      }
      else if (t === 'POLYLINE') walk._pl = { lay, col, closed: (gn(g, 70, 0) & 1) === 1, pts: [], M: O };
      else if (t === 'TEXT' || t === 'MTEXT') text(g, M, lay, col, t === 'MTEXT');
      else if ((t === 'INSERT' || t === 'DIMENSION') && depth < 12) {
        const b = G.blocks.get(String(gv(g, 2, '')).trim()); if (!b) { if (t === 'INSERT') lastIns = { M0: M }; continue; }
        let T;
        if (t === 'DIMENSION') T = M;
        else {
          const sx = gn(g, 41, 1), sy = gn(g, 42, 1), a = gn(g, 50, 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
          const L = [ca * sx, sa * sx, -sa * sy, ca * sy, gn(g, 10, 0), gn(g, 20, 0)];
          T = mul(O, mul(L, [1, 0, 0, 1, -b.bx, -b.by]));
        }
        const nc = Math.max(1, gn(g, 70, 1)), nr = Math.max(1, gn(g, 71, 1)), dc = gn(g, 44, 0), dr = gn(g, 45, 0);
        for (let r = 0; r < Math.min(nr, 50); r++) for (let c = 0; c < Math.min(nc, 50); c++) walk(b.e, (r || c) ? mul(T, [1, 0, 0, 1, c * dc, r * dr]) : T, lay, col, depth + 1);
        lastIns = gn(g, 66, 0) ? { M0: M } : null;
      }
    }
  }
  function text(g, M, lay, col, mt) {
    let s = mt ? mtextPlain(g.filter((v, i) => i % 2 === 1 && (g[i - 1] === 3 || g[i - 1] === 1)).join('')) : cleanText(gv(g, 1, ''));
    s = s.trim(); if (!s) return;
    const O = mul(M, ocs(g)), sc = Math.sqrt(Math.abs(O[0] * O[3] - O[1] * O[2])) || 1, h = gn(g, 40, 2.5) * sc;
    let ang = gn(g, 50, 0), al = 0, v = 0, x = gn(g, 10, 0), y = gn(g, 20, 0);
    if (mt) {
      if (gv(g, 11) != null && gv(g, 50) == null) ang = Math.atan2(gn(g, 21, 0), gn(g, 11, 1)) * 180 / Math.PI;
      const at = gn(g, 71, 1); al = (at - 1) % 3; v = at <= 3 ? 3 : at <= 6 ? 2 : 1;
    } else {
      const h72 = gn(g, 72, 0), v73 = gn(g, 73, 0);
      if (!(h72 === 0 && v73 === 0) && h72 !== 3 && h72 !== 5) { x = gn(g, 11, x); y = gn(g, 21, y); al = h72 === 4 ? 1 : Math.min(h72, 2); v = h72 === 4 ? 2 : v73; }
    }
    const p = ap(O, x, y), rot = Math.atan2(O[1], O[0]) * 180 / Math.PI, a = (O[0] * O[3] - O[1] * O[2] < 0 ? 180 - ang : ang) + rot;
    if (win && !(p[0] >= win[0] - 5 && p[0] <= win[2] + 5 && p[1] >= win[1] - 5 && p[1] <= win[3] + 5)) return;
    const lines = s.split('\n'), dy = h * 1.6, ar = a * Math.PI / 180;
    lines.forEach((tx, i) => { const k = mt ? i * dy : 0; cb({ t: 'T', l: lay, c: col, s: tx, x: p[0] + Math.sin(ar) * k, y: p[1] - Math.cos(ar) * k, h, ang: a, al, v: mt && i ? (v === 3 ? 3 : v) : v }); });
  }
  walk(G.model, ID, null, null, 0);
}
// наложить окно геоподосновы на чертёж: примитивы на исходных слоях, цвета — как в геоподоснове
function addGeo(D, G, win) {
  let n = 0;
  D.lc = D.lc || {};
  explode(G, win, e => {
    e.geo = true; D.e.push(e); n++;
    if (!(e.l in D.lc)) { const L = G.layers.get(e.l); D.lc[e.l] = L ? L.c : 7; }
  });
  return n;
}
// все тексты файла строками таблицы (для спецификации из DXF проекта): тексты одной строки — по высоте, слева направо
function textRows(G) {
  const T = []; explode(G, null, e => { if (e.t === 'T' && Math.abs(((e.ang % 180) + 180) % 180) < 1) T.push(e); });
  T.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  T.forEach(t => { const r = rows.find(q => Math.abs(q.y - t.y) < Math.max(q.h, t.h) * 0.6 && Math.abs(q.x - t.x) < 400); if (r) r.t.push(t); else rows.push({ y: t.y, h: t.h, x: t.x, t: [t] }); });
  return rows.map(r => r.t.sort((a, b) => a.x - b.x).map(t => t.s).join('\t'));
}

// ---------------- спецификация проекта ----------------
// строки «наименование | марка | ... | кол.»: трубы (ПНД / ПЭ, диаметр, SDR, ГОСТ) и кабели (марка, жилы × сечение)
const CABLE_RE = /((?:А|В|П)[А-Яа-яЁё()]{2,12})\s*(\d{1,2})\s*[xх×X]\s*(\d{1,3}(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?/;
function parseSpec(text) {
  const pipes = [], cables = [], seen = new Set();
  String(text || '').split(/\r?\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).forEach(line => {
    const low = line.toLowerCase();
    if (/(^|[\s\t\d.])труба(?![а-яё])|трубы\s+(пнд|пэ)/.test(low) && !/(заглушк|муфт|уплотнит|для\s+труб)/.test(low) && /(пнд|пэ|пвх|полиэтил)/.test(low)) {
      const d = /(?:[⌀Øø∅]|%%c|d|диам\w*\.?)\s*=?\s*(\d{2,4})/i.exec(line) || /(\d{2,4})\s*(?:x|х)\s*\d+[.,]?\d*\s*мм/i.exec(line) || /(\d{2,4})\s*мм/.exec(line);
      const sdr = /SDR\s*([\d.,]+)/i.exec(line), gost = /(ГОСТ\s*(?:Р\s*)?(?:МЭК\s*)?[\d.\-–]+(?:-\d{2,4})?)/i.exec(line), mat = /(ПЭ\s*\d{2,3}|ПНД|ПВХ)/i.exec(line);
      if (d) { const k = 'p' + d[1] + (sdr ? sdr[1] : '') + (gost ? gost[1] : ''); if (!seen.has(k)) { seen.add(k); pipes.push({ d: +d[1], sdr: sdr ? sdr[1].replace(/[.,]$/, '') : '', gost: gost ? gost[1].replace(/[.,]$/, '') : '', mat: mat ? mat[1].toUpperCase().replace(/\s+/, ' ') : '', src: line }); } }
      return;
    }
    const m = CABLE_RE.exec(line);
    if (m && (/кабел/.test(low) || /Ш|Б|Г/.test(m[1]))) {
      const k = 'c' + m[1].toLowerCase() + m[2] + 'x' + m[3]; if (seen.has(k)) return; seen.add(k);
      cables.push({ mark: m[1], cores: +m[2], sec: num(m[3]), volt: m[4] || '', src: line });
    }
  });
  return { pipes, cables };
}
const bestPipe = (spec, d) => spec.pipes.filter(x => x.d === d).sort((a, b) => (!!b.sdr + !!b.gost) - (!!a.sdr + !!a.gost))[0];
// сверка ИЧ со спецификацией: материал/SDR/ГОСТ труб и марки кабелей
const normMark = s => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[()\s]/g, '');
function checkSpec(spec, g, cables) {
  const rows = [], d = +g.d || 110, p = bestPipe(spec, d);
  const row = (el, pv, fv, ok, note) => rows.push({ el, pv, fv, ok, note });
  if (!spec.pipes.length && !spec.cables.length) return rows;
  if (p) {
    row('Труба d' + d + ': материал', p.mat || '—', g.mat || '—', !p.mat || normMark(g.mat).includes(normMark(p.mat).replace(/\d+/, '')) && (!/\d/.test(p.mat) || normMark(g.mat) === normMark(p.mat)), p.src);
    if (p.sdr) row('Труба d' + d + ': SDR', p.sdr, g.sdr || '—', num(p.sdr) === num(g.sdr), p.src);
    if (p.gost) row('Труба d' + d + ': ГОСТ', p.gost, g.gost || '—', normMark(p.gost) === normMark(g.gost), p.src);
  } else row('Труба d' + d, 'нет в спецификации', 'd' + d, false, spec.pipes.map(x => 'd' + x.d).join(', '));
  (cables || []).forEach(c => {
    const m = CABLE_RE.exec(c.s); if (!m) return;
    const same = spec.cables.filter(x => x.cores === +m[2] && x.sec === num(m[3]));
    if (!same.length) { row('Кабель ' + m[2] + 'x' + m[3], 'нет в спецификации', m[1], null, 'чужой кабель или другой проект'); return; }
    const hit = same.find(x => normMark(x.mark) === normMark(m[1]));
    row('Кабель ' + m[2] + 'x' + m[3] + ': марка', same.map(x => x.mark).join(' / '), m[1], !!hit, (hit || same[0]).src);
  });
  return rows;
}
// заполнить ИЧ данными спецификации: материал, SDR, ГОСТ труб и марки кабелей того же сечения
function applySpec(spec, g) {
  const d = +g.d || 110, p = bestPipe(spec, d), ch = [];
  if (p) {
    if (p.mat && p.mat !== g.mat) { g.mat = p.mat; ch.push('материал ' + p.mat); }
    if (p.sdr && p.sdr !== g.sdr) { g.sdr = p.sdr; ch.push('SDR ' + p.sdr); }
    if (p.gost && p.gost !== g.gost) { g.gost = p.gost; ch.push(p.gost); }
  }
  g.cables = String(g.cables || '').split(/\r?\n/).map(s => {
    const m = CABLE_RE.exec(s); if (!m) return s;
    const same = spec.cables.filter(x => x.cores === +m[2] && x.sec === num(m[3]));
    if (same.length === 1 && normMark(same[0].mark) !== normMark(m[1])) { ch.push(m[1] + ' → ' + same[0].mark); return s.replace(m[1], same[0].mark); }
    return s;
  }).join('\n');
  return ch;
}

Object.assign(I, { readGeo, explode, addGeo, textRows, parseSpec, checkSpec, applySpec });
})();
