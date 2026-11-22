/* ИЧ — кабель НО / ЭС: план и лист.
   Оформление своё, собрано из лучшего в образцах:
   — пикеты подряд вдоль трассы, длина каждого отрезка, Lтр, разрез траншеи, спецификация, штамп (лист КГС, корпус 12);
   — состав труб, футляры контуром, ведомость участков и итоги по составу (ИЧ МГГТ);
   — своё: длина пишется вдоль отрезка и уходит на выноску, только когда не помещается; подписи не наезжают
     друг на друга и на трассу; условные обозначения и итоги собираются сами — только то, что есть на объекте. */
(function () {
'use strict';
const I = window.ICH, fnum = I.fnum, unit = I.unit;
const f2 = v => I.rnd(v, 2).toFixed(2);            // 2.73 — с точкой, как на листах НО
const K = 0.5;                                     // М 1:500: 1 мм листа = 0,5 м
const FORMATS = [['A2', 594, 420], ['A1', 841, 594], ['A0', 1189, 841]];
const RC = 185, BB = 124;                          // правая колонка и нижняя полоса листа, мм
const TW = (s, h) => 0.7 * h * String(s).length;   // ширина строки с запасом

// ---------- пикеты: подряд вдоль трассы, ветка за веткой ----------
function numberPickets(m, reverse) {
  const adj = new Map(m.points.map(p => [p, []]));
  m.edges.forEach(e => { adj.get(e.a).push(e.b); adj.get(e.b).push(e.a); });
  const ord = (a, b) => reverse ? b.n - a.n : a.n - b.n, seen = new Set(), out = [];
  const starts = m.points.slice().sort((a, b) => (adj.get(a).length === 1 ? 0 : 1) - (adj.get(b).length === 1 ? 0 : 1) || ord(a, b));
  starts.forEach(s => {
    if (seen.has(s)) return;
    const st = [s];
    while (st.length) { const v = st.pop(); if (seen.has(v)) continue; seen.add(v); out.push(v); adj.get(v).filter(w => !seen.has(w)).sort(ord).reverse().forEach(w => st.push(w)); }
  });
  out.forEach((p, i) => { p.pk = i + 1; });
  m.pickets = out; if (m.relabel) m.relabel();   // в ведомости точки — тоже по пикетам
  return out;
}

// ---------- расстановка подписей без наложений ----------
function Placer() { this.b = []; }
Placer.prototype.hit = function (r) { for (let i = 0; i < this.b.length; i++) { const q = this.b[i]; if (r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) return true; } return false; };
Placer.prototype.add = function (r) { this.b.push(r); };
const tbox = (s, x, y, h, al) => { const w = TW(s, h), x0 = al === 1 ? x - w / 2 : al === 2 ? x - w : x; return [x0 - 0.05, y - 0.6 * h, x0 + w + 0.05, y + 0.6 * h]; };
// подпись вдоль линии: цепочка маленьких квадратов по оси текста — чтобы наклонная надпись не «занимала» весь прямоугольник
const along = (cx, cy, w, h, angDeg) => { const a = angDeg * Math.PI / 180, n = Math.max(1, Math.ceil(w / (0.4 * h))), r = 0.44 * h, out = []; for (let i = 0; i <= n; i++) { const t = -w / 2 + w * i / n, x = cx + Math.cos(a) * t, y = cy + Math.sin(a) * t; out.push([x - r, y - r, x + r, y + r]); } return out; };
const rbox = (cx, cy, w, h, angDeg) => { const a = angDeg * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)), W = (w * c + h * s) / 2, H = (w * s + h * c) / 2; return [cx - W, cy - H, cx + W, cy + H]; };

const LAY = { cab: 'НО_Кабель', cas: 'НО_Футляры', pole: 'НО_Опоры', pname: 'НО_Номера опор', pk: 'НО_Пикеты', len: 'НО_Длины', comp: 'НО_Состав труб', otm: 'НО_Отметки',
  sheet: 'Лист_Рамка и штамп', txt: 'Лист_Текст', sec: 'Лист_Разрез траншеи', hint: 'Defpoints' };
