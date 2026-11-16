/* ИЧ — исполнительный чертёж телефонной канализации по съёмке.
   Вся работа идёт в браузере: файлы никуда не отправляются. */
(function () {
'use strict';

// ---------------- справочники ----------------
const WELL_TYPES = { 'kks-2': ['ККСр-2', 1.35, 1.07], 'kks-3': ['ККС-3', 1.95, 1.16] };
const PIPE_MARK = d => 'Труба ПНД ПЭ 80 SDR 13,6 d=' + d + 'мм';
const CASING_WALL = { 325: 0.007, 273: 0.007, 820: 0.010 };
const R_WELL = 2.0, KX = 2.0, KY = 10.0;
const L = { route: 'ТК_пркл', cas: 'НС_Футляры', txt: 'Текст связь пр', prof: '260_НС_НСС_Профиль',
  net: '265_НС_НСС_Сеть на профиле', otm: 'Пр.отм.', val: 'S_NET_PROFILE_TABLE', tab: 'Текст и таблицы' };

// округление «5 вверх», как в ведомостях
const rnd = (v, n) => { const k = Math.pow(10, n === undefined ? 2 : n); return Math.sign(v || 0) * Math.floor(Math.abs(v) * k + 0.5 + 1e-7) / k; };
const fnum = (v, n) => rnd(v, n === undefined ? 2 : n).toFixed(n === undefined ? 2 : n).replace('.', ',');
const sgn = v => (v >= 0 ? '+' : '−') + Math.abs(rnd(v)).toFixed(2).replace('.', ',');
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = v => { if (v === '' || v == null) return null; const x = parseFloat(String(v).replace(',', '.')); return isFinite(x) ? x : null; };

// ---------------- чтение файлов ----------------
function decode(bytes, isDXF) {
  const ascii = new TextDecoder('latin1').decode(bytes.subarray(0, 4000));
  let enc = 'utf-8';
  if (isDXF) {
    const ver = (/\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d+)/.exec(ascii) || [])[1] || 'AC1032';
    if (ver < 'AC1021') enc = 'windows-1251';
  } else {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { enc = 'windows-1251'; }
  }
  let s = new TextDecoder(enc).decode(bytes);
  if (isDXF) s = s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  return s;
}
function readDXF(text) {
  const ln = text.split(/\r?\n/), T = [];
  for (let i = 0; i + 1 < ln.length; i += 2) T.push([parseInt(ln[i], 10), ln[i + 1]]);
  let a = T.findIndex((t, i) => t[0] === 0 && t[1] === 'SECTION' && T[i + 1] && T[i + 1][1] === 'ENTITIES');
  if (a < 0) throw new Error('в файле нет раздела ENTITIES — это точно DXF?');
  const pts = []; let cur = null, ent = null;
  const flush = () => {
    if (!ent) return;
    if (ent.type === 'INSERT') { cur = { blk: ent.g[2], x: +ent.g[10], y: +ent.g[20], att: {} }; if (cur.blk === '_block2') pts.push(cur); else cur = null; }
    else if (ent.type === 'ATTRIB' && cur) cur.att[ent.g[2]] = ent.g[1] == null ? '' : ent.g[1];
    else if (ent.type === 'SEQEND') cur = null;
  };
  for (let i = a + 2; i < T.length; i++) {
    const [c, v] = T[i];
    if (c === 0) { flush(); if (v === 'ENDSEC') break; ent = { type: v, g: {} }; }
    else if (ent && !(c in ent.g)) ent.g[c] = v;
  }
  return pts.map(p => ({ num: String(p.att['№'] || '').trim(), txt: String(p.att.TXT || '').trim(), H: num(p.att.H), x: p.x, y: p.y })).filter(p => p.H != null);
}
function readARE(text) {   // .are / .pco: 5 — номер, 4 — код, 37 — X (север), 38 — Y (восток), 39 — H
  const pts = []; let cur = null;
  text.replace(/\x1a/g, 'x').split(/\r?\n/).forEach(l => {
    const i = l.indexOf('='); if (i < 0) return;
    const k = l.slice(0, i).trim(), v = l.slice(i + 1).trim();
    if (k === '5') { cur = { num: v, txt: '', H: null, x: null, y: null }; pts.push(cur); }
    else if (cur && k === '4') cur.txt = v;
    else if (cur && k === '37') cur.y = num(v);
    else if (cur && k === '38') cur.x = num(v);
    else if (cur && k === '39') cur.H = num(v);
  });
  return pts.filter(p => p.x != null && p.y != null && p.H != null);
}
const CODE_RE = /^(\d+)(\.\.[\d,]*)?(?:_(.*))?$/;
function parsePoints(raw) {
  const out = [], skipped = [];
  raw.forEach(p => {
    const t = p.txt.replace(/[хХ]/g, 'x').replace(/\s+/g, ''), m = CODE_RE.exec(t);
    if (!m || !/^\d+$/.test(p.num)) { skipped.push(p.num + ' ' + p.txt); return; }
    out.push(Object.assign({}, p, { n: +p.num, code: m[1], link: m[2] || null, suf: (m[3] || '').toLowerCase() }));
  });
  out.sort((a, b) => a.n - b.n);
  return { pts: out, skipped };
}

// ---------------- модель трассы ----------------
function build(P0, startN, names) {
  const P = P0.map(p => Object.assign({}, p)), by = {}; P.forEach(p => by[p.n] = p);
  const warn = [];
  const wells = P.filter(p => p.code === '476').map(p => {
    const near = code => P.filter(q => q.code === code && dist(q, p) < R_WELL).sort((a, b) => dist(a, p) - dist(b, p))[0];
    const w = { c: p, top: p.H, suf: p.suf }, q47 = near('47'), q99 = near('99');
    w.plate = q47 && ('_' + q47.suf).indexOf('_vp') < 0 ? q47.H : null;
    w.bottom = q99 ? q99.H : null;
    if (WELL_TYPES[w.suf]) { [w.type, w.L, w.W] = WELL_TYPES[w.suf]; }
    else { const m = /(\d+[.,]\d+)x(\d+[.,]\d+)/.exec(w.suf); w.type = m ? 'камера' : (w.suf || '?'); w.L = m ? num(m[1]) : 1.35; w.W = m ? num(m[2]) : 1.07; }
    return w;
  });
  if (wells.length < 2) throw new Error('В съёмке меньше двух колодцев (код 476). Найдено: ' + wells.length + '.');
  const pipe = P.filter(p => p.code === '478' || p.code === '4028'), adj = new Map(pipe.map(p => [p.n, new Set()]));
  pipe.forEach((p, i) => {
    if (!p.link) return;
    let refs = p.link.slice(2).split(',').filter(Boolean).map(Number);
    if (!refs.length && i) refs = [pipe[i - 1].n];
    refs.forEach(r => { if (adj.has(r)) { adj.get(p.n).add(r); adj.get(r).add(p.n); } });
  });
  const seen = new Set(), chains = [];
  adj.forEach((nb, n) => {
    if (seen.has(n) || nb.size > 1) return;
    const ch = [n]; let prev = null, cur = n; seen.add(n);
    for (;;) { const nx = [...adj.get(cur)].filter(v => v !== prev); if (!nx.length) break; prev = cur; cur = nx[0]; ch.push(cur); seen.add(cur); }
    chains.push(ch.map(v => by[v]));
  });
  const spans = [];
  chains.forEach(ch => {
    const ends = [ch[0], ch[ch.length - 1]].map(e => { const w = wells.slice().sort((a, b) => dist(a.c, e) - dist(b.c, e))[0]; return dist(w.c, e) < R_WELL ? w : null; });
    if (!ends[0] || !ends[1] || ends[0] === ends[1]) { warn.push('Трубы т.' + ch[0].n + '…т.' + ch[ch.length - 1].n + ' не доходят до двух колодцев (ближе ' + R_WELL + ' м) — участок пропущен.'); return; }
    spans.push({ a: ends[0], b: ends[1], pts: ch });
  });
  const deg = new Map(wells.map(w => [w, spans.filter(s => s.a === w || s.b === w)]));
  const branch = wells.filter(w => deg.get(w).length > 2);
  if (branch.length) throw new Error('Трасса ветвится в колодце т.' + branch.map(w => w.c.n).join(', т.') + '. Ответвления пока не поддерживаются.');
  const lonely = wells.filter(w => !deg.get(w).length);
  lonely.forEach(w => warn.push('Колодец т.' + w.c.n + ' не соединён трубами — в ИЧ не попал.'));
  const endw = wells.filter(w => deg.get(w).length === 1);
  if (!endw.length) throw new Error('Не найдено начало трассы: проверьте связи труб (..) в кодах.');
  let cur = endw.find(w => startN && w.c.n === startN) || endw[0];
  const route = [], used = new Set();
  for (;;) {
    const s = deg.get(cur).find(q => !used.has(q)); if (!s) break; used.add(s);
    if (s.b === cur) { [s.a, s.b] = [s.b, s.a]; s.pts = s.pts.slice().reverse(); }
    route.push(s); cur = s.b;
  }
  if (route.length < spans.length) warn.push('Трасса разорвана: в ИЧ вошли только ' + route.length + ' из ' + spans.length + ' пролётов. Постройте части отдельно.');
  const order = [route[0].a].concat(route.map(s => s.b));
  order.forEach((w, i) => { w.name = names && names[i] ? names[i] : 'К-' + (i + 1); });
  let st = 0;
  route.forEach(s => {
    s.a.st = st;
    const poly = [s.a.c].concat(s.pts, [s.b.c]);
    s.pts = s.pts.map(p => Object.assign({}, p));
    for (let i = 1; i < poly.length; i++) { st += dist(poly[i - 1], poly[i]); if (i < poly.length - 1) s.pts[i - 1].st = st; }
    s.len = st - s.a.st; s.b.st = st;
    const m = s.pts.filter(p => p.code === '478' && p.suf).map(p => /(\d+)[dx](\d+)/.exec(p.suf)).find(Boolean);
    s.n = m ? +m[1] : 1; s.d = m ? +m[2] : 110;
    if (!m) warn.push('Пролёт ' + s.a.name + ' – ' + s.b.name + ': в кодах труб нет состава (_1d110) — принято 1×d110.');
    const cas = s.pts.filter(p => p.code === '4028');
    s.cas = null; s.drop = 0;
    if (cas.length >= 2) {
      const mc = /(\d+)[dx](\d+)/.exec(cas[0].suf), D = mc ? +mc[2] : 0;
      s.cas = { pts: cas, D, L: cas[cas.length - 1].st - cas[0].st };
      s.drop = s.n === 1 ? D / 1000 - (CASING_WALL[D] || 0.007) - s.d / 1000 : 0;
    }
    s.pts.forEach(p => { p.top = p.H - (s.cas && p.code === '4028' ? s.drop : 0); p.wall = false; });
    s.pts[0].wall = s.pts[s.pts.length - 1].wall = true;
  });
  return { order, route, warn, ends: endw.map(w => w.c.n) };
}

// ---------------- сверка с проектом ----------------
function compare(order, route, proj, tol) {
  const rows = [];
  const add = (el, par, pv, fv, d, used, note, kind) => rows.push({ el, par, pv, fv, d, used, note, kind });
  const nm = (el, par, pv, fv) => {
    if (pv == null || fv == null) { add(el, par, pv == null ? '—' : fnum(pv), fv == null ? '—' : fnum(fv), '', fv == null ? '—' : fnum(fv), pv == null ? 'нет в проекте' : 'нет в съёмке', 'none'); return fv; }
    fv = rnd(fv); const d = rnd(fv - pv); let used = fv, note, kind;
    if (Math.abs(d) < 0.005) { note = 'совпадает'; kind = 'ok'; }
    else if (tol != null && Math.abs(d) <= tol + 1e-9) { used = pv; note = 'принято по проекту'; kind = 'fit'; }
    else { note = 'по факту' + (tol != null ? ', больше допуска' : ''); kind = 'diff'; }
    add(el, par, fnum(pv), fnum(fv), sgn(d), fnum(used), note, kind); return used;
  };
  const tx = (el, par, pv, fv) => add(el, par, String(pv), String(fv), '', String(fv), String(pv) === String(fv) ? 'совпадает' : 'ОТЛИЧАЕТСЯ, на ИЧ по факту', String(pv) === String(fv) ? 'ok' : 'bad');
  const PW = proj.wells || [], PS = proj.spans || [];
  if (PW.length !== order.length) add('Трасса', 'Число колодцев', PW.length, order.length, '', order.length, 'ОТЛИЧАЕТСЯ — сверка по порядку, проверьте вручную', 'bad');
  order.forEach((w, i) => {
    const pw = PW[i]; if (!pw) return; const el = pw.name || w.name;
    if (pw.type) tx(el, 'Тип колодца', pw.type, w.type);
    const fin = i > 0 ? route[i - 1].pts[route[i - 1].pts.length - 1] : null, fout = i < route.length ? route[i].pts[0] : null;
    const fneck = w.plate != null ? w.top - w.plate : null;
    const top = nm(el, 'Обечайка', pw.top, w.top), bot = nm(el, 'Дно', pw.bottom, w.bottom), neck = nm(el, 'Горловина (Нг.)', pw.neck, fneck);
    if (pw.top != null && pw.bottom != null && w.bottom != null) add(el, 'Глубина (обечайка − дно)', fnum(pw.top - pw.bottom), fnum(rnd(w.top) - rnd(w.bottom)), sgn(rnd(w.top) - rnd(w.bottom) - (pw.top - pw.bottom)), fnum(top - bot), 'производная', 'info');
    if (fin) fin.top = nm(el, 'Верх трубы, вход', pw.pipe_in, fin.top);
    if (fout) fout.top = nm(el, 'Верх трубы, выход', pw.pipe_out, fout.top);
    w.top = top; w.bottom = bot; w.plate = neck != null ? top - neck : null;
  });
  const lens = [];
  route.forEach((s, i) => {
    const ps = PS[i]; if (!ps) { lens.push(s.len); return; }
    const el = s.a.name + ' – ' + s.b.name;
    if (ps.n && ps.d) tx(el, 'Трубы', ps.n + '×d' + ps.d, s.n + '×d' + s.d);
    lens.push(nm(el, 'Длина пролёта', ps.len, s.len));
    const pc = ps.casing && ps.casing.D ? ps.casing : null, fc = s.cas;
    if (pc || fc) { tx(el, 'Футляр', pc ? 'd' + pc.D : 'нет', fc ? 'd' + fc.D : 'нет'); if (pc && fc) fc.L = nm(el, 'Длина футляра', pc.L, fc.L); }
  });
  const ptot = PS.reduce((t, p) => t + (p.len || 0), 0), ftot = route.reduce((t, s) => t + rnd(s.len), 0);
  if (ptot) add('Трасса', 'Общая длина', fnum(ptot), fnum(ftot), sgn(ftot - ptot), fnum(lens.reduce((t, v) => t + v, 0)), 'производная', 'info');
  let cur = 0;
  route.forEach((s, i) => { const f = lens[i] / s.len, a0 = s.a.st; s.pts.forEach(p => { p.st = cur + (p.st - a0) * f; }); s.a.st = cur; cur += lens[i]; s.len = lens[i]; });
  route[route.length - 1].b.st = cur;
  return rows;
}

// ---------------- примитивы чертежа ----------------
function Dwg() { this.e = []; this.box = {}; }
Dwg.prototype.line = function (l, x1, y1, x2, y2, c) { this.e.push({ t: 'L', l, c, p: [[x1, y1], [x2, y2]] }); };
Dwg.prototype.poly = function (l, p, c, closed) { this.e.push({ t: 'P', l, c, p, closed: !!closed }); };
Dwg.prototype.circle = function (l, x, y, r, c) { this.e.push({ t: 'C', l, c, x, y, r }); };
Dwg.prototype.text = function (l, s, x, y, h, ang, al, c) { this.e.push({ t: 'T', l, c, s: String(s), x, y, h: h || 2.5, ang: ang || 0, al: al == null ? 1 : al }); };
Dwg.prototype.mark = function (name, from) { // запомнить рамку части чертежа для вкладок
  const xs = [], ys = [];
  this.e.slice(from).forEach(e => { if (e.p) e.p.forEach(q => { xs.push(q[0]); ys.push(q[1]); }); else { xs.push(e.x); ys.push(e.y); } });
  if (xs.length) this.box[name] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
const unit = (a, b) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };

function drawPlan(D, order, route) {
  const xy = p => [p.x, p.y], dirs = new Map();
  const add = (w, u) => { if (!dirs.has(w)) dirs.set(w, []); dirs.get(w).push(u); };
  route.forEach(s => {
    const poly = [xy(s.a.c)].concat(s.pts.map(xy), [xy(s.b.c)]);
    D.poly(L.route, poly, 7);
    add(s.a, poly.length > 3 ? unit(poly[1], poly[2]) : unit(poly[0], poly[poly.length - 1]));
    add(s.b, poly.length > 3 ? unit(poly[poly.length - 3], poly[poly.length - 2]) : unit(poly[0], poly[poly.length - 1]));
    let half = s.len / 2, acc = 0, mx = poly[0][0], my = poly[0][1], u = [1, 0];
    for (let i = 1; i < poly.length; i++) {
      const d = Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
      if (acc + d >= half) { u = unit(poly[i - 1], poly[i]); const k = half - acc; mx = poly[i - 1][0] + u[0] * k; my = poly[i - 1][1] + u[1] * k; break; }
      acc += d;
    }
    let nx = u[1], ny = -u[0];
    if ((Math.abs(u[1]) > Math.abs(u[0]) && nx < 0) || (Math.abs(u[1]) <= Math.abs(u[0]) && ny > 0)) { nx = -nx; ny = -ny; }
    const lx = mx + nx * 4, ly = my + ny * 4, up = ly >= my;
    D.line(L.txt, mx, my, lx, ly, 7); D.line(L.txt, lx - 2.2, ly, lx + 2.2, ly, 7);
    D.text(L.txt, String(s.n), lx, ly + (up ? 2.3 : -0.8), 1.0, 0, 1, 7);
    D.text(L.txt, fnum(s.len), lx, ly + (up ? 0.8 : -2.3), 1.0, 0, 1, 7);
    if (s.cas) {
      const c = s.cas.pts.map(xy), hw = 0.4, left = [], right = [];
      c.forEach((p, i) => { const q = unit(c[Math.max(i - 1, 0)], c[Math.min(i + 1, c.length - 1)]); left.push([p[0] - q[1] * hw, p[1] + q[0] * hw]); right.push([p[0] + q[1] * hw, p[1] - q[0] * hw]); });
      D.poly(L.cas, left.concat(right.reverse()), 5, true);
      const m = c[Math.floor(c.length / 2)], q = unit(c[0], c[c.length - 1]), n = q[0] > 0 ? [-q[1], q[0]] : [q[1], -q[0]];
      const fx = m[0] + n[0] * 5, fy = m[1] + n[1] * 5;
      D.line(L.txt, m[0], m[1], fx, fy, 5);
      D.text(L.txt, 'ф-р d=' + s.cas.D + ' мм, L=' + fnum(s.cas.L), fx, fy + 0.9, 1.0, 0, 1, 5);
    }
  });
  order.forEach(w => {
    const dd = dirs.get(w) || [[1, 0]]; let ux = 0, uy = 0; dd.forEach(d => { ux += d[0]; uy += d[1]; });
    const u = Math.abs(ux) + Math.abs(uy) > 1e-6 ? unit([0, 0], [ux, uy]) : dd[0];
    let n = [-u[1], u[0]]; const cx = w.c.x, cy = w.c.y, a = w.L / 2, b = w.W / 2;
    D.poly(L.route, [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [cx + u[0] * i * a + n[0] * j * b, cy + u[1] * i * a + n[1] * j * b]), 7, true);
    D.circle(L.route, cx, cy, 0.45, 7); D.circle(L.route, cx, cy, 0.35, 7);
    if (n[1] < 0) n = [-n[0], -n[1]];
    const lx = cx + n[0] * 7, ly = cy + n[1] * 7;
    D.line(L.txt, cx, cy, lx, ly, 7); D.line(L.txt, lx - 3.5, ly, lx + 3.5, ly, 7);
    D.text(L.txt, w.name, lx, ly + 2.3, 1.0, 0, 1, 7); D.text(L.txt, w.type, lx, ly + 0.8, 1.0, 0, 1, 7);
  });
}

const ROWS = [['Отметки обечаек колодцев', 15], ['Отметки верха трубопровода', 15], ['Отметки дна колодцев', 15], ['Покрытие', 10],
  ['Сечение блока кабельной|канализации', 10], ['Обозначение трубы, материал,|диаметр', 10], ['Расстояние', 10], ['План трассы', 20]];
function drawProfile(D, order, route, X0, YB) {
  const hs = order.map(w => w.top).concat(order.filter(w => w.bottom != null).map(w => w.bottom), ...route.map(s => s.pts.map(p => p.top - s.d / 1000)));
  const H0 = Math.floor(Math.min(...hs) - 1), H1 = Math.ceil(Math.max(...hs) + 1);
  const X = st => X0 + st * KX, Y = h => YB + (h - H0) * KY;
  const Ltot = order[order.length - 1].st, xl = X0 - 75, xh = X0 - 15, xr = X(Ltot) + 15;
  D.line(L.prof, xh, YB, xh, Y(H1), 7);
  for (let h = H0; h <= H1; h++) { D.line(L.prof, xh - 2, Y(h), xh, Y(h), 7); D.text(L.prof, fnum(h), xh - 3, Y(h), 2.5, 0, 2, 7); }
  D.text(L.prof, 'М 1:500 по горизонтали', xl, Y(H0) + 12, 2.5, 0, 0, 7);
  D.text(L.prof, 'М 1:100 по вертикали', xl, Y(H0) + 7, 2.5, 0, 0, 7);
  const ys = [YB]; ROWS.forEach(r => ys.push(ys[ys.length - 1] - r[1]));
  ys.forEach(y => D.line(L.prof, xl, y, xr, y, 7));
  [xl, xh, xr].forEach(x => D.line(L.prof, x, ys[0], x, ys[ys.length - 1], 7));
  ROWS.forEach(([name], i) => { const parts = name.split('|'), ym = (ys[i] + ys[i + 1]) / 2; parts.forEach((part, k) => D.text(L.prof, part, xl + 2, ym + (parts.length - 1) * 2 - k * 4, 2.5, 0, 0, 7)); });
  const mid = i => (ys[i] + ys[i + 1]) / 2;
  const cols = [];
  order.forEach((w, i) => { cols.push({ k: 'w', st: w.st, o: w }); if (i < route.length) route[i].pts.forEach(p => { if (!p.wall) cols.push({ k: 'p', st: p.st, o: p }); }); });
  cols.forEach((c, i) => {
    const x = X(c.st);
    D.line(L.otm, x, Y(c.o.top), x, YB, c.k === 'w' ? 30 : 8);
    D.line(L.prof, x, ys[0], x, ys[3], 7); D.line(L.prof, x, ys[6], x, ys[7], 7);
    if (c.k === 'p') { const tight = (c.st - cols[i - 1].st) * KX < 7 && cols[i + 1] && (cols[i + 1].st - c.st) * KX >= 7; D.text(L.val, fnum(c.o.top), tight ? x + 1.9 : x - 1.6, mid(1), 2.5, 90, 1, 7); }
  });
  for (let i = 1; i < cols.length; i++) { const a = cols[i - 1], b = cols[i], w = (b.st - a.st) * KX; D.text(L.val, fnum(b.st - a.st), (X(a.st) + X(b.st)) / 2, mid(6), 2.0, w < 8 ? 90 : 0, 1, 7); }
  order.forEach((w, i) => {
    const x = X(w.st), a = w.L / 2 * KX, bot = w.bottom != null ? w.bottom : w.top - 2, plate = w.plate != null ? w.plate : w.top - 0.4;
    D.poly(L.net, [[x - a, Y(bot)], [x + a, Y(bot)], [x + a, Y(plate)], [x - a, Y(plate)]], 7, true);
    D.poly(L.net, [[x - 0.7, Y(plate)], [x - 0.7, Y(w.top)], [x + 0.7, Y(w.top)], [x + 0.7, Y(plate)]], 7);
    D.text(L.net, w.name, x, Y(w.top) + 9, 2.5, 0, 1, 7); D.text(L.net, w.type, x, Y(w.top) + 5, 2.5, 0, 1, 7);
    D.text(L.val, fnum(w.top), x - 1.6, mid(0), 2.5, 90, 1, 7);
    if (w.bottom != null) D.text(L.val, fnum(w.bottom), x - 1.6, mid(2), 2.5, 90, 1, 7);
    if (i > 0) { const p = route[i - 1].pts; D.text(L.val, fnum(p[p.length - 1].top), x - 1.6, mid(1), 2.5, 90, 1, 7); }
    if (i < route.length) D.text(L.val, fnum(route[i].pts[0].top), x + 1.9, mid(1), 2.5, 90, 1, 7);
    if (i === 0 || i === order.length - 1) D.line(L.prof, x, ys[3], x, ys[6], 7);
    D.circle(L.prof, x, mid(7) - 3, 1.2, 7); D.text(L.prof, w.name, x, mid(7) + 4, 2.0, 0, 1, 7);
  });
  route.forEach(s => {
    const d = s.d / 1000;
    D.poly(L.otm, s.pts.map(p => [X(p.st), Y(p.top)]), 3);
    D.poly(L.otm, s.pts.map(p => [X(p.st), Y(p.top - d)]), 3);
    if (s.cas) {
      const c = s.cas, Dm = c.D / 1000, f = c.pts[0], l = c.pts[c.pts.length - 1];
      D.poly(L.cas, c.pts.map(p => [X(p.st), Y(p.H)]).concat(c.pts.slice().reverse().map(p => [X(p.st), Y(p.H - Dm)])), 5, true);
      D.text(L.cas, 'Ст. футляр D' + c.D + ', L=' + fnum(c.L) + ' м', (X(f.st) + X(l.st)) / 2, Y(Math.max(...c.pts.map(p => p.H))) + 4, 2.5, 0, 1, 5);
      D.poly(L.cas, [[X(f.st), mid(7) - 4], [X(l.st), mid(7) - 4], [X(l.st), mid(7) - 2], [X(f.st), mid(7) - 2]], 5, true);
    }
    const xa = X(s.a.st), xb = X(s.b.st);
    D.line(L.prof, xa, mid(7) - 3, xb, mid(7) - 3, 7);
    D.text(L.prof, s.n + ' / ' + fnum(s.len), (xa + xb) / 2, mid(7) - 7, 2.0, 0, 1, 7);
  });
  const groups = [];
  route.forEach(s => { const g = groups[groups.length - 1]; if (g && g.n === s.n && g.d === s.d) g.b = s.b.st; else groups.push({ n: s.n, d: s.d, a: s.a.st, b: s.b.st }); });
  groups.forEach(g => { const xm = (X(g.a) + X(g.b)) / 2; D.line(L.prof, X(g.b), ys[4], X(g.b), ys[6], 7); D.text(L.val, g.n + ' x d' + g.d, xm, mid(4), 2.5, 0, 1, 7); D.text(L.val, PIPE_MARK(g.d), xm, mid(5), 2.5, 0, 1, 7); });
  return { xl, yb: ys[ys.length - 1] };
}
function drawWells(D, order, x0, y0) {
  const heads = ['№', 'Колодец', 'Тип', 'Длина', 'Ширина', 'Обечайка', 'Низ плиты', 'Дно', 'Высота', 'Нг.', 'Глубина'];
  const wd = [8, 30, 22, 16, 16, 22, 22, 22, 18, 16, 18], rh = 8;
  D.text(L.tab, 'Ведомость колодцев (длина и ширина — по типу колодца)', x0, y0 + 5, 3.0, 0, 0, 7);
  const f = v => v != null ? fnum(v) : '—', dif = (a, b) => a != null && b != null ? fnum(a - b) : '—';
  const rows = [heads].concat(order.map((w, i) => [String(i + 1), w.name, w.type, fnum(w.L), fnum(w.W), f(w.top), f(w.plate), f(w.bottom), dif(w.plate, w.bottom), dif(w.top, w.plate), dif(w.top, w.bottom)]));
  const xs = [x0]; wd.forEach(v => xs.push(xs[xs.length - 1] + v));
  for (let r = 0; r <= rows.length; r++) D.line(L.tab, xs[0], y0 - r * rh, xs[xs.length - 1], y0 - r * rh, 7);
  xs.forEach(x => D.line(L.tab, x, y0, x, y0 - rows.length * rh, 7));
  rows.forEach((row, r) => row.forEach((v, c) => D.text(L.tab, v, (xs[c] + xs[c + 1]) / 2, y0 - r * rh - rh / 2, 2.5, 0, 1, 7)));
}

// ---------------- запись DXF (AutoCAD 2000, Windows-1251) ----------------
function cp1251(str) {
  const out = new Uint8Array(str.length * 2); let k = 0;
  for (const ch of str) { const c = ch.codePointAt(0); let b;
    if (c < 0x80) b = c; else if (c >= 0x410 && c <= 0x44F) b = c - 0x410 + 0xC0; else if (c === 0x401) b = 0xA8; else if (c === 0x451) b = 0xB8; else if (c === 0x2116) b = 0xB9;
    else if (c === 0xB0) b = 0xB0; else if (c === 0xD7) b = 0x78; else if (c === 0x2014) b = 0x97; else if (c === 0x2013) b = 0x96; else if (c === 0x2212) b = 0x2D; else if (c === 0xAB) b = 0xAB; else if (c === 0xBB) b = 0xBB; else b = 0x3F;
    out[k++] = b; }
  return out.subarray(0, k);
}
function toDXF(D) {
  const T = window.ICH_SKEL, SKEL_LAYERS = ['0', 'Defpoints', 'POINT', 'Name', 'ELEVATION', 'Deskription', 'HV', 'HI'];
  const E = [], n3 = v => (Math.round(v * 1000) / 1000).toFixed(3); let hs = T.handleStart;
  const hex = () => (hs++).toString(16).toUpperCase(), w = (c, v) => E.push(String(c).padStart(3, ' '), String(v));
  const layers = new Map(), lay = nm => { const t = String(nm).replace(/[<>\/\\":;?*|,=`]/g, '_'); if (!layers.has(t) && !SKEL_LAYERS.includes(t)) layers.set(t, 7); return t; };
  const head = (type, e) => { w(0, type); w(5, hex()); w(330, T.msOwner); w(100, 'AcDbEntity'); w(8, lay(e.l)); if (e.c != null) w(62, e.c); };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const ext = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  D.e.forEach(e => {
    if (e.t === 'L') { head('LINE', e); w(100, 'AcDbLine'); w(10, n3(e.p[0][0])); w(20, n3(e.p[0][1])); w(30, '0.0'); w(11, n3(e.p[1][0])); w(21, n3(e.p[1][1])); w(31, '0.0'); e.p.forEach(q => ext(q[0], q[1])); }
    else if (e.t === 'P') { head('LWPOLYLINE', e); w(100, 'AcDbPolyline'); w(90, e.p.length); w(70, e.closed ? 1 : 0); e.p.forEach(q => { w(10, n3(q[0])); w(20, n3(q[1])); ext(q[0], q[1]); }); }
    else if (e.t === 'C') { head('CIRCLE', e); w(100, 'AcDbCircle'); w(10, n3(e.x)); w(20, n3(e.y)); w(30, '0.0'); w(40, n3(e.r)); ext(e.x, e.y); }
    else if (e.t === 'T') { head('TEXT', e); w(100, 'AcDbText'); w(10, n3(e.x)); w(20, n3(e.y)); w(30, '0.0'); w(40, n3(e.h)); w(1, e.s); if (e.ang) w(50, n3(e.ang)); w(72, e.al); w(11, n3(e.x)); w(21, n3(e.y)); w(31, '0.0'); w(100, 'AcDbText'); w(73, 2); ext(e.x, e.y); }
  });
  const LY = [], lw = (c, v) => LY.push(String(c).padStart(3, ' '), String(v));
  layers.forEach((col, nm) => { lw(0, 'LAYER'); lw(5, hex()); lw(330, T.layerOwner); lw(100, 'AcDbSymbolTableRecord'); lw(100, 'AcDbLayerTableRecord'); lw(2, nm); lw(70, 0); lw(62, col); lw(6, 'Continuous'); lw(370, -3); lw(390, '13'); });
  if (!isFinite(x0)) x0 = y0 = x1 = y1 = 0;
  const out = T.skel.replace('{{ENTITIES}}', E.join('\n') + (E.length ? '\n' : '')).replace('{{LAYERS}}', LY.join('\n') + (LY.length ? '\n' : ''))
    .replace('{{NLAYERS}}', String(SKEL_LAYERS.length + layers.size)).replace('{{HANDSEED}}', (hs + 1).toString(16).toUpperCase())
    .replace('{{PDSIZE}}', '0.5').replace('{{LTSCALE}}', '1.0').replace('{{EXMINX}}', n3(x0)).replace('{{EXMINY}}', n3(y0)).replace('{{EXMAXX}}', n3(x1)).replace('{{EXMAXY}}', n3(y1));
  return cp1251(out.replace(/\n/g, '\r\n'));
}

// ---------------- SVG-просмотр ----------------
const COL = { 7: '#1d1e20', 5: '#1f3a93', 3: '#2c7a4b', 1: '#b3261e', 30: '#c26a00', 8: '#9aa0a6' };
function toSVG(D) {
  const o = [];
  D.e.forEach(e => {
    const c = COL[e.c] || COL[7];
    if (e.t === 'L' || e.t === 'P') { const pts = e.p.map(q => q[0].toFixed(3) + ',' + (-q[1]).toFixed(3)).join(' '); o.push('<' + (e.t === 'P' && e.closed ? 'polygon' : 'polyline') + ' points="' + pts + '" stroke="' + c + '"/>'); }
    else if (e.t === 'C') o.push('<circle cx="' + e.x.toFixed(3) + '" cy="' + (-e.y).toFixed(3) + '" r="' + e.r + '" stroke="' + c + '"/>');
    else if (e.t === 'T') o.push('<text x="' + e.x.toFixed(3) + '" y="' + (-e.y).toFixed(3) + '" font-size="' + (e.h * 1.4).toFixed(2) + '" fill="' + c + '" text-anchor="' + ['start', 'middle', 'end'][e.al] + '"' + (e.ang ? ' transform="rotate(' + (-e.ang) + ' ' + e.x.toFixed(3) + ' ' + (-e.y).toFixed(3) + ')"' : '') + '>' + esc(e.s) + '</text>');
  });
  return o.join('');
}

// ---------------- пример (условные данные) ----------------
function demo() {
  const P = [], add = (n, code, H, x, y) => P.push({ num: String(n), txt: code, H, x, y });
  let n = 1;
  const well = (x, y, top, bot, type) => { add(n++, '476_' + type, top, x, y); add(n++, '47_np', top - 0.42, x + 0.1, y + 0.12); add(n++, '99', bot, x + 0.15, y - 0.1); };
  well(1000, 500, 150.20, 148.40, 'kks-2');
  add(n++, '478_1d110', 149.35, 1000.7, 500.1); add(n++, '478.._1d110', 149.10, 1020, 503); add(n++, '478.._1d110', 148.95, 1038.9, 506.2);
  well(1039.6, 506.4, 150.05, 148.25, 'kks-2');
  add(n++, '478_1d110', 149.05, 1040.3, 506.6); add(n++, '4028.._1d325', 149.15, 1046, 508.5); add(n++, '4028.._1d325', 149.05, 1060, 513); add(n++, '4028.._1d325', 148.95, 1068, 515.8); add(n++, '478.._1d110', 148.80, 1075.6, 518.3);
  well(1076.3, 518.5, 149.90, 147.95, 'kks-3');
  add(n++, '478_1d110', 148.75, 1077, 518.3); add(n++, '478.._1d110', 148.60, 1095, 512); add(n++, '478.._1d110', 148.50, 1110.4, 507.1);
  well(1111.0, 506.9, 149.70, 147.85, 'kks-2');
  return P;
}
const DEMO_PROJECT = { object: 'Пример (условные данные)', wells: [
  { name: 'НК-1', type: 'ККСр-2', top: 150.20, bottom: 148.40, neck: 0.40, pipe_in: null, pipe_out: 149.30 },
  { name: 'НК-2', type: 'ККСр-2', top: 150.00, bottom: 148.30, neck: 0.45, pipe_in: 148.90, pipe_out: 149.05 },
  { name: 'НК-3', type: 'ККС-3', top: 149.95, bottom: 147.95, neck: 0.40, pipe_in: 148.80, pipe_out: 148.70 },
  { name: 'НК-4', type: 'ККСр-2', top: 149.75, bottom: 147.85, neck: 0.42, pipe_in: 148.55, pipe_out: null }],
  spans: [{ n: 1, d: 110, len: 39.50 }, { n: 1, d: 110, len: 39.40, casing: { D: 325, L: 23.0 } }, { n: 1, d: 110, len: 37.30 }] };

window.ICH = { decode, readDXF, readARE, parsePoints, build, compare, Dwg, drawPlan, drawProfile, drawWells, toDXF, toSVG, fnum, num, esc, demo, DEMO_PROJECT };
})();
