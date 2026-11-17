/* ИЧ — закрытый переход методом ГНБ: профиль, план, сечения, штамп, каталог и протокол бурения.
   Обучено по принятым ИЧ МГГТ 2692а-26 (ГНБ 6) и 3118а-26 (ГНБ 2), ТПУ «Домодедовская». */
(function () {
'use strict';
const I = window.ICH, fnum = I.fnum, num = I.num, rnd = I.rnd;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const f1 = v => rnd(v, 1).toFixed(1), f2 = v => rnd(v, 2).toFixed(2), f3 = v => rnd(v, 3).toFixed(3);

// настройки перехода по умолчанию — как в принятых ИЧ
const GNB_DEFAULT = {
  no: '', n: 19, d: 110, sdr: '13.6', mat: 'ПЭ 100', gost: 'ГОСТ 18599-2001', dskv: 700,
  reverse: false, chain: 0, groundA: '', groundB: '', pit: 0.70, dcorr: '',
  cables: '', cover: '', cross: '',
  projPlan: '', projArc: '',
  // протокол бурения
  city: 'г. Москва', protDate: '', pilot: 90, reams: '200, 400', reamer: 'Кодиак', locator: 'F-2', sonde: 'FX (серый)', rod: 3.05, dStart: '', dEnd: '',
  // штамп
  org: '', object: '', customer: 'ГКУ "ДКР"', order: '', designer: '', ops: '', yStart: '', yEnd: '', insp: 'Административная инспекция',
  chief: '', pm: '', geod: '', chiefPost: 'Гл.инженер', pmPost: 'Рук.проекта', geodPost: 'Геодезист'
};

// ---------------- переходы в съёмке ----------------
// точки 4028 по порядку номеров; «..» — продолжение предыдущей точки, без связи — начало нового перехода
function gnbChains(P) {
  const pts = P.filter(p => p.code === '4028').sort((a, b) => a.n - b.n), chains = [];
  let cur = null;
  pts.forEach(p => {
    if (!p.link || !cur) { cur = [p]; chains.push(cur); return; }
    const r = p.link.slice(2).split(',').filter(Boolean).map(Number);
    if (r.length && !cur.some(q => q.n === r[0])) { const ch = chains.find(c => c.some(q => q.n === r[0])); if (ch) { ch.push(p); cur = ch; return; } }
    cur.push(p);
  });
  return chains.filter(c => c.length >= 2 && c.some(p => p.dep != null));
}

// ---------------- расчёт ----------------
function buildGnb(P, g) {
  const warn = [], chains = gnbChains(P);
  if (!chains.length) throw new Error('В съёмке нет перехода ГНБ: нужны точки 4028 с глубиной в номере («2-1.36»).');
  const ci = Math.min(Math.max(+g.chain || 0, 0), chains.length - 1);
  let ch = chains[ci].map(p => Object.assign({}, p));
  if (ch[0].x > ch[ch.length - 1].x) ch.reverse();          // нумерация с запада (слева на профиле), как в принятых ИЧ
  if (g.reverse) ch.reverse();
  const d = (num(g.d) || 110) / 1000, Dskv = (num(g.dskv) || 700) / 1000, pit = num(g.pit) != null ? num(g.pit) : 0.70;
  // локатор даёт глубину до оси; верх трубы = земля − глубина + поправка (по умолчанию половина d, округлённая вниз до см: d110 → 0,05)
  const dcorr = num(g.dcorr) != null ? num(g.dcorr) : Math.floor(d * 100 / 2 + 1e-9) / 100;
  const situ = P.filter(p => /^7\d{2,}$/.test(p.code));
  ch.forEach((p, i) => {
    p.k = i + 1;
    if (p.dep != null) { p.ground = p.H; p.top = p.H - p.dep + dcorr; p.gsrc = 'съёмка'; return; }
    p.top = p.H;                                             // приямок: отметка верха трубы снята прямо
    const end = i === 0 || i === ch.length - 1, user = num(i === 0 ? g.groundA : i === ch.length - 1 ? g.groundB : null);
    if (!end) warn.push('т.' + p.n + ' в середине перехода без глубины — отметка принята как верх трубы, земля = верх + ' + fnum(pit) + '.');
    if (user != null) { p.ground = user; p.gsrc = 'введено'; return; }
    const near = situ.filter(q => dist(q, p) < 6).sort((a, b) => dist(a, p) - dist(b, p))[0];
    // точка ситуации рядом с приямком — только если труба под ней не мельче приямка (иначе это не земля над трубой)
    if (near && end && near.H - p.top >= pit - 1e-9) { p.ground = near.H; p.gsrc = 'т.' + near.n + ' (' + fnum(dist(near, p), 1) + ' м)'; }
    else { p.ground = p.top + pit; p.gsrc = 'верх + ' + fnum(pit); }
  });
  // в таблицу и в каталог идут округлённые отметки; глубина и уклоны — из них, чтобы цифры на ИЧ сходились между собой
  ch.forEach(p => { p.top = rnd(p.top, 2); p.ground = rnd(p.ground, 2); });
  const segs = [];
  let st = 0;
  ch.forEach((p, i) => {
    p.st = st;
    if (i < ch.length - 1) {
      const q = ch[i + 1], L = dist(p, q), dh = q.top - p.top;
      segs.push({ a: p, b: q, L, dh, i: L > 0 ? dh / L : 0, len: Math.hypot(L, dh) });
      st += L;
    }
  });
  // длины перехода — суммы того, что написано в таблице профиля (расстояния до 0,1 м, длины до 0,01 м), как в принятых ИЧ
  const Lplan = segs.reduce((t, s) => t + rnd(s.L, 1), 0), Lprof = segs.reduce((t, s) => t + rnd(s.len, 2), 0);
  const Lexact = segs.reduce((t, s) => t + s.L, 0);
  ch.forEach(p => { p.depth = rnd(p.ground - p.top, 2); });
  const minDepth = Math.min(...ch.map(p => p.depth)), maxDepth = Math.max(...ch.map(p => p.depth));
  if (ch.some(p => p.depth < 0)) warn.push('Есть точки, где верх трубы выше земли — проверьте глубины и отметки.');
  // кабели в трубах
  const cables = parseCables(g.cables), used = cables.reduce((t, c) => t + c.k, 0), nP = +g.n || 1;
  if (used > nP) warn.push('Кабелей (' + used + ') больше, чем труб (' + nP + ').');
  return { kind: 'gnb', chains, ci, pts: ch, segs, Lplan, Lprof, Lexact, dcorr, d, Dskv, minDepth, maxDepth, cables, warn };
}
// «9к ВБвШВ 3x16-ЭС», «1кл ОКБ-0,22-24-П-7,0-ВОЛС» — число кабелей и подпись; цвет по назначению
const NET_COL = [[/-?ЭС\s*$/i, 1], [/-?НО\s*$/i, 6], [/ВОЛС/i, 3], [/-?ОДН\s*$/i, 5]];
function parseCables(txt) {
  return String(txt || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => {
    const m = /^(\d+)\s*(к|кл|каб)\.?\s*(.*)$/i.exec(s), col = (NET_COL.find(c => c[0].test(s)) || [0, 7])[1];
    return { k: m ? +m[1] : 1, s, col };
  });
}
// «ПЛИТ; 4.5» — покрытие до 4,5 м от начала (по плану); последняя строка без числа — до конца
function parseCover(txt, Ltot) {
  let a = 0; const out = [];
  String(txt || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(s => {
    const p = s.split(/\t|;/).map(x => x.trim()), to = num(p[1]);
    const b = to != null ? Math.min(to, Ltot) : Ltot; if (b > a) out.push({ a, b, s: p[0] }); a = b;
  });
  return out;
}
// «5.0; Водопровод d400 170,49в.тр.; 170.49» — пересечение: расстояние от т.1 по плану, подпись, отметка (необязательно)
function parseCross(txt) {
  return String(txt || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => { const p = s.split(/\t|;/).map(x => x.trim()); return { at: num(p[0]), s: p[1] || '', h: num(p[2]) }; }).filter(c => c.at != null);
}
// протокол бурения: штанги по плану от точки входа; уклон — на длине штанги, глубина — до оси на её конце
function drillRods(m, g) {
  const rod = num(g.rod) || 3.05, cnt = Math.floor(m.Lprof / rod + 1e-9), P = m.pts;
  const at = (s, key) => { s = Math.min(Math.max(s, 0), m.Lexact); for (let i = 0; i < P.length - 1; i++) if (s <= P[i + 1].st + 1e-9) { const t = (s - P[i].st) / ((P[i + 1].st - P[i].st) || 1); return P[i][key] + (P[i + 1][key] - P[i][key]) * t; } return P[P.length - 1][key]; };
  const rods = [];
  for (let k = 1; k <= cnt; k++) {
    const s = Math.min(rod * k, m.Lexact), s0 = rod * (k - 1);
    const sl = Math.round((at(s, 'top') - at(s0, 'top')) / ((s - s0) || rod) * 100), dp = Math.round((at(s, 'ground') - at(s, 'top') + m.dcorr) * 100);
    rods.push({ k, slope: (sl > 0 ? '+' : sl < 0 ? '-' : '') + Math.abs(sl), depth: dp });
  }
  return rods;
}

// ---------------- чертёж ----------------
const LG = { plan: 'ГНБ_трасса', pt: 'ГНБ_точки', otm: 'ГНБ_отметки', dim: 'ГНБ_длины', prof: 'ГНБ_профиль', net: 'ГНБ_труба', grd: 'ГНБ_земля',
  val: 'ГНБ_таблица', crs: 'ГНБ_пересечения', sec: 'ГНБ_сечения', stamp: 'ГНБ_штамп' };
const K = 5;   // 1:100 на листе 1:500 (1 м = 1 ед. плана)
const ROWS_G = [['Фактические отметки земли', 10], ['Отметки верха трубы', 10], ['Глубина заложения трубы', 7], ['Расстояние', 7], ['Уклон|Длина', 10],
  ['Материал и диаметр труб', 7], ['Покрытие', 7], ['Контрольные точки', 7]];
const pipeMark = g => 'Труба ' + (g.mat || 'ПЭ 100') + ' SDR ' + (g.sdr || '13.6') + ' ' + (g.n || 1) + 'd' + (g.d || 110) + ' ' + (g.gost || '');
const title = g => 'Закрытый переход N' + (g.no || '');

function drawGnbPlan(D, m, g, opt) {
  const P = m.pts, c = P.map(p => [p.x, p.y]);
  D.poly(LG.plan, c, 7);
  P.forEach((p, i) => {
    D.circle(LG.pt, p.x, p.y, 0.12, 7);
    const q = P[Math.min(i + 1, P.length - 1)], r = P[Math.max(i - 1, 0)], u = I.unit([r.x, r.y], [q.x, q.y]);
    const nx = u[1], ny = -u[0];   // номер — справа от хода (снизу), отметка — слева (сверху)
    D.text(LG.pt, String(p.k), p.x + nx * 1.2, p.y + ny * 1.2 - 0.3, 1.0, 0, 1, 7);
    if (opt.marks) D.text(LG.otm, f2(p.top), p.x - nx * 0.8, p.y - ny * 0.8, 0.3, 0, 1, 2);
  });
  // «L=3.90» на выносках над каждым отрезком, как в принятых ИЧ
  m.segs.forEach((s, i) => {
    const mx = (s.a.x + s.b.x) / 2, my = (s.a.y + s.b.y) / 2, u = I.unit([s.a.x, s.a.y], [s.b.x, s.b.y]);
    let nx = -u[1], ny = u[0]; if (ny < 0) { nx = -nx; ny = -ny; }
    const k = 4 + (i % 2) * 2.5, lx = mx + nx * k, ly = my + ny * k, t = 'L=' + f2(rnd(s.L, 1));
    D.line(LG.dim, mx, my, lx, ly, 7); D.line(LG.dim, lx, ly, lx - t.length * 0.62, ly, 7);
    D.text(LG.dim, t, lx - t.length * 0.31, ly + 0.65, 1.0, 0, 1, 7);
  });
  // выноска с составом перехода
  const s = m.segs[Math.floor(m.segs.length / 2)], mx = (s.a.x + s.b.x) / 2, my = (s.a.y + s.b.y) / 2;
  const tx = mx - 3, ty = my - 12, lines = ['Закрытый переход методом ГНБ N' + (g.no || ''), (g.n || 1) + ' труб d' + (g.d || 110) + ' ' + (g.mat || '') + ' SDR ' + (g.sdr || ''), 'Lв плане=' + fnum(m.Lplan) + 'м', 'Lв профиле=' + fnum(m.Lprof) + 'м'];
  D.line(LG.dim, mx, my, tx, ty + 0.6, 7); D.line(LG.dim, tx, ty + 0.6, tx + lines[0].length * 0.62, ty + 0.6, 7);
  lines.forEach((t, i) => D.text(LG.dim, t, tx, ty - i * 1.6, 1.0, 0, 0, 7));
}

function drawGnbProfile(D, m, g, X0, Ytop) {
  const P = m.pts, Lt = m.Lexact;
  const hs = P.map(p => p.top - m.Dskv).concat(parseCross(g.cross).filter(c => c.h != null).map(c => c.h));
  const Hc = Math.floor(Math.min(...hs) - 1), Hmax = Math.max(...P.map(p => p.ground)) + 1;
  const YB = Ytop - (Hmax - Hc) * K;                       // условный горизонт — верх таблицы
  const X = st => X0 + st * K, Y = h => YB + (h - Hc) * K, xr = X(Lt);
  const xl = X0 - 70, xh = X0 - 12;
  // заголовок
  const tl = [['Продольный профиль', 2.0], [title(g), 2.0], ['длина по плану ' + fnum(m.Lplan) + 'м', 2.0], ['длина по профилю ' + fnum(m.Lprof) + 'м', 2.0]];
  tl.forEach((t, i) => D.text(LG.prof, t[0], (X0 + xr) / 2, Y(Hmax) + 16 - i * 3, t[1], 0, 1, 7));
  // линейка высот
  D.line(LG.prof, xh, YB, xh, Y(Math.ceil(Hmax)), 7);
  for (let h = Hc; h <= Math.ceil(Hmax); h++) { D.line(LG.prof, xh - 1, Y(h), xh, Y(h), 7); if (h % 2 === 1 || h === Hc) D.text(LG.prof, f2(h), xh - 1.5, Y(h), 1.5, 0, 2, 7); }
  [['Продольный профиль', 2.0], ['М вертикальный 1:100', 2.0], ['М горизонтальный 1:100', 2.0], ['Условный горизонт ' + f2(Hc) + 'м', 2.0]]
    .forEach((t, i) => D.text(LG.prof, t[0], xl, YB + 12 - i * 3, t[1], 0, 0, 7));
  // таблица
  const ys = [YB]; ROWS_G.forEach(r => ys.push(ys[ys.length - 1] - r[1]));
  const mid = i => (ys[i] + ys[i + 1]) / 2;
  ys.forEach(y => D.line(LG.val, xl, y, xr, y, 7));
  [xl, X0].forEach(x => D.line(LG.val, x, ys[0], x, ys[ys.length - 1], 7)); D.line(LG.val, xr, ys[0], xr, ys[ys.length - 1], 7);
  ROWS_G.forEach(([nm], i) => {
    if (nm.includes('|')) { const [a, b] = nm.split('|'); D.text(LG.val, a, X0 - 2, ys[i] - 2.5, 2.0, 0, 2, 7); D.text(LG.val, b, xl + 1.5, ys[i + 1] + 2.5, 2.0, 0, 0, 7); D.line(LG.val, xl, ys[i], X0, ys[i + 1], 7); }
    else D.text(LG.val, nm, xl + 1.5, mid(i), 2.0, 0, 0, 7);
  });
  // земля, труба, скважина
  D.poly(LG.grd, P.map(p => [X(p.st), Y(p.ground)]), 7);
  D.poly(LG.net, P.map(p => [X(p.st), Y(p.top)]), 7);
  D.poly(LG.net, P.map(p => [X(p.st), Y(p.top - m.Dskv)]), 7);
  P.forEach(p => {
    const x = X(p.st);
    D.line(LG.prof, x, Y(p.ground), x, YB, 7);
    D.line(LG.val, x, ys[0], x, ys[3], 7); D.line(LG.val, x, ys[3], x, ys[5], 7);
    D.text(LG.val, f2(p.ground), x - 0.9, mid(0), 1.5, 90, 1, 7);
    D.text(LG.val, f2(p.top), x - 0.9, mid(1), 1.5, 90, 1, 7);
    D.text(LG.val, f2(p.depth), x - 0.9, mid(2), 1.5, 90, 1, 7);
    D.circle(LG.val, x, mid(7), 1.0, 7); D.text(LG.val, String(p.k), x, mid(7), 1.3, 0, 1, 7);
  });
  m.segs.forEach(s => {
    const xa = X(s.a.st), xb = X(s.b.st), xm = (xa + xb) / 2, down = s.dh < 0;
    D.text(LG.val, f1(s.L), xm, mid(3), 1.5, 0, 1, 7);
    // уклон — над диагональю, длина — под ней; диагональ — по направлению уклона
    if (down) { D.line(LG.val, xa, ys[4], xb, ys[5], 7); D.text(LG.val, f3(Math.abs(s.i)), xb - 0.6, ys[4] - 2.2, 1.5, 0, 2, 7); D.text(LG.val, f2(s.len), xa + 0.6, ys[5] + 2.2, 1.5, 0, 0, 7); }
    else { D.line(LG.val, xa, ys[5], xb, ys[4], 7); D.text(LG.val, f3(Math.abs(s.i)), xa + 0.6, ys[4] - 2.2, 1.5, 0, 0, 7); D.text(LG.val, f2(s.len), xb - 0.6, ys[5] + 2.2, 1.5, 0, 2, 7); }
  });
  D.text(LG.val, pipeMark(g), (X0 + xr) / 2, mid(5), 1.5, 0, 1, 7);
  parseCover(g.cover, Lt).forEach((c, i, a) => { if (i < a.length - 1) D.line(LG.val, X(c.b), ys[6], X(c.b), ys[7], 7); D.text(LG.val, c.s, (X(c.a) + X(c.b)) / 2, mid(6), 1.5, 0, 1, 7); });
  // пересечения с коммуникациями
  const gAt = s => { for (let i = 0; i < P.length - 1; i++) if (s <= P[i + 1].st + 1e-9) { const t = (s - P[i].st) / ((P[i + 1].st - P[i].st) || 1); return P[i].ground + (P[i + 1].ground - P[i].ground) * t; } return P[P.length - 1].ground; };
  parseCross(g.cross).forEach(c => {
    const s = Math.min(Math.max(c.at, 0), Lt), x = X(s), yg = Y(gAt(s)), yb = c.h != null ? Y(c.h) : YB;
    D.line(LG.crs, x, yg, x, yb, 7); if (c.h != null) D.circle(LG.crs, x, yb, 0.4, 7);
    D.text(LG.crs, c.s, x - 0.8, YB + 1, 1.5, 90, 0, 7);
  });
  // знаки сечений 1-1 и 2-2
  [[X0, '1', -1], [xr, '2', 1]].forEach(([x, t, sd]) => {
    const p = sd < 0 ? P[0] : P[P.length - 1];
    [Y(p.ground) + 3, Y(p.top) - 1].forEach(y => { D.line(LG.sec, x, y, x + sd * 2.2, y, 7); D.text(LG.sec, t, x + sd * 2.2, y + 1.6, 2.5, 0, 1, 7); });
  });
  return { yb: ys[ys.length - 1], xl, xr, ytop: Y(Hmax) + 4 };
}

// упаковка труб в скважине: ближайшие узлы шестиугольной сетки (с центром в узле или в центре треугольника)
function pack(n) {
  const best = [];
  [[0, 0], [0.5, Math.sqrt(3) / 6]].forEach(o => {
    const c = [];
    for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) { const x = i + (j % 2 ? 0.5 : 0) - o[0], y = j * Math.sqrt(3) / 2 - o[1]; c.push([x, y]); }
    c.sort((a, b) => Math.hypot(...a) - Math.hypot(...b) || b[1] - a[1] || a[0] - b[0]);
    const pick = c.slice(0, n), R = Math.max(...pick.map(q => Math.hypot(...q)));
    best.push({ pick, R });
  });
  best.sort((a, b) => a.R - b.R);
  // нумерация — сверху вниз, слева направо
  return best[0].pick.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
}
function drawSection(D, m, g, cx, cy, label, mirror) {
  const S = 25, R = m.Dskv / 2 * S, r = m.d / 2 * S, n = +g.n || 1, pos = pack(n).map(q => [q[0] * m.d * S * (mirror ? -1 : 1), q[1] * m.d * S]);
  D.text(LG.sec, 'Сечение перехода ' + label, cx, cy + R + 6, 1.5, 0, 1, 7);
  D.circle(LG.sec, cx, cy, R, 7);
  D.line(LG.sec, cx - R - 2, cy, cx + R + 2, cy, 8); D.line(LG.sec, cx, cy - R - 2, cx, cy + R + 2, 8);
  const occ = []; m.cables.forEach(c => { for (let k = 0; k < c.k; k++) occ.push(c); });
  pos.forEach((q, i) => {
    D.circle(LG.sec, cx + q[0], cy + q[1], r * 0.96, 7);
    D.text(LG.sec, String(i + 1), cx + q[0], cy + q[1] + r * 0.2, Math.min(2.2, r * 0.9), 0, 1, 7);
    if (occ[i]) D.circle(LG.sec, cx + q[0], cy + q[1] - r * 0.45, 0.25, occ[i].col);
  });
  D.line(LG.sec, cx - R * 0.7, cy + R * 0.7, cx - R - 6, cy + R + 2, 7); D.text(LG.sec, 'Дскв=' + (g.dskv || '') + ' мм', cx - R - 7, cy + R + 2.7, 1.25, 0, 2, 7);
  const lp = pos[pos.length - 1] || [0, 0];
  D.line(LG.sec, cx + lp[0], cy + lp[1], cx - R - 6, cy - R - 2, 7); D.text(LG.sec, 'Дтр=' + (g.d || '') + ' мм', cx - R - 7, cy - R - 1.3, 1.25, 0, 2, 7);
  // подписи кабелей: по группам, справа и слева, цветом назначения
  let k = 0;
  m.cables.forEach((c, j) => {
    const q = pos[Math.min(k, pos.length - 1)]; k += c.k;
    const side = (j % 2 ? -1 : 1) * (mirror ? -1 : 1), y = cy + R - 3 - Math.floor(j / 2) * 4;
    const xe = cx + side * (R + 4);
    D.line(LG.sec, cx + q[0], cy + q[1], xe, y, c.col); D.line(LG.sec, xe, y, xe + side * c.s.length * 0.8, y, c.col);
    D.text(LG.sec, c.s, xe + side * 0.5, y + 0.9, 1.25, 0, side > 0 ? 0 : 2, c.col);
  });
}

const wrap = (t, n) => { const out = []; let cur = ''; String(t).split(/\s+/).filter(Boolean).forEach(w => { if (cur && (cur + ' ' + w).length > n) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }); if (cur) out.push(cur); return out; };
// штамп как в принятых ИЧ (размеры листа в мм × 0,5 — для печати плана в 1:500)
function drawStamp(D, m, g, x0, y0) {
  const k = 0.5, W = 107 * k, obj = wrap(g.object || '', 52), rows = [[8, g.org || 'ООО «…»'], [Math.max(18, 6 + obj.length * 3.4), ['Исполнительный чертеж трассы ГНБ ' + (g.no || '') + ' по объекту:'].concat(obj).join('|')], [12, g.insp || ''],
    [12, ['Заказчик ' + (g.customer || ''), 'Заказ|' + (g.order || '')]], [10, ['Проектная мастерская', g.designer || '']], [10, ['Стр-во начато: ' + (g.yStart || ''), 'Согл. с ОПС № ' + (g.ops || '')]],
    [10, ['Стр-во закончено: ' + (g.yEnd || ''), 'Масштаб гориз. 1:500']], [7.5, ['Должность', 'Подпись', 'Ф.И.О.', 'Дата']],
    [7.5, [g.chiefPost || '', '', g.chief || '', '']], [7.5, [g.pmPost || '', '', g.pm || '', '']], [7.5, [g.geodPost || '', '', g.geod || '', '']]];
  let y = y0; const xs4 = [0, 26, 47, 85, 107].map(v => x0 + v * k), xs2 = [x0, x0 + 46 * k, x0 + W];
  D.text(LG.stamp, 'Lпл=' + fnum(m.Lplan) + 'м', x0, y0 + 3.4, 1.2, 0, 0, 7); D.text(LG.stamp, 'Lпроф=' + fnum(m.Lprof) + 'м', x0, y0 + 1.6, 1.2, 0, 0, 7);
  D.line(LG.stamp, x0, y, x0 + W, y, 7);
  rows.forEach(([h, v]) => {
    const hh = h * k, ym = y - hh / 2;
    if (Array.isArray(v)) {
      const xs = v.length === 4 ? xs4 : xs2;
      xs.forEach(x => D.line(LG.stamp, x, y, x, y - hh, 7));
      v.forEach((t, i) => { const ps = String(t).split('|'); ps.forEach((p, j) => D.text(LG.stamp, p, xs[i] + 1, ym + (ps.length - 1) * 0.8 - j * 1.6, 1.2, 0, 0, 7)); });
    } else {
      D.line(LG.stamp, x0, y, x0, y - hh, 7); D.line(LG.stamp, x0 + W, y, x0 + W, y - hh, 7);
      const ps = String(v).split('|'); ps.forEach((p, j) => D.text(LG.stamp, p, x0 + W / 2, ym + (ps.length - 1) * 0.8 - j * 1.6, 1.2, 0, 1, 7));
    }
    y -= hh; D.line(LG.stamp, x0, y, x0 + W, y, 7);
  });
  return y;
}

function drawGnb(D, m, g, opt) {
  let k = D.e.length; drawGnbPlan(D, m, g, opt); D.mark('plan', k);
  const xs = m.pts.map(p => p.x), ys = m.pts.map(p => p.y);
  const X0 = Math.max(...xs) + 120, Ytop = Math.max(...ys) + 10;
  k = D.e.length;
  const pr = drawGnbProfile(D, m, g, X0, Ytop);
  const xr = pr.xr, R = m.Dskv / 2 * 25;
  drawSection(D, m, g, X0 + R + 25, pr.ytop + R + 8, '1-1', false);
  drawSection(D, m, g, xr - R - 25, pr.ytop + R + 8, '2-2', true);
  D.mark('profile', k);
  k = D.e.length; drawStamp(D, m, g, xr - 107 * 0.5, pr.yb - 15); D.mark('stamp', k);
  D.mark('all', 0);
}

// ---------------- Excel ----------------
const xe = I.xe;
function sheetXml(cols, rows, merges, extra) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><cols>' + cols.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols><sheetData>' + rows + '</sheetData>'
    + (merges.length ? '<mergeCells count="' + merges.length + '">' + merges.map(r => '<mergeCell ref="' + r + '"/>').join('') + '</mergeCells>' : '')
    + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait" fitToHeight="0"/>' + (extra || '') + '</worksheet>';
}
const cellX = (ref, v, st, isNum) => v == null || v === '' ? '<c r="' + ref + '" s="' + (st || 0) + '"/>'
  : isNum ? '<c r="' + ref + '" s="' + (st || 0) + '"><v>' + v + '</v></c>' : '<c r="' + ref + '" s="' + (st || 0) + '" t="inlineStr"><is><t xml:space="preserve">' + xe(v) + '</t></is></c>';
const rowX = (r, cells, ht) => '<row r="' + r + '"' + (ht ? ' ht="' + ht + '" customHeight="1"' : '') + '>' + cells.join('') + '</row>';
function book(sheets, styles) {
  const names = sheets.map(s => s[0]);
  return I.zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + names.map((n, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + names.map((n, i) => '<sheet name="' + xe(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + names.map((n, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', styles]].concat(sheets.map((s, i) => ['xl/worksheets/sheet' + (i + 1) + '.xml', s[1]])));
}
// каталог ГНБ — как в 2692а-26: № точки, X, Y, H, «в.тр.»; X — север
function catalogGnbXlsx(m) {
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="0.000"/><numFmt numFmtId="165" formatCode="0.00"/></numFmts>'
    + '<fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/><charset val="204"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '</cellXfs><cellStyles count="1"><cellStyle name="Обычный" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  let rows = rowX(1, [cellX('A1', 'Номер точки', 1), cellX('B1', 'Координаты', 1), cellX('C1', '', 1), cellX('D1', 'H', 1), cellX('E1', '', 1)])
    + rowX(2, [cellX('A2', '', 1), cellX('B2', 'X', 1), cellX('C2', 'Y', 1), cellX('D2', '', 1), cellX('E2', '', 1)]);
  m.pts.forEach((p, i) => { const r = i + 3; rows += rowX(r, [cellX('A' + r, p.k, 4, true), cellX('B' + r, rnd(p.y, 3), 2, true), cellX('C' + r, rnd(p.x, 3), 2, true), cellX('D' + r, rnd(p.top, 2), 3, true), cellX('E' + r, 'в.тр.', 4)]); });
  return book([['Лист1', sheetXml([14.33, 12.66, 12.66, 9.22, 8], rows, ['A1:A2', 'B1:C1', 'D1:E2'])]], styles);
}
// протокол бурения — как у АМС-Компании: Times New Roman 12, три колонки по 24 штанги
function protocolXlsx(m, g, rods) {
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="12"/><name val="Times New Roman"/><family val="1"/><charset val="204"/></font><font><b/><sz val="12"/><name val="Times New Roman"/><family val="1"/><charset val="204"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '</cellXfs><cellStyles count="1"><cellStyle name="Обычный" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const reams = String(g.reams || '').split(/[,;\s]+/).map(num).filter(v => v != null), pull = num(g.dskv) || 700, R = g.reamer || 'Кодиак';
  const works = ['Пройдена пилотная скважина                                        ∅' + (g.pilot || 90) + ' мм']
    .concat(reams.map(v => 'Расширение скважины расширителем «' + R + '»         ∅' + v + ' мм'), ['Протяжка трубы с расширителем «' + R + '»                 ∅' + pull + ' мм']).map((t, i) => (i + 1) + '. ' + t);
  let r = 1, out = '';
  const line = (t, st, ht) => { out += rowX(r, [cellX('A' + r, t, st || 0)], ht); r++; };
  line('Протокол бурения ', 1);
  line(' ' + (g.city || 'г. Москва') + '                                                                                                        ' + (g.protDate || ''));
  r++;
  const rObj = r; line('Объект: ' + (g.object || ''), 2, 32);
  line('Заказчик:  ' + (g.customer || ''));
  line('Выполненные работы:');
  works.forEach(t => line(t));
  line('Тип локационной системы: ' + (g.locator || ''));
  line('Тип зонда:   ' + (g.sonde || ''));
  line('Начало работ: ' + (g.dStart || ''));
  line('Окончание работ: ' + (g.dEnd || ''));
  r++;
  const h = ['№ шт.', 'Уклон в   %', 'Глубина в   см', '№  шт.', 'Уклон в %', 'Глубина в см ', '№ ', 'Уклон в  %', 'Глубина в  см'];
  out += rowX(r, h.map((t, i) => cellX(String.fromCharCode(65 + i) + r, t, 3)), 32); r++;
  const by = new Map(rods.map(x => [x.k, x]));
  for (let i = 1; i <= 24; i++) {
    const c = [];
    [i, i + 24, i + 48].forEach((k, j) => { const L = String.fromCharCode(65 + j * 3), x = by.get(k);
      c.push(cellX(L + r, k, 3, true), cellX(String.fromCharCode(66 + j * 3) + r, x ? x.slope : '', 4), x ? cellX(String.fromCharCode(67 + j * 3) + r, x.depth, 3, true) : cellX(String.fromCharCode(67 + j * 3) + r, '', 3)); });
    out += rowX(r, c); r++;
  }
  r++;
  line('                                          Длина 1 буровой штанги — ' + String(num(g.rod) || 3.05).replace('.', ',') + ' метра.');
  r++;
  line(' ' + (g.chiefPost === 'Гл.инженер' || !g.chiefPost ? 'Гл. инженер' : g.chiefPost) + '    ' + (g.org || '') + '___________________' + (g.chief || '').replace(/\.$/, ''));
  if (rods.length > 72) out += '';
  return book([['Sheet1', sheetXml([8.78, 8.78, 8.78, 7.66, 8.78, 8.78, 7.78, 8.78, 8.89, 8.22], out, ['A1:I1', 'A' + rObj + ':I' + rObj])]], styles);
}

Object.assign(I, { GNB_DEFAULT, gnbChains, buildGnb, drillRods, drawGnb, catalogGnbXlsx, protocolXlsx, parseCover, parseCross, parseCables, gnbPipeMark: pipeMark });
})();