const SES_COL = [1, 30, 3, 5, 6, 8];

function drawNO(D, m, opt) {
  opt = opt || {};
  const PL = new Placer(), nk = Math.max(1, Math.round(+opt.ncab || 1));
  // трасса и точки — препятствия для подписей
  m.edges.forEach(e => { const n = Math.max(1, Math.ceil(e.len / 0.7)); for (let i = 0; i <= n; i++) { const x = e.a.x + (e.b.x - e.a.x) * i / n, y = e.a.y + (e.b.y - e.a.y) * i / n; PL.add([x - 0.12, y - 0.12, x + 0.12, y + 0.12]); } });
  m.poles.forEach(p => PL.add([p.x - 0.55, p.y - 0.55, p.x + 0.55, p.y + 0.55]));
  // кабель: участками; футляр — синим и контуром
  m.runs.forEach(r => {
    const c = r.pts.map(p => [p.x, p.y]), col = opt.bySurvey ? SES_COL[(r.pts[r.pts.length - 1].ses || 0) % SES_COL.length] : 1;
    D.poly(LAY.cab, c, r.cas ? 5 : col);
    if (r.cas) { const hw = 0.25, left = [], right = [];
      c.forEach((p, i) => { const q = unit(c[Math.max(i - 1, 0)], c[Math.min(i + 1, c.length - 1)]); left.push([p[0] - q[1] * hw, p[1] + q[0] * hw]); right.push([p[0] + q[1] * hw, p[1] - q[0] * hw]); });
      D.poly(LAY.cas, left.concat(right.reverse()), 5, true); }
  });
  // опоры: значок и номер из проекта
  m.poles.forEach(p => { D.circle(LAY.pole, p.x, p.y, 0.45, 7); D.circle(LAY.pole, p.x, p.y, 0.22, 7); D.circle(LAY.pole, p.x, p.y, 0.05, 1); });
  m.poles.forEach(p => {
    const h = 0.8, cand = [[135, 2], [45, 0], [225, 2], [315, 0], [90, 1], [270, 1], [180, 2], [0, 0]]; let best = null;
    for (const r of [1.15, 1.9, 2.8]) { for (const [a, al] of cand) { const x = p.x + r * Math.cos(a * Math.PI / 180), y = p.y + r * Math.sin(a * Math.PI / 180), b = tbox(p.name, x, y, h, al); if (!PL.hit(b)) { best = [x, y, al, b, r]; break; } } if (best) break; }
    if (!best) { const x = p.x - 1.15 * 0.7, y = p.y + 1.15 * 0.7; best = [x, y, 2, tbox(p.name, x, y, h, 2), 1.15]; }
    PL.add(best[3]); D.text(LAY.pname, p.name, best[0], best[1], h, 0, best[2], 7);
    if (best[4] > 1.2) D.line(LAY.pname, p.x, p.y, best[0], best[1] - 0.45, 7);
  });
  // пикеты: кружок-точка и номер рядом; в тесноте — на короткой выноске
  const pts = m.pickets || m.points;
  if (opt.nums !== false) pts.forEach(p => {
    const s = String(p.pk || p.n), h = 0.4, isPole = p.code === m.net.pole; if (!isPole) D.circle(LAY.pk, p.x, p.y, 0.08, 6);
    let best = null;
    for (const r of [isPole ? 0.85 : 0.5, 1.2, 1.9, 2.7]) { for (const a of [45, 135, 315, 225, 90, 270, 0, 180]) { const dx = Math.cos(a * Math.PI / 180), dy = Math.sin(a * Math.PI / 180), al = dx > 0.3 ? 0 : dx < -0.3 ? 2 : 1, x = p.x + r * dx, y = p.y + r * dy, b = tbox(s, x, y, h, al); if (!PL.hit(b)) { best = [x, y, al, b, r]; break; } } if (best) break; }
    if (!best) return;
    PL.add(best[3]); D.text(LAY.pk, s, best[0], best[1], h, 0, best[2], 6);
    if (best[4] > 1.0) D.line(LAY.pk, p.x, p.y, best[2] === 0 ? best[3][0] : best[2] === 2 ? best[3][2] : best[0], best[1] - (best[1] > p.y ? 0.28 : -0.28), 6);
  });
  // длины отрезков: вдоль линии, если помещается; иначе — на полке с выноской
  if (opt.dims !== false) m.edges.slice().sort((a, b) => b.len - a.len).forEach(e => {
    if (e.len < 0.05) return;
    const a = [e.a.x, e.a.y], b = [e.b.x, e.b.y], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, u = unit(a, b), nrm = [-u[1], u[0]];
    let ang = Math.atan2(u[1], u[0]) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang <= -90) ang += 180;
    const short = f2(e.len), full = nk + 'к.L=' + short, s = opt.dimStyle === 'full' || nk > 1 ? full : short, h = 0.5, w = TW(s, h);
    if (e.len >= w + 0.3) for (const sd of [1, -1]) { const x = mx + nrm[0] * 0.55 * sd, y = my + nrm[1] * 0.55 * sd, bs = along(x, y, w, h, ang); if (!bs.some(q => PL.hit(q))) { bs.forEach(q => PL.add(q)); D.text(LAY.len, s, x, y, h, ang, 1, 5); return; } }
    let best = null;
    for (const r of [1.5, 2.3, 3.2, 4.3, 5.5, 7, 9, 11.5]) { for (const sd of [1, -1]) for (const t of [0, 1.4, -1.4]) { const x = mx + nrm[0] * r * sd + u[0] * t, y = my + nrm[1] * r * sd + u[1] * t, al = x >= mx ? 0 : 2, bx = tbox(s, x, y, h, al); if (!PL.hit(bx)) { best = [x, y, al, bx]; break; } if (best) break; } if (best) break; }
    if (!best) { const x = mx + nrm[0] * 1.5, y = my + nrm[1] * 1.5; best = [x, y, 0, tbox(s, x, y, h, 0)]; }
    PL.add(best[3]); D.text(LAY.len, s, best[0], best[1], h, 0, best[2], 5);
    const yl = best[1] - 0.6 * h; D.line(LAY.len, best[3][0], yl, best[3][2], yl, 5); D.line(LAY.len, mx, my, best[2] === 0 ? best[3][0] : best[3][2], yl, 5);
  });
  // состав труб — на самом длинном отрезке участка
  m.runs.forEach(r => {
    if (!r.comp) return;
    const c = r.pts.map(p => [p.x, p.y]); let bi = 1, bl = -1;
    for (let i = 1; i < c.length; i++) { const l = Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]); if (l > bl) { bl = l; bi = i; } }
    const s = r.comp.n + 'ПНД d' + r.comp.d + (r.cas ? ' (футляр)' : ''), h = 0.6, w = TW(s, h); if (bl < w + 0.4) return;
    const a = c[bi - 1], b = c[bi], u = unit(a, b), nrm = [-u[1], u[0]]; let ang = Math.atan2(u[1], u[0]) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang <= -90) ang += 180;
    for (const sd of [-1, 1]) for (const d of [0.65, 1.4]) { const x = (a[0] + b[0]) / 2 + nrm[0] * d * sd, y = (a[1] + b[1]) / 2 + nrm[1] * d * sd, bs = along(x, y, w, h, ang); if (!bs.some(q => PL.hit(q))) { bs.forEach(q => PL.add(q)); D.text(LAY.comp, s, x, y, h, ang, 1, r.cas ? 5 : 7); return; } }
  });
  if (opt.marks) pts.forEach(p => { if (p.code === m.net.pole) return; const s = fnum(p.H), b = tbox(s, p.x + 0.3, p.y - 0.5, 0.35, 0); if (!PL.hit(b)) { PL.add(b); D.text(LAY.otm, s, p.x + 0.3, p.y - 0.5, 0.35, 0, 0, 3); } });
}

// ---------- лист: формат по размеру трассы, окно плана ----------
function sheetNO(m, opt) {
  const xs = m.points.map(p => p.x), ys = m.points.map(p => p.y), bx = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const bw = bx[2] - bx[0] + 16, bh = bx[3] - bx[1] + 16;
  let F = FORMATS.find(f => f[0] === (opt && opt.fmt)) || FORMATS.find(f => (f[1] - RC - 33) * K >= bw && (f[2] - BB - 13) * K >= bh) || FORMATS[FORMATS.length - 1];
  const W = F[1], H = F[2], wx0 = 28, wx1 = W - RC - 5, wy0 = BB, wy1 = H - 13;
  const cx = (bx[0] + bx[2]) / 2, cy = (bx[1] + bx[3]) / 2, X0 = cx - (wx0 + wx1) / 2 * K, Y0 = cy - (wy0 + wy1) / 2 * K;
  const fits = (wx1 - wx0) * K >= bw - 8 && (wy1 - wy0) * K >= bh - 8;
  return { fmt: F[0], W, H, X0, Y0, fits, win: [X0 + wx0 * K, Y0 + wy0 * K, X0 + wx1 * K, Y0 + wy1 * K], wmm: [wx0, wy0, wx1, wy1] };
}
const wrap = (s, n) => { const out = []; String(s || '').split(/\n/).forEach(par => { let cur = ''; par.split(/\s+/).forEach(wd => { if (cur && (cur + ' ' + wd).length > n) { out.push(cur); cur = wd; } else cur = cur ? cur + ' ' + wd : wd; }); out.push(cur); }); return out; };

function drawSheetNO(D, m, o, S) {
  o = o || {};
  const X = v => S.X0 + v * K, Y = v => S.Y0 + v * K, W = S.W, H = S.H, L = LAY.sheet, T = LAY.txt;
  const ln = (x1, y1, x2, y2, c, l) => D.line(l || L, X(x1), Y(y1), X(x2), Y(y2), c == null ? 7 : c);
  const rect = (x1, y1, x2, y2, c, l) => D.poly(l || L, [[X(x1), Y(y1)], [X(x2), Y(y1)], [X(x2), Y(y2)], [X(x1), Y(y2)]], c == null ? 7 : c, true);
  const tx = (s, x, y, h, al, c, l) => { if (s != null && String(s) !== '') D.text(l || T, String(s), X(x), Y(y), h * K, 0, al == null ? 1 : al, c == null ? 7 : c); };
  const nk = Math.max(1, Math.round(+o.ncab || 1)), Ltr = m.edges.reduce((t, e) => t + e.len, 0);
  // рамка, окно плана
  rect(0, 0, W, H, 8); rect(20, 5, W - 5, H - 5);
  const w = S.wmm; rect(w[0], w[1], w[2], w[3]);
  tx('План М1:500', (w[0] + w[2]) / 2, H - 9, 5);
  if (!S.fits) tx('Трасса не помещается в окно плана на ' + S.fmt + ' в М1:500 — нужен формат больше или разбивка на листы.', (w[0] + w[2]) / 2, w[3] - 6, 3, 1, 1, LAY.hint);
  // ситуационный план — место под карту
  const rx0 = W - RC, rx1 = W - 9, sy1 = H - 13, sy0 = sy1 - 150;
  tx('Ситуационный план М1:2000', (rx0 + rx1) / 2, H - 9, 5); rect(rx0, sy0, rx1, sy1);
  tx('Место под карту: вставьте изображение ситуационного плана', (rx0 + rx1) / 2, (sy0 + sy1) / 2, 3, 1, 8, LAY.hint);
  // ---- правая колонка: спецификация, итоги, условные обозначения ----
  let y = sy0 - 8;
  const rows = String(o.spec || '').split(/\n/).map(r => r.split(/\s*;\s*/)).filter(r => r.some(Boolean));
  const spec = rows.length ? rows : [[m.poles.length ? m.poles[0].name + ' – ' + m.poles[m.poles.length - 1].name : '', '', '', String(m.poles.length)]];
  const cw = [44, 78, 36, 18], cx = [rx0]; cw.forEach(v => cx.push(cx[cx.length - 1] + v));
  const rh = 7, dh = 12, top = y; tx('Спецификация оборудования', (rx0 + rx1) / 2, y - rh / 2, 3.5); y -= rh; ln(rx0, y, rx1, y);
  ['№ опор', 'Тип опоры, светильника', 'Тип цоколя', 'Кол.'].forEach((s, i) => tx(s, (cx[i] + cx[i + 1]) / 2, y - rh / 2, 2.5)); y -= rh; ln(rx0, y, rx1, y);
  spec.forEach(r => { r.forEach((s, i) => { if (i > 3) return; const ls = wrap(s, i === 1 ? 34 : i === 0 ? 18 : 15).slice(0, 3); ls.forEach((t, j) => tx(t, (cx[i] + cx[i + 1]) / 2, y - dh / 2 + (ls.length - 1) * 1.8 - j * 3.6, 2.5)); }); y -= dh; ln(rx0, y, rx1, y); });
  rect(rx0, y, rx1, top); cx.slice(1, -1).forEach(x => ln(x, top - rh, x, y));
  // итоги — считаются по съёмке
  y -= 9; tx('Итоги по съёмке', rx0, y, 3.5, 0); y -= 6.5;
  const tot = [['Длина траншеи Lтр', f2(Ltr) + ' м'], ['Кабель в траншее', nk + ' шт.' + (o.cable ? ', ' + o.cable : '') + ' — ' + f2(Ltr * nk) + ' м по плану'], ['Опор', String(m.poles.length) + ' шт.']];
  Object.keys(m.tot).sort().forEach(k => { if (!/не указан/.test(k)) tot.push([k.replace(/^труба /, 'Труба ').replace(/^футляр /, 'Футляр '), f2(m.tot[k]) + ' м']); });
  const cas = m.edges.filter(e => e.cas).reduce((t, e) => t + e.len, 0); if (cas > 0 && !Object.keys(m.tot).some(k => /^футляр \d/.test(k))) tot.push(['В футлярах', f2(cas) + ' м']);
  tot.forEach(r => { tx(r[0], rx0 + 2, y, 2.5, 0); tx(r[1], rx1, y, 2.5, 2); ln(rx0, y - 2.3, rx1, y - 2.3, 8); y -= 5.2; });
  // условные обозначения — только то, что есть на плане
  y -= 6; tx('Условные обозначения', rx0, y, 3.5, 0); y -= 7;
  const lx = rx0 + 2, item = (draw, s) => { draw(y); tx(s, lx + 20, y, 2.5, 0); y -= 6; };
  item(yy => ln(lx, yy, lx + 16, yy, 1, LAY.cab), '— кабель' + (o.pipe ? ' в трубе (' + o.pipe.replace(/^Труба\s*/i, '') + ')' : ''));
  if (m.edges.some(e => e.cas)) item(yy => rect(lx, yy - 1, lx + 16, yy + 1, 5, LAY.cas), '— кабель в футляре');
  if (m.poles.length) item(yy => { D.circle(LAY.pole, X(lx + 8), Y(yy), 0.9 * K * 2, 7); D.circle(LAY.pole, X(lx + 8), Y(yy), 0.45 * K * 2, 7); tx(m.poles[0].name, lx + 11, yy + 0.3, 1.6, 0); }, '— опора и её номер по проекту');
  item(yy => { D.circle(LAY.pk, X(lx + 6), Y(yy), 0.16, 6); tx('12', lx + 8, yy + 0.8, 1.2, 0, 6, LAY.pk); }, '— пикет (точка съёмки), номер по каталогу координат');
  item(yy => { ln(lx, yy - 1, lx + 16, yy - 1, 1, LAY.cab); tx(nk > 1 || o.dimStyle === 'full' ? nk + 'к.L=2.73' : '2.73', lx + 8, yy + 0.8, 1.4, 1, 5, LAY.len); }, '— длина отрезка между пикетами, м' + (nk > 1 || o.dimStyle === 'full' ? ' (' + nk + 'к — кабелей в траншее)' : ''));
  // ---- нижняя полоса: разрезы траншеи, примечания, штамп ----
  const sx1 = W - 5, sx0 = sx1 - 126, st = 118;
  tx('Lтр = ' + f2(Ltr) + ' м', sx1 - 2, st + 3.6, 4, 2); if (o.sign) tx(o.sign, sx0 + 2, st + 3.6, 4, 0);
  const R = [10, 26, 14, 14, 7, 7, 7, 7, 7, 7, 7]; let yy = st; const ys = [st]; R.forEach(h => { yy -= h; ys.push(yy); });
  rect(sx0, ys[ys.length - 1], sx1, st); ys.slice(1, -1).forEach((v, i) => ln(sx0, v, i === 4 ? sx0 + 76 : sx1, v));   // «Согласование» — ячейка на две строки
  tx(o.org, (sx0 + sx1) / 2, (ys[0] + ys[1]) / 2, 4);
  const tl = wrap(o.object || 'Исполнительный чертёж сети наружного освещения', 64).slice(0, 7); tl.forEach((s, i) => tx(s, (sx0 + sx1) / 2, (ys[1] + ys[2]) / 2 + (tl.length - 1) * 1.7 - i * 3.4, 2.4));
  ln(sx1 - 44, ys[2], sx1 - 44, ys[3]); ln(sx1 - 22, ys[2], sx1 - 22, ys[3]);
  tx('Проектная организация: ' + (o.designer || ''), sx0 + 2, ys[2] - 4.5, 2.5, 0); tx('№ пр: ' + (o.projNo || ''), sx0 + 2, ys[2] - 10, 2.5, 0);
  tx('Лист ' + (o.sheet || '1'), sx1 - 33, (ys[2] + ys[3]) / 2, 2.5); tx('Листов ' + (o.sheets || '1'), sx1 - 11, (ys[2] + ys[3]) / 2, 2.5);
  ln(sx0 + 63, ys[3], sx0 + 63, ys[4]); wrap(o.insp || 'Административная инспекция', 26).slice(0, 2).forEach((s, i) => tx(s, sx0 + 2, ys[3] - 4.5 - i * 5, 2.5, 0));
  tx('Ордер № ' + (o.order || ''), sx0 + 65, ys[3] - 4.5, 2.5, 0); tx('на право производства работ', sx0 + 65, ys[3] - 9.5, 2.5, 0);
  ln(sx0 + 47, ys[4], sx0 + 47, ys[ys.length - 1]); ln(sx0 + 76, ys[4], sx0 + 76, ys[ys.length - 1]); ln(sx0 + 111, ys[6], sx0 + 111, ys[ys.length - 1]);
  tx('Стр-во начато', sx0 + 2, (ys[4] + ys[5]) / 2, 2.5, 0); tx(o.yStart, sx0 + 61.5, (ys[4] + ys[5]) / 2, 2.5);
  tx('Стр-во окончено', sx0 + 2, (ys[5] + ys[6]) / 2, 2.5, 0); tx(o.yEnd, sx0 + 61.5, (ys[5] + ys[6]) / 2, 2.5);
  tx('Согласование с', sx0 + 101, ys[4] - 4, 2.5); tx('ОПС ' + (o.ops || ''), sx0 + 101, ys[4] - 9.5, 2.5);
  ['Должность', 'Подпись', 'Фамилия', 'Дата'].forEach((s, i) => tx(s, sx0 + [23.5, 61.5, 93.5, 118.5][i], (ys[6] + ys[7]) / 2, 2.5));
  [[o.post1, o.name1], [o.post2, o.name2], [o.post3, o.name3]].forEach((r, i) => { tx(r[0], sx0 + 2, (ys[7 + i] + ys[8 + i]) / 2, 2.5, 0); tx(r[1], sx0 + 78, (ys[7 + i] + ys[8 + i]) / 2, 2.5, 0); });
  // примечания
  const dep = String(o.depth || '0,7').replace('.', ','), notes = [];
  notes.push('Трасса КЛ проложена на глубине ' + dep + ' м от поверхности.');
  notes.push('Исполнительная съёмка выполнена электронным тахеометром' + (o.device ? ' ' + o.device : '') + '.');
  notes.push('Система координат местная г. Москвы. Система высот Балтийская.');
  String(o.notes || '').split(/\n/).filter(s => s.trim()).forEach(s => notes.push(s.trim()));
  notes.push('Приложение: каталог координат пикетов.');
  const nx = sx0 - 100; let ny = 60; tx('Примечания', nx, ny + 6, 3.5, 0);
  notes.forEach((s, i) => wrap((i + 1) + '. ' + s, 52).forEach(t => { tx(t, nx, ny, 2.4, 0); ny -= 4; }));
  // разрезы траншеи: обычный и в футляре (если есть)
  const hasCas = m.edges.some(e => e.cas), casD = (m.runs.find(r => r.cas && r.comp) || {}).comp;
  tx('Разрезы траншеи', 28 + 60, st + 1, 4);
  section(D, S, 34, o, { title: 'под тротуаром и газоном' });
  if (hasCas) section(D, S, 34 + 95, o, { title: 'в футляре (под проезжей частью)', cas: casD ? casD.d : 110 });
}
// разрез траншеи М 1:10: ширина, глубина, песок, труба и кабель
function section(D, S, x0, o, opt) {
  const X = v => S.X0 + v * K, Y = v => S.Y0 + v * K, L = LAY.sec;
  const ln = (x1, y1, x2, y2, c) => D.line(L, X(x1), Y(y1), X(x2), Y(y2), c == null ? 7 : c), tx = (s, x, y, h, al, c) => D.text(L, String(s), X(x), Y(y), h * K, 0, al == null ? 1 : al, c == null ? 7 : c);
  const dep = I.num(o.depth) || 0.7, wd = I.num(o.trenchW) || 0.3, pd = (/(\d{2,3})\s*мм/.exec(o.pipe || '') || /(\d{2,3})/.exec(o.pipe || '') || [0, 63])[1] / 1000, cd = opt.cas ? opt.cas / 1000 : 0;
  const sc = 100, g = 104, w = wd * sc, bot = g - (dep + 0.1 + Math.max(pd, cd) / 2) * sc, xa = x0 + 12, xb = xa + w, cxm = (xa + xb) / 2, cy = g - dep * sc;
  tx(opt.title, cxm + 10, g + 8, 2.6);
  ln(xa - 12, g, xa, g); ln(xb, g, xb + 12, g); for (let i = 0; i < 4; i++) { ln(xa - 11 + i * 3, g, xa - 13 + i * 3, g - 2, 8); ln(xb + 2 + i * 3, g, xb + i * 3, g - 2, 8); }
  ln(xa, g, xa, bot); ln(xb, g, xb, bot); ln(xa, bot, xb, bot);
  const sand = Math.min(g - 3, cy + Math.max(pd, cd) * sc / 2 + 10); ln(xa, sand, xb, sand, 8);
  for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) { const px = xa + 3 + i * (w - 6) / 4, py = bot + 2 + j * (sand - bot - 4) / 2; if (Math.hypot(px - cxm, py - cy) > Math.max(pd, cd) * sc / 2 + 1) D.circle(L, X(px), Y(py), 0.08, 8); }
  if (cd) D.circle(L, X(cxm), Y(cy), cd * sc / 2 * K, 5);
  D.circle(L, X(cxm), Y(cy), pd * sc / 2 * K, 1); D.circle(L, X(cxm), Y(cy), 0.9 * K, 1);
  const lx = xb + 16; let ly = cy + 9;
  const lab = (s, tx0, ty0) => { ln(tx0, ty0, lx - 1, ly - 1.6); ln(lx - 1, ly - 1.6, lx + 0.7 * 2.4 * s.length * 0.9, ly - 1.6); tx(s, lx, ly, 2.4, 0); ly -= 6; };
  tx('Уровень земли', xb + 13, g + 1.8, 2.2, 0);
  if (cd) lab('Труба %%c' + opt.cas + 'мм (футляр)', cxm + cd * sc / 2 * 0.7, cy + cd * sc / 2 * 0.7);
  lab(o.pipe || 'Труба ПЭ %%c63мм', cxm + pd * sc / 2 * 0.7, cy + pd * sc / 2 * 0.7);
  lab('Кабель ' + (o.cable || ''), cxm, cy);
  lab('Песок', xb - 2, bot + 3);
  // размеры: глубина до кабеля и ширина траншеи, мм
  ln(xa - 7, g, xa - 7, cy); ln(xa - 8.5, g, xa - 5.5, g); ln(xa - 8.5, cy, xa - 5.5, cy); ln(xa - 7, cy, cxm, cy, 8);
  D.text(L, String(Math.round(dep * 1000)), X(xa - 9), Y((g + cy) / 2), 2.4 * K, 90, 1, 7);
  ln(xa, bot - 5, xb, bot - 5); ln(xa, bot - 6.5, xa, bot - 3.5); ln(xb, bot - 6.5, xb, bot - 3.5); tx(String(Math.round(wd * 1000)), cxm, bot - 8.5, 2.4);
}
// геоподоснова обрезается по окну плана: линии не выходят на штамп и поля листа
function clipPrims(E, w) {
  const out = [], code = (x, y) => (x < w[0] ? 1 : x > w[2] ? 2 : 0) | (y < w[1] ? 4 : y > w[3] ? 8 : 0);
  const seg = (a, b) => { let x0 = a[0], y0 = a[1], x1 = b[0], y1 = b[1], c0 = code(x0, y0), c1 = code(x1, y1);
    for (let k = 0; k < 8; k++) { if (!(c0 | c1)) return [[x0, y0], [x1, y1]]; if (c0 & c1) return null;
      const c = c0 || c1; let x, y;
      if (c & 8) { x = x0 + (x1 - x0) * (w[3] - y0) / (y1 - y0); y = w[3]; } else if (c & 4) { x = x0 + (x1 - x0) * (w[1] - y0) / (y1 - y0); y = w[1]; }
      else if (c & 2) { y = y0 + (y1 - y0) * (w[2] - x0) / (x1 - x0); x = w[2]; } else { y = y0 + (y1 - y0) * (w[0] - x0) / (x1 - x0); x = w[0]; }
      if (c === c0) { x0 = x; y0 = y; c0 = code(x0, y0); } else { x1 = x; y1 = y; c1 = code(x1, y1); } }
    return null; };
  E.forEach(e => {
    if (e.t === 'T' || e.t === 'C') { if (e.x >= w[0] && e.x <= w[2] && e.y >= w[1] && e.y <= w[3]) out.push(e); return; }
    if (!e.p) { out.push(e); return; }
    if (e.p.every(q => !code(q[0], q[1]))) { out.push(e); return; }
    const pts = e.closed ? e.p.concat([e.p[0]]) : e.p; let run = null;
    for (let i = 1; i < pts.length; i++) { const r = seg(pts[i - 1], pts[i]);
      if (!r) { run = null; continue; }
      if (run && run[run.length - 1][0] === r[0][0] && run[run.length - 1][1] === r[0][1]) run.push(r[1]); else { run = [r[0], r[1]]; out.push(Object.assign({}, e, { t: 'P', p: run, closed: false })); } }
  });
  return out;
}
Object.assign(I, { clipPrims, numberPickets, drawNO, sheetNO, drawSheetNO, NO_LAYERS: LAY });
})();
