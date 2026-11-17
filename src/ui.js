/* ИЧ — интерфейс: меню, настройки, просмотр, скачивание. */
(function () {
'use strict';
const I = window.ICH, $ = s => document.querySelector(s), esc = I.esc, fnum = I.fnum, num = I.num;
const KEY = 'ich.v1';
const S = { file: null, raw: null, parsed: null, res: null, err: null, tab: 'plan', view: null,
  set: { mode: 'fact', tol: 10, profile: true, start: 'auto', marks: false, dims: true, nums: true }, proj: { object: '', wells: [], spans: [] },
  obj: { org: '', kind: 'кабеля наружного освещения', object: '', ks: '', contract: '', cableL: '', author: 'Шахмиров А.М', device: 'Nikon XF 05', z: false } };
S.gnb = Object.assign({}, I.GNB_DEFAULT);
S.geo = null; S.pdf = null; S.spec = { text: '', src: '' }; S.pickFor = null;
try { const st = JSON.parse(localStorage.getItem(KEY) || 'null'); if (st) { Object.assign(S.set, st.set || {}); if (st.proj) S.proj = st.proj; if (st.obj) Object.assign(S.obj, st.obj); if (st.gnb) Object.assign(S.gnb, st.gnb); if (st.spec) S.spec = st.spec; } } catch (e) { /* хранилище недоступно — работаем без него */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ set: S.set, obj: S.obj, gnb: S.gnb, spec: S.spec, proj: S.demoProj ? { object: '', wells: [], spans: [] } : S.proj })); } catch (e) { /* без сохранения */ } };

// ---------- уведомления ----------
let tt; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 3200); }
function download(bytes, name, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
const baseName = () => (S.file || 'ИЧ').replace(/\.[^.]+$/, '');

// ---------- геоподоснова: обязательна для ИЧ, окно вокруг сети ложится на чертёж ----------
function geoDwg(pts) {
  const D = new I.Dwg(); D.geoN = 0;
  if (S.geo && pts.length) {
    const pad = num(S.set.geoPad) || 40, xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    D.geoN = I.addGeo(D, S.geo.G, [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]);
  }
  return D;
}
function geoBlock() {
  if (!S.geo) return reqList(true) +  '<div class="geo-need"><b>Нужна геоподоснова.</b> ИЧ строится на геоподоснове МГГТ — откройте её DXF. Без неё чертёж только для просмотра, DXF не выдаётся.<div class="row"><button class="btn primary small" id="geoopen">Открыть геоподоснову…</button></div></div>';
  return reqList(true) + '<h3 class="sh">Геоподоснова</h3><ul class="files"><li class="gen">' + esc(S.geo.name) + '</li><li>на ИЧ: ' + (S.res && S.res.D ? S.res.D.geoN : 0) + ' элементов в окне ±' + esc(String(S.set.geoPad || 40)) + ' м</li></ul>'
    + '<div class="row"><label class="fld" style="flex:1">Окно вокруг сети, м<input id="geopad" inputmode="decimal" value="' + esc(String(S.set.geoPad || 40)) + '"></label></div><div class="row"><button class="btn small" id="geoopen">Другая геоподоснова…</button></div>';
}
function projBlock() {
  return '<h3 class="sh">Проект</h3><ul class="files">' + (S.pdf ? '<li class="gen">' + esc(S.pdf.name) + ' — вкладка «Проект»</li>' : '<li>PDF проекта не открыт</li>')
    + (S.spec.src ? '<li>спецификация: ' + esc(S.spec.src) + '</li>' : '') + '</ul><div class="row"><button class="btn small" id="projopen">Открыть проект (PDF / DXF)…</button></div>';
}
function pdfDesk() {
  if (!S.pdf) return '<div class="desk-scroll"><p class="fine pad">PDF проекта не открыт.</p></div>';
  return '<div class="desk-scroll" style="display:flex;flex-direction:column"><div class="row" style="padding:6px 10px"><label class="fld" style="max-width:160px">Лист PDF<input id="pdfpage" inputmode="numeric" value="' + esc(String(S.set.pdfPage || 1)) + '"></label></div>'
    + '<embed src="' + S.pdf.url + '#page=' + (parseInt(S.set.pdfPage, 10) || 1) + '" type="application/pdf" style="flex:1;width:100%;min-height:600px"></div>';
}
function bindProj() {
  const go = $('#geoopen'); if (go) go.onclick = () => { S.pickFor = 'geo'; pick('.dxf'); };
  const po = $('#projopen'); if (po) po.onclick = () => { S.pickFor = 'proj'; pick('.pdf,.dxf'); };
  const gp = $('#geopad'); if (gp) gp.oninput = () => { S.set.geoPad = num(gp.value) || 40; later(); };
  const pp = $('#pdfpage'); if (pp) pp.onchange = () => { S.set.pdfPage = parseInt(pp.value, 10) || 1; save(); render(); };
}

// ---------- расчёт ----------
function hasProject() { return S.proj.wells.some(w => w.name || w.top != null) || S.proj.spans.some(s => s.len != null); }
function compute() {
  S.res = null; S.err = null; S.det = null; S.netSel = null;
  if (!S.parsed) return;
  try {
    const P = S.parsed.pts;
    const det = S.det = I.detectNets(P);
    const f = det.found.find(x => x.net.id === S.set.net) || det.found.find(x => x.net.kind) || det.found[0];
    if (!f) throw new Error('В съёмке нет кодов известных сетей (476, 491, 4041…). Проверьте коды точек.');
    const net = S.netSel = f.net;
    if (!net.kind) throw new Error('Сеть «' + net.name + '» распознана, но ИЧ для неё программа пока не строит. Пришлите образец ИЧ этой сети — научим.');
    if (net.kind === 'line') { computeLine(P, net); return; }
    if (net.kind === 'gnb') { computeGnb(P); return; }
    const proj = hasProject() ? S.proj : null;
    const names = proj ? proj.wells.map(w => w.name) : null;
    const startN = S.set.start === 'auto' ? null : +S.set.start;
    let m = I.build(P, startN, names, net);
    if (proj && !startN && m.order.length === proj.wells.length) {     // направление — по лучшему совпадению с проектом
      const sc = seq => seq.reduce((t, w, i) => t + (proj.wells[i].top != null ? Math.abs(w.top - proj.wells[i].top) : 0), 0);
      if (sc(m.order.slice().reverse()) < sc(m.order)) m = I.build(P, m.order[m.order.length - 1].c.n, names, net);
    }
    const fit = proj && S.set.mode === 'fit', tol = fit ? (num(S.set.tol) || 0) / 100 : null;
    let mode = fit ? 'подогнано под проект, допуск ' + (num(S.set.tol) || 0) + ' см' : 'по фактической съёмке';
    const rows = proj ? I.compare(m.order, m.route, proj, tol) : null;
    const D = geoDwg(P);
    let k = D.e.length; I.drawPlan(D, m.order, m.route); D.mark('plan', k);
    const xs = P.map(p => p.x), ys = P.map(p => p.y);
    let xl, yb;
    if (S.set.profile) {
      const H1 = Math.ceil(Math.max(...m.order.map(w => w.top)) + 1), H0 = Math.floor(Math.min(...m.order.map(w => w.bottom != null ? w.bottom : w.top - 2)) - 1);
      k = D.e.length; ({ xl, yb } = I.drawProfile(D, m.order, m.route, Math.min(...xs) + 75, Math.min(...ys) - 40 - (H1 - H0) * 10)); D.mark('profile', k);
    } else { xl = Math.min(...xs); yb = Math.min(...ys) - 20; }
    mode += S.set.profile ? ', с профилем' : ', без профиля';
    k = D.e.length;
    I.drawWells(D, m.order, xl, yb - 20);
    D.text('Текст и таблицы', 'ИЧ построена: ' + mode, xl, yb - 8, 3.0, 0, 0, fit ? 1 : 7);
    D.mark('table', k); D.mark('all', 0);
    S.res = { kind: 'wells', D, order: m.order, route: m.route, warn: m.warn, ends: m.ends, rows, mode, fit };
  } catch (e) { S.err = e.message || String(e); }
}

function computeLine(P, net) {
  const names = S.proj.poles && S.proj.poles.some(Boolean) ? S.proj.poles : null;
  const m = I.buildLine(P, net, names), D = geoDwg(m.points);
  let k = D.e.length; I.drawLine(D, m, { marks: !!S.set.marks, dims: S.set.dims !== false, nums: S.set.nums !== false }); D.mark('plan', k);
  const xs = m.points.map(p => p.x), ys = m.points.map(p => p.y);
  k = D.e.length; const xr = I.drawLineTable(D, m, Math.min(...xs), Math.min(...ys) - 15);
  m.trench = I.drawNotes(D, m, S.obj, xr, Math.min(...ys) - 10); D.mark('table', k); D.mark('all', 0);
  S.res = { kind: 'line', D, m, warn: m.warn, mode: net.name + ': план и ведомость участков' };
}

function computeGnb(P) {
  const g = S.gnb, m = I.buildGnb(P, g), D = geoDwg(m.pts);
  I.drawGnb(D, m, g, { marks: g.marks !== false });
  const rods = I.drillRods(m, g), rows = [];
  const cmp = (par, pv, fv) => { pv = num(pv); if (pv == null) return; const d = fv - pv; rows.push({ par, pv: fnum(pv), fv: fnum(fv), d: (d >= 0 ? '+' : '−') + fnum(Math.abs(d)), bad: Math.abs(d) > 0.5 }); };
  cmp('Длина в плане, м', g.projPlan, m.Lplan); cmp('Длина по дуге (профилю), м', g.projArc, m.Lprof);
  const spec = I.parseSpec(S.spec.text), srows = I.checkSpec(spec, g, m.cables);
  S.res = { kind: 'gnb', D, m, rods, rows, spec, srows, warn: m.warn, mode: 'ГНБ: профиль, план, сечения, штамп' };
}

// точки для каталога координат: все точки выбранной сети по порядку номеров
function catalogPoints() {
  const n = S.netSel; if (!n || !S.parsed) return [];
  const codes = [n.well, n.pipe, n.cas, n.neck, n.pole, n.chamber, '99'].filter(Boolean);
  return S.parsed.pts.filter(p => codes.includes(p.code)).sort((a, b) => a.n - b.n);
}
function objForm() {
  const o = S.obj, f = (id, lab, ph) => '<label class="fld">' + lab + '<input data-obj="' + id + '" value="' + esc(o[id] || '') + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '></label>';
  const kinds = ['кабеля наружного освещения', 'кабеля наружного освещения ожидания', 'кабеля наружного электроснабжения', 'кабельной канализации'];
  return '<h3>Объект и каталог координат</h3><p class="hint">Для титула каталога и надписей на ИЧ. Сохраняется в браузере.</p>'
    + f('org', 'Организация', 'ООО «…»')
    + '<label class="fld">Каталог координат точек<select data-obj="kind">' + kinds.map(k => '<option' + (o.kind === k ? ' selected' : '') + '>' + k + '</option>').join('') + '</select></label>'
    + '<label class="fld">Объект<textarea data-obj="object" rows="3" placeholder="Комплексное благоустройство …">' + esc(o.object || '') + '</textarea></label>'
    + '<div class="two">' + f('ks', 'КС №', '48888-23,5851-24') + f('contract', 'N договора', '6/05911-23') + '</div>'
    + '<div class="two">' + f('author', 'Составитель') + f('device', 'Прибор') + '</div>'
    + f('cableL', 'L кабеля (для надписи, необязательно)', 'ВБШв 4х16 - 454м')
    + '<label class="chk"><input type="checkbox" data-obj="z"' + (o.z ? ' checked' : '') + '> Отметки Z в каталоге</label>'
    + '<div class="row"><button class="btn" id="cat">Каталог координат (Excel)</button></div>'
    + '<p class="fine">В каталог идут все точки сети по порядку номеров: ' + catalogPoints().length + ' шт. X — север, Y — восток, как в ваших каталогах.</p>';
}
function bindObj() {
  document.querySelectorAll('[data-obj]').forEach(el => {
    const k = el.dataset.obj;
    el.oninput = el.onchange = () => { S.obj[k] = el.type === 'checkbox' ? el.checked : el.value; save(); if (['ks', 'contract', 'cableL'].includes(k)) later(); };
  });
  const b = $('#cat'); if (b) b.onclick = () => {
    const pts = catalogPoints(); if (!pts.length) { toast('Нет точек сети для каталога.'); return; }
    download(I.catalogXlsx(S.obj, pts, !!S.obj.z), baseName() + ' — каталог координат.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    toast('Каталог: ' + pts.length + ' точек.');
  };
}

// ---------- открытие файлов ----------
async function openFile(f) {
  try {
    const bytes = new Uint8Array(await f.arrayBuffer()), ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    let raw;
    if (ext === '.json') { loadProject(JSON.parse(new TextDecoder().decode(bytes))); return; }
    const purpose = S.pickFor; S.pickFor = null;
    if (ext === '.pdf') { if (S.pdf) URL.revokeObjectURL(S.pdf.url); S.pdf = { name: f.name, url: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })) }; S.tab = 'pdf'; render(); toast('Проект открыт: ' + f.name + '. Сверяйте на вкладке «Проект»; спецификацию вставьте справа или откройте DXF проекта.'); return; }
    if (ext === '.dxf' && purpose === 'proj') { loadProjDXF(f.name, I.decode(bytes, true)); return; }
    if (ext === '.dxf' && purpose === 'geo') { loadGeo(f.name, I.decode(bytes, true)); return; }
    if (ext === '.dxf') { const txt = I.decode(bytes, true); raw = I.readDXF(txt); if (!raw.length) { if (/проект|иот|спец|ИОТ/i.test(f.name)) loadProjDXF(f.name, txt); else loadGeo(f.name, txt); return; } }
    else if (ext === '.are' || ext === '.pco') raw = I.readARE(I.decode(bytes, false));
    else { toast('Не знаю такой формат: ' + f.name + '. Нужен DXF, .are, .pco или проект .json.'); return; }
    if (!raw.length) { toast(ext === '.dxf' ? 'В файле нет точек-блоков _block2 с отметкой.' : 'В файле не нашлось точек.'); return; }
    if (S.demoProj) { S.proj = { object: '', wells: [], spans: [] }; S.demoProj = false; S.set.mode = 'fact'; }
    S.file = f.name; S.raw = raw; S.parsed = I.parsePoints(raw); S.set.start = 'auto'; S.set.net = null; S.view = null; S.tab = 'plan'; S.gnb.chain = 0; if (S.gnb.file !== f.name) { ['groundA', 'groundB', 'no', 'cables', 'cover', 'cross', 'projPlan', 'projArc'].forEach(k => { S.gnb[k] = ''; }); S.gnb.file = f.name; save(); }
    compute(); render(); toast('Открыто: ' + f.name + ' — ' + S.parsed.pts.length + ' точек' + (hasProject() ? '. Проект — из прошлой работы: проверьте его справа или очистите.' : ''));
  } catch (e) { toast('Не удалось прочитать ' + f.name + ': ' + e.message); }
}
function loadGeo(name, txt) {
  toast('Читаю геоподоснову ' + name + '…');
  setTimeout(() => {
    try { const G = I.readGeo(txt); S.geo = { name, G }; compute(); render(); toast('Геоподоснова: ' + name + ' — ' + G.layers.size + ' слоёв. На ИЧ ложится окно вокруг сети.'); }
    catch (e) { toast('Не удалось прочитать геоподоснову: ' + e.message); }
  }, 30);
}
function loadProjDXF(name, txt) {
  try {
    const G = I.readGeo(txt), rows = I.textRows(G), sp = I.parseSpec(rows.join('\n'));
    const keep = [...sp.pipes, ...sp.cables].map(x => x.src);
    if (!keep.length) { toast('В DXF проекта не нашлось строк с трубами и кабелями.'); return; }
    S.spec = { text: [...new Set(keep)].join('\n'), src: name + ' (' + keep.length + ' строк)' }; save(); compute(); render();
    toast('Спецификация из ' + name + ': труб ' + sp.pipes.length + ', кабелей ' + sp.cables.length + '. Проверьте справа.');
  } catch (e) { toast('Не удалось прочитать проект: ' + e.message); }
}
function loadProject(p) {
  if (!p || !Array.isArray(p.wells)) { toast('Это не файл проекта ИЧ (нет списка колодцев).'); return; }
  S.demoProj = false;
  S.proj = { object: p.object || '', wells: p.wells.map(w => Object.assign({ name: '', type: '', top: null, bottom: null, neck: null, pipe_in: null, pipe_out: null }, w)),
    spans: (p.spans || []).map(s => Object.assign({ n: null, d: null, len: null, casing: null }, s)) };
  if (S.set.mode === 'fact' && S.parsed) toast('Проект загружен. Чтобы подогнать ИЧ, выберите «Под проект».'); else toast('Проект загружен.');
  save(); compute(); render();
}
function fillRows() {
  if (S.res && S.res.kind === 'line') { const p = S.res.m.poles, old = S.proj.poles || []; S.proj.poles = p.map((q, i) => old[i] || q.name); save(); compute(); render(); toast('Опор: ' + p.length + '. Впишите имена из проекта или вставьте столбец из Excel.'); return; }
  if (!S.res) { toast('Сначала откройте съёмку.'); return; }
  const o = S.res.order, r = S.res.route, W = S.proj.wells, P = S.proj.spans;
  S.proj.wells = o.map((w, i) => W[i] || { name: 'К-' + (i + 1), type: w.type, top: null, bottom: null, neck: null, pipe_in: null, pipe_out: null });
  S.proj.spans = r.map((s, i) => P[i] || { n: s.n, d: s.d, len: null, casing: s.cas ? { D: s.cas.D, L: null } : null });
  save(); compute(); render(); toast('Строки проекта: ' + o.length + ' колодцев, ' + r.length + ' пролётов. Впишите или вставьте из Excel проектные значения.');
}

// ---------- отрисовка ----------
const COLS_W = [['name', 'Имя', 't'], ['type', 'Тип', 't'], ['top', 'Обеч.'], ['bottom', 'Дно'], ['neck', 'Нг.'], ['pipe_in', 'Тр. вх.'], ['pipe_out', 'Тр. вых.']];
const COLS_S = [['n', 'Труб'], ['d', 'd, мм'], ['len', 'Длина'], ['cD', 'Ф-р D'], ['cL', 'Ф-р L']];
function cellVal(v) { return v == null ? '' : String(v).replace('.', ','); }
function projTables() {
  const W = S.proj.wells, P = S.proj.spans, names = S.res ? S.res.order.map(w => w.name) : [];
  let h = '<table class="ptab"><thead><tr><th>№</th>' + COLS_W.map(c => '<th>' + c[1] + '</th>').join('') + '</tr></thead><tbody>';
  W.forEach((w, i) => { h += '<tr><td class="rn">' + (i + 1) + '</td>' + COLS_W.map((c, j) => '<td><input data-t="w" data-r="' + i + '" data-c="' + j + '" value="' + esc(cellVal(w[c[0]])) + '"' + (c[2] ? '' : ' inputmode="decimal"') + '></td>').join('') + '</tr>'; });
  h += '</tbody></table>';
  h += '<table class="ptab"><thead><tr><th>Пролёт</th>' + COLS_S.map(c => '<th>' + c[1] + '</th>').join('') + '</tr></thead><tbody>';
  P.forEach((s, i) => {
    const v = { n: s.n, d: s.d, len: s.len, cD: s.casing ? s.casing.D : null, cL: s.casing ? s.casing.L : null };
    const lab = (W[i] && W[i].name || names[i] || i + 1) + '–' + (W[i + 1] && W[i + 1].name || names[i + 1] || i + 2);
    h += '<tr><td class="rn" title="' + esc(lab) + '">' + esc(lab) + '</td>' + COLS_S.map((c, j) => '<td><input data-t="s" data-r="' + i + '" data-c="' + j + '" value="' + esc(cellVal(v[c[0]])) + '" inputmode="decimal"></td>').join('') + '</tr>';
  });
  return h + '</tbody></table>';
}
function setCell(t, r, c, val) {
  if (t === 'w') { const row = S.proj.wells[r]; if (!row) return; const k = COLS_W[c][0]; row[k] = COLS_W[c][2] ? val.trim() : num(val); }
  else { const row = S.proj.spans[r]; if (!row) return; const k = COLS_S[c][0], v = num(val);
    if (k === 'cD' || k === 'cL') { row.casing = row.casing || { D: null, L: null }; row.casing[k === 'cD' ? 'D' : 'L'] = v; if (row.casing.D == null && row.casing.L == null) row.casing = null; }
    else row[k] = k === 'len' ? v : (v == null ? null : Math.round(v)); }
}
function wellFlags(name) { if (!S.res || !S.res.rows) return null; const r = S.res.rows.filter(x => x.el === name); return { diff: r.filter(x => x.kind === 'diff' || x.kind === 'bad').length, fit: r.filter(x => x.kind === 'fit').length }; }

function netsBlock() {
  const d = S.det; if (!d) return '';
  let h = '<h3 class="sh">Сети в съёмке</h3>';
  if (!d.found.length) h += '<p class="fine">Не распознано ни одной сети.</p>';
  h += '<div class="nets">' + d.found.map(f => '<button class="net' + (S.netSel === f.net ? ' on' : '') + '" data-net="' + f.net.id + '"><b>' + esc(f.net.name) + '</b><span>' + esc(f.codes) + '</span><em class="' + (f.net.kind ? 'yes' : 'no') + '">' + (f.net.kind === 'wells' ? 'ИЧ: план, профиль, сверка' : f.net.kind === 'line' ? 'ИЧ: план и ведомость' : f.net.kind === 'gnb' ? 'ИЧ: профиль, сечения, протокол' : 'пока не обучена') + '</em></button>').join('') + '</div>';
  if (d.situ) h += '<p class="fine">Ситуация (7…): ' + d.situ + ' т. — в ИЧ не входит.</p>';
  if (d.unknown.length) h += '<p class="issue">Неизвестные коды: ' + esc(d.unknown.join(', ')) + '</p>';
  return h;
}
function renderLine() {
  const r = S.res, m = r.m;
  let side = geoBlock() + '<h2>Съёмка</h2><ul class="files"><li class="gen">' + esc(S.file) + '</li><li>точек сети: ' + m.points.length + ', опор: ' + m.poles.length + ', участков: ' + m.runs.length + '</li></ul>' + netsBlock();
  side += '<h3 class="sh">Итого по составу</h3><ul class="files">' + Object.keys(m.tot).sort().map(k => '<li>' + esc(k) + ' — <b>' + fnum(m.tot[k]) + ' м</b></li>').join('') + '<li>L траншеи — <b>' + fnum(m.trench, 1) + ' м</b></li></ul>';
  if (r.warn.length) side += '<h3 class="sh">Замечания</h3><div class="issues">' + r.warn.map(t => '<p class="issue">' + esc(t) + '</p>').join('') + '</div>';
  side += '<h3 class="sh">Опоры</h3><div class="objs">' + m.poles.map((p, i) => '<button class="obj" data-pole="' + i + '"><span class="obj-no">' + esc(p.name) + '</span><span class="obj-net">т.' + p.n + ' · отм. ' + fnum(p.H) + '</span></button>').join('') + '</div>';
  const ltabs = [['plan', 'План'], ['table', 'Ведомость']].concat(S.pdf ? [['pdf', 'Проект']] : []);
  if (!ltabs.some(t => t[0] === S.tab)) S.tab = 'plan';
  let desk = '<div class="tabs">' + ltabs.map(t => '<button class="tab' + (S.tab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>').join('')
    + '<div class="zoombar"><button class="btn small" id="zout">−</button><button class="btn small" id="zin">+</button><button class="btn small" id="zfit">Целиком</button></div></div>'
    + (S.tab === 'pdf' ? pdfDesk() : '<div class="desk-scroll" id="vp"><svg id="svg" class="draw" xmlns="http://www.w3.org/2000/svg"><g fill="none">' + I.toSVG(r.D) + '</g></svg></div><p class="desk-hint">колёсико — приближение · тащить — сдвиг · двойной щелчок — ближе · 0 — целиком</p>');
  const P = S.proj.poles || [];
  let card = '<div class="card-head"><h2>Построение</h2></div><p class="fine">' + esc(m.net.name) + ': план с опорами, трубами и футлярами, ведомость участков. Профиль для сетей без колодцев пока не строится.</p>'
    + '<label class="chk"><input type="checkbox" id="nums"' + (S.set.nums !== false ? ' checked' : '') + '> Номера точек</label>'
    + '<label class="chk"><input type="checkbox" id="dims"' + (S.set.dims !== false ? ' checked' : '') + '> Промеры между точками (1 знак)</label>'
    + '<label class="chk"><input type="checkbox" id="marks"' + (S.set.marks ? ' checked' : '') + '> Отметки труб на плане</label>'
    + '<div class="row"><button class="btn primary" id="dxf">Скачать ИЧ (DXF)</button><button class="btn" id="csvl">Ведомость (CSV)</button></div>'
    + '<h3>Имена опор</h3><p class="hint">По умолчанию оп.1, оп.2… в порядке номеров точек. Впишите имена из проекта или вставьте столбец из Excel (Ctrl+V).</p>'
    + '<div class="row"><button class="btn small" id="fill">' + (P.length ? 'Обновить список' : 'Заполнить по съёмке') + '</button><button class="btn small danger" id="pclear"' + (P.length ? '' : ' disabled') + '>Очистить</button></div>'
    + (P.length ? '<table class="ptab"><thead><tr><th>№</th><th>Точка</th><th>Имя опоры</th></tr></thead><tbody>' + m.poles.map((p, i) => '<tr><td class="rn">' + (i + 1) + '</td><td class="rn">т.' + p.n + '</td><td><input data-t="pole" data-r="' + i + '" value="' + esc(P[i] || '') + '"></td></tr>').join('') + '</tbody></table>' : '') + objForm();
  $('#app').innerHTML = topBar() + '<div class="work"><aside class="side">' + side + '</aside><main class="desk">' + desk + '</main><aside class="card">' + card + '</aside></div>';
  bindTop(); bindCommon();
  ['marks', 'dims', 'nums'].forEach(id => { $('#' + id).onchange = e => { S.set[id] = e.target.checked; save(); compute(); render(); }; });
  bindObj();
  $('#csvl').onclick = () => {
    const q = v => { v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [['Сеть', m.net.name], ['№', 'От', 'До', 'Труба', 'Длина, м', 'в т.ч. футляр, м', 'Футляр', 'Точки']].concat(m.secs.map((x, i) => [i + 1, x.from, x.to, x.pipeT.join(', '), fnum(x.len), x.casLen ? fnum(x.casLen) : '', x.casT.join(', '), x.pts.map(p => p.n).join(' ')]), [[]], [['Итого по составу']], Object.keys(m.tot).sort().map(k => [k, fnum(m.tot[k])]));
    download(new TextEncoder().encode('\ufeff' + lines.map(l => l.map(q).join(';')).join('\r\n')), baseName() + ' — ведомость.csv', 'text/csv');
  };
  $('#fill').onclick = fillRows;
  $('#pclear').onclick = () => { if (!confirmClear()) return; S.proj.poles = []; save(); compute(); render(); };
  document.querySelectorAll('[data-pole]').forEach(b => b.onclick = () => { const p = m.poles[+b.dataset.pole]; S.tab = 'plan'; render(); S.view = [p.x - 12, -p.y - 8, 24, 16]; applyView(); });
  document.querySelectorAll('.ptab input[data-t=pole]').forEach(inp => {
    inp.oninput = () => { S.proj.poles[+inp.dataset.r] = inp.value.trim(); later(); };
    inp.onpaste = e => { const txt = (e.clipboardData || window.clipboardData).getData('text'); if (!/\n/.test(txt.trim())) return; e.preventDefault();
      txt.replace(/\r/g, '').replace(/\n$/, '').split('\n').forEach((v, i) => { const r = +inp.dataset.r + i; if (r < m.poles.length) S.proj.poles[r] = v.split('\t')[0].trim(); }); save(); compute(); render(); toast('Вставлено из буфера.'); };
  });
  bindView();
}
// ---------- ГНБ ----------
function gnbField(id, lab, ph, wide) {
  const v = S.gnb[id] == null ? '' : String(S.gnb[id]);
  if (wide) return '<label class="fld">' + lab + '<textarea data-g="' + id + '" rows="' + wide + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>' + esc(v) + '</textarea></label>';
  return '<label class="fld">' + lab + '<input data-g="' + id + '" value="' + esc(v) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '></label>';
}
const gchk = (id, lab) => '<label class="chk"><input type="checkbox" data-g="' + id + '"' + (S.gnb[id] === true || (id === 'marks' && S.gnb[id] !== false) ? ' checked' : '') + '> ' + lab + '</label>';
function renderGnb() {
  const r = S.res, m = r.m, g = S.gnb, f2 = v => fnum(v, 2);
  let side = '<h2>Съёмка</h2><ul class="files"><li class="gen">' + esc(S.file) + '</li><li>точек перехода: ' + m.pts.length + ' (т.' + m.pts[0].n + ' → т.' + m.pts[m.pts.length - 1].n + ')</li>'
    + '<li>L в плане — <b>' + f2(m.Lplan) + ' м</b>, по профилю — <b>' + f2(m.Lprof) + ' м</b></li><li>глубина трубы ' + f2(m.minDepth) + '…' + f2(m.maxDepth) + ' м</li><li>штанг ' + (num(g.rod) || 3.05) + ' м: ' + r.rods.length + '</li></ul>' + netsBlock();
  if (m.chains.length > 1) side += '<h3 class="sh">Переходы в съёмке</h3><div class="nets">' + m.chains.map((c, i) => '<button class="net' + (i === m.ci ? ' on' : '') + '" data-chain="' + i + '"><b>т.' + c[0].n + '…т.' + c[c.length - 1].n + '</b><span>' + c.length + ' точек</span></button>').join('') + '</div>';
  side = geoBlock() + side + projBlock();
  side += '<h3 class="sh">Точки</h3><table class="sum" style="font-size:11.5px;width:100%;table-layout:fixed"><tr><th>№</th><th>т.</th><th>верх</th><th>земля</th><th>глуб.</th></tr>' + m.pts.map(p => '<tr><td>' + p.k + '</td><td>' + p.n + '</td><td>' + f2(p.top) + '</td><td title="' + esc(p.gsrc) + '">' + f2(p.ground) + (p.gsrc !== 'съёмка' ? '*' : '') + '</td><td>' + f2(p.depth) + '</td></tr>').join('') + '</table>'
    + '<p class="fine">* земля у приямка: ' + esc(m.pts[0].gsrc) + ' / ' + esc(m.pts[m.pts.length - 1].gsrc) + '. Верх трубы = земля − глубина локатора + ' + fnum(m.dcorr) + '.</p>';
  if (r.srows.length) side += '<h3 class="sh">Сверка со спецификацией</h3><table class="sum" style="font-size:11.5px"><tr><th></th><th>проект</th><th>ИЧ</th></tr>' + r.srows.map(x => '<tr class="' + (x.ok === false ? 'k-diff' : x.ok ? 'k-ok' : 'k-none') + '" title="' + esc(x.note || '') + '"><td>' + esc(x.el) + '</td><td>' + esc(x.pv) + '</td><td>' + esc(x.fv) + (x.ok === false ? ' ✗' : x.ok ? ' ✓' : '') + '</td></tr>').join('') + '</table>';
  if (r.rows.length) side += '<h3 class="sh">Сверка с проектом</h3><table class="sum"><tr><th></th><th>проект</th><th>факт</th><th>разн.</th></tr>' + r.rows.map(x => '<tr' + (x.bad ? ' class="k-diff"' : '') + '><td>' + esc(x.par) + '</td><td>' + x.pv + '</td><td>' + x.fv + '</td><td>' + x.d + '</td></tr>').join('') + '</table>';
  if (r.warn.length) side += '<h3 class="sh">Замечания</h3><div class="issues">' + r.warn.map(t => '<p class="issue">' + esc(t) + '</p>').join('') + '</div>';
  const tabs = [['all', 'Лист'], ['plan', 'План'], ['profile', 'Профиль'], ['stamp', 'Штамп']].concat(S.pdf ? [['pdf', 'Проект']] : []);
  if (!tabs.some(t => t[0] === S.tab)) S.tab = 'all';
  const desk = '<div class="tabs">' + tabs.map(t => '<button class="tab' + (S.tab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>').join('')
    + '<div class="zoombar"><button class="btn small" id="zout">−</button><button class="btn small" id="zin">+</button><button class="btn small" id="zfit">Целиком</button></div></div>'
    + (S.tab === 'pdf' ? pdfDesk() : '<div class="desk-scroll" id="vp"><svg id="svg" class="draw" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke-width="1" vector-effect="non-scaling-stroke">' + I.toSVG(r.D) + '</g></svg></div><p class="desk-hint">колёсико — приближение · тащить — сдвиг · двойной щелчок — ближе · 0 — целиком</p>');
  const dists = m.pts.map(p => 'т.' + p.k + ' — ' + fnum(p.st, 1)).join(', ');
  const card = '<div class="card-head"><h2>Закрытый переход</h2></div>'
    + '<div class="row"><button class="btn primary" id="dxf">Скачать ИЧ (DXF)</button><button class="btn" id="gcat">Каталог (Excel)</button><button class="btn" id="gprot">Протокол бурения</button></div>'
    + '<div class="two">' + gnbField('no', 'ГНБ №', '6') + gnbField('n', 'Труб, шт') + '</div>'
    + '<div class="two">' + gnbField('d', 'Труба d, мм') + gnbField('dskv', 'Скважина Дскв, мм') + '</div>'
    + '<div class="two">' + gnbField('mat', 'Материал') + gnbField('sdr', 'SDR') + '</div>' + gnbField('gost', 'ГОСТ')
    + gchk('reverse', 'Нумерация с другого конца') + gchk('marks', 'Отметки верха трубы на плане')
    + '<details open><summary>Земля у приямков и глубины</summary><p class="hint">Пусто — берётся ближайшая точка ситуации (7…) в 6 м, если труба под ней не мельче приямка; иначе верх трубы + глубина приямка.</p>'
    + '<div class="two">' + gnbField('groundA', 'Земля у т.1', f2(m.pts[0].ground)) + gnbField('groundB', 'Земля у т.' + m.pts.length, f2(m.pts[m.pts.length - 1].ground)) + '</div>'
    + '<div class="two">' + gnbField('pit', 'Глубина в приямке, м') + gnbField('dcorr', 'Поправка к глубине локатора, м', fnum(m.dcorr)) + '</div></details>'
    + '<details open><summary>Кабели, покрытие, пересечения</summary>'
    + gnbField('cables', 'Кабели в трубах (строка — группа; цвет по -ЭС, -НО, ВОЛС, -ОДН)', '9к ВБвШВ 3x16-ЭС', 4)
    + gnbField('cover', 'Покрытие: «название; до, м от т.1» (последнее — до конца)', 'ПЛИТ; 4.5\nАСФАЛЬТ; 36\nГАЗОН', 3)
    + gnbField('cross', 'Пересечения: «м от т.1; подпись; отметка»', '0.9; Водопровод d400 170,49в.тр.; 170.49', 4)
    + '<p class="fine">Расстояния точек от т.1 по плану: ' + esc(dists) + '. Из Excel можно вставлять столбцы через Tab.</p></details>'
    + '<details open><summary>Проект: спецификация и длины</summary><p class="hint">Строки спецификации (трубы и кабели) — вставьте из таблицы проекта или откройте DXF проекта. Из них берутся материал, SDR и ГОСТ трубы и марки кабелей.</p>'
    + '<label class="fld">Спецификация<textarea id="spec" rows="5" placeholder="Труба ПНД⌀110 SDR13,6, ГОСТ Р МЭК 61386.24&#10;Кабель силовой … ВБбШв 3х16-1, ГОСТ 31996-2012">' + esc(S.spec.text) + '</textarea></label>'
    + '<div class="row"><button class="btn small" id="specapply"' + (r.spec.pipes.length || r.spec.cables.length ? '' : ' disabled') + '>Взять данные из спецификации</button><span class="fine">труб: ' + r.spec.pipes.length + ', кабелей: ' + r.spec.cables.length + '</span></div>'
    + '<div class="two">' + gnbField('projPlan', 'Длина в плане, м', '46.7') + gnbField('projArc', 'Длина по дуге, м', '48.1') + '</div></details>'
    + '<details><summary>Протокол бурения</summary><div class="two">' + gnbField('protDate', 'Дата протокола', '«25» 05  2025г.') + gnbField('rod', 'Длина штанги, м') + '</div>'
    + '<div class="two">' + gnbField('dStart', 'Начало работ', '«23» мая 2025г.') + gnbField('dEnd', 'Окончание работ', '«10» июня 2025г.') + '</div>'
    + '<div class="two">' + gnbField('pilot', 'Пилотная скважина ∅, мм') + gnbField('reams', 'Расширения ∅, мм', '200, 400') + '</div>'
    + '<div class="two">' + gnbField('reamer', 'Расширитель') + gnbField('locator', 'Локационная система') + '</div>' + gnbField('sonde', 'Зонд')
    + '<p class="fine">Протяжка — с расширителем ∅ скважины. Штанги считаются по плану от т.1: уклон — на длине штанги, глубина — до оси трубы на её конце.</p></details>'
    + '<details><summary>Штамп</summary>' + gnbField('org', 'Организация', 'ООО «…»') + gnbField('object', 'Объект', '', 3)
    + '<div class="two">' + gnbField('customer', 'Заказчик') + gnbField('order', 'Заказ (шифр)') + '</div>'
    + '<div class="two">' + gnbField('designer', 'Проектная мастерская') + gnbField('ops', 'Согл. с ОПС №') + '</div>'
    + '<div class="two">' + gnbField('yStart', 'Стр-во начато') + gnbField('yEnd', 'Стр-во закончено') + '</div>' + gnbField('insp', 'Инспекция')
    + '<div class="two">' + gnbField('chiefPost', 'Должность 1') + gnbField('chief', 'Ф.И.О.') + '</div>'
    + '<div class="two">' + gnbField('pmPost', 'Должность 2') + gnbField('pm', 'Ф.И.О.') + '</div>'
    + '<div class="two">' + gnbField('geodPost', 'Должность 3') + gnbField('geod', 'Ф.И.О.') + '</div></details>';
  $('#app').innerHTML = topBar() + '<div class="work"><aside class="side">' + side + '</aside><main class="desk">' + desk + '</main><aside class="card">' + card + '</aside></div>';
  bindTop(); bindCommon(); bindProj();
  document.querySelectorAll('[data-g]').forEach(el => {
    const k = el.dataset.g;
    if (el.type === 'checkbox') el.onchange = () => { S.gnb[k] = el.checked; S.view = null; save(); compute(); render(); };
    else el.oninput = () => { S.gnb[k] = el.value; later(); };
  });
  const sp = $('#spec'); if (sp) sp.oninput = () => { S.spec.text = sp.value; S.spec.src = S.spec.src || 'вставлено вручную'; later(); };
  const sa = $('#specapply'); if (sa) sa.onclick = () => { const ch = I.applySpec(r.spec, S.gnb); save(); compute(); render(); toast(ch.length ? 'Из спецификации: ' + ch.join('; ') : 'ИЧ уже совпадает со спецификацией.'); };
  document.querySelectorAll('[data-chain]').forEach(b => b.onclick = () => { S.gnb.chain = +b.dataset.chain; S.view = null; save(); compute(); render(); });
  const nm = () => baseName() + (g.no ? ' — ГНБ ' + g.no : '');
  $('#gcat').onclick = () => { download(I.catalogGnbXlsx(m), nm() + ' — каталог.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); toast('Каталог: ' + m.pts.length + ' точек.'); };
  $('#gprot').onclick = () => { download(I.protocolXlsx(m, g, r.rods), nm() + ' — протокол бурения.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); toast('Протокол: ' + r.rods.length + ' штанг.'); };
  bindView();
}
function bindCommon() {
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; S.view = null; render(); });
  document.querySelectorAll('[data-net]').forEach(b => b.onclick = () => { S.set.net = b.dataset.net; S.view = null; S.tab = 'plan'; save(); compute(); render(); });
  const d = $('#dxf'); if (d && !S.geo) { d.textContent = 'ИЧ (DXF) — нужна геоподоснова'; d.classList.remove('primary'); }
  if (d) d.onclick = () => { if (!S.res) return; if (!S.geo) { toast('Сначала откройте геоподоснову (DXF МГГТ): ИЧ выдаётся только на ней.'); S.pickFor = 'geo'; pick('.dxf'); return; } download(I.toDXF(S.res.D), baseName() + (S.res.kind === 'gnb' && S.gnb.no ? ' — ГНБ ' + S.gnb.no : '') + ' — ИЧ.dxf', 'application/dxf'); toast('ИЧ сохранена: AutoCAD 2000 DXF.'); };
}
function render() {
  const app = $('#app');
  if (!S.parsed) { app.innerHTML = topBar() + emptyView(); bindTop(); bindEmpty(); return; }
  if (S.res && S.res.kind === 'line') { renderLine(); return; }
  if (S.res && S.res.kind === 'gnb') { renderGnb(); return; }
  const r = S.res, proj = hasProject();
  const fit = S.set.mode === 'fit' && proj;
  let side = geoBlock() + '<h2>Съёмка</h2><ul class="files"><li class="gen">' + esc(S.file) + '</li><li>точек с кодами: ' + S.parsed.pts.length + (S.parsed.skipped.length ? ', без кода или с буквенным номером: ' + S.parsed.skipped.length : '') + '</li>';
  if (r) side += '<li>колодцев по ходу: ' + r.order.length + ', пролётов: ' + r.route.length + '</li><li>длина трассы: ' + fnum(r.order[r.order.length - 1].st) + ' м</li>';
  side += '</ul>' + netsBlock();
  if (r) {
    side += '<h3 class="sh">Колодцы по ходу</h3><div class="objs">' + r.order.map((w, i) => {
      const f = wellFlags(w.name);
      return '<button class="obj" data-well="' + i + '"><span class="obj-no">' + esc(w.name) + '</span><span class="obj-net">' + esc(w.type) + ' · т.' + w.c.n + '</span><span class="obj-meta"><i>об.</i> ' + fnum(w.top) + ' <i>дно</i> ' + (w.bottom != null ? fnum(w.bottom) : '—') + '</span>'
        + (f ? (f.diff ? '<span class="flag" title="расхождений больше допуска">' + f.diff + '</span>' : '<span class="ok" title="сходится с проектом">✓</span>') : '') + '</button>';
    }).join('') + '</div>';
  }
  const issues = (S.err ? ['<b>ИЧ не построена.</b> ' + esc(S.err)] : []).concat(r ? r.warn.map(esc) : []);
  if (issues.length) side += '<h3 class="sh">Замечания</h3><div class="issues">' + issues.map(t => '<p class="issue">' + t + '</p>').join('') + '</div>';
  if (S.parsed.skipped.length) side += '<details class="pts"><summary>Не вошли в расчёт (' + S.parsed.skipped.length + ')</summary><p class="fine">' + S.parsed.skipped.map(esc).join('<br>') + '</p></details>';

  const tabs = [['plan', 'План'], ['profile', 'Профиль'], ['table', 'Ведомость'], ['check', 'Сверка с проектом']].filter(t => t[0] !== 'profile' || S.set.profile).concat(S.pdf ? [['pdf', 'Проект']] : []);
  if (!tabs.some(t => t[0] === S.tab)) S.tab = 'plan';
  let desk = '<div class="tabs">' + tabs.map(t => '<button class="tab' + (S.tab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + (t[0] === 'check' && r && r.rows ? ' <span class="cnt">' + r.rows.filter(x => x.kind === 'diff' || x.kind === 'bad').length + '</span>' : '') + '</button>').join('')
    + (S.tab !== 'check' && S.tab !== 'pdf' ? '<div class="zoombar"><button class="btn small" id="zout" title="Отдалить (−)">−</button><button class="btn small" id="zin" title="Приблизить (+)">+</button><button class="btn small" id="zfit" title="Показать целиком (0)">Целиком</button></div>' : '') + '</div>';
  if (S.tab === 'pdf') desk += pdfDesk();
  else if (S.tab === 'check') desk += '<div class="desk-scroll"><div class="sheet pad">' + checkTable() + '</div></div>';
  else desk += '<div class="desk-scroll" id="vp">' + (r ? '<svg id="svg" class="draw" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke-width="1" vector-effect="non-scaling-stroke">' + I.toSVG(r.D) + '</g></svg>' : '<p class="fine pad">Нечего показать.</p>') + '</div><p class="desk-hint">колёсико — приближение · тащить — сдвиг · двойной щелчок — ближе · 0 — целиком</p>';

  const startOpts = '<option value="auto">автоматически' + (proj ? ' (по проекту)' : '') + '</option>' + (r ? r.ends.map(n => '<option value="' + n + '"' + (String(S.set.start) === String(n) ? ' selected' : '') + '>от колодца т.' + n + '</option>').join('') : '');
  let card = '<div class="card-head"><h2>Построение</h2></div>'
    + '<div class="segs"><span>ИЧ</span><button class="seg' + (!fit ? ' on' : '') + '" data-mode="fact">по факту</button><button class="seg' + (fit ? ' on' : '') + '" data-mode="fit"' + (proj ? '' : ' disabled title="Сначала заполните проект ниже"') + '>под проект</button></div>'
    + '<div class="tolrow' + (fit ? '' : ' off') + '"><label class="fld">Подгонять, если расхождение не больше, см<input id="tol" inputmode="decimal" value="' + esc(String(S.set.tol).replace('.', ',')) + '"' + (fit ? '' : ' disabled') + '></label><div class="chips">' + [5, 10, 30, 60].map(v => '<button class="chip' + (+S.set.tol === v ? ' on' : '') + '" data-tol="' + v + '"' + (fit ? '' : ' disabled') + '>' + v + '</button>').join('') + '</div></div>'
    + '<label class="chk"><input type="checkbox" id="prof"' + (S.set.profile ? ' checked' : '') + '> Строить профиль</label>'
    + '<label class="fld">Начало хода<select id="start">' + startOpts + '</select></label>'
    + '<div class="row"><button class="btn primary" id="dxf"' + (r ? '' : ' disabled') + '>Скачать ИЧ (DXF)</button><button class="btn" id="csv"' + (r && r.rows ? '' : ' disabled title="Нужен проект"') + '>Расхождения (CSV)</button></div>'
    + (r ? '<p class="fine">Режим: ' + esc(r.mode) + '.' + (r.rows ? ' ' + summary(r.rows) : '') + '</p>' : '')
    + '<h3>Проект</h3><p class="hint">Имена, типы и проектные значения колодцев и пролётов. Можно вставить столбцы из Excel: встаньте в ячейку и нажмите Ctrl+V.</p>'
    + '<div class="row"><button class="btn small" id="fill">Заполнить строки по съёмке</button><button class="btn small" id="pload">Открыть проект…</button><button class="btn small" id="psave"' + (proj ? '' : ' disabled') + '>Сохранить проект</button><button class="btn small danger" id="pclear"' + (S.proj.wells.length || S.proj.spans.length ? '' : ' disabled') + '>Очистить</button></div>'
    + (S.proj.wells.length || S.proj.spans.length ? '<div class="ptwrap">' + projTables() + '</div>' : '<p class="fine">Проекта нет — ИЧ строится по съёмке, колодцы называются К-1, К-2…</p>') + objForm();

  app.innerHTML = topBar() + '<div class="work"><aside class="side">' + side + '</aside><main class="desk">' + desk + '</main><aside class="card">' + card + '</aside></div>';
  bindTop(); bindWork();
}
function summary(rows) { const c = k => rows.filter(x => x.kind === k).length; return 'Сверка: совпадает ' + c('ok') + ', принято по проекту ' + c('fit') + ', по факту ' + c('diff') + ', отличий состава ' + c('bad') + '.'; }
function checkTable() {
  const r = S.res;
  if (!r) return '<p class="fine">ИЧ не построена.</p>';
  if (!r.rows) return '<div class="cheat"><p><b>Проекта нет.</b> Справа нажмите «Заполнить строки по съёмке», впишите или вставьте проектные значения — здесь появится сверка: что совпало, что расходится и на сколько.</p><p>Список расхождений строится в обоих режимах — и по факту, и под проект.</p></div>';
  return '<p class="fine">Режим: ' + esc(r.mode) + '. ' + summary(r.rows) + '</p><table class="sum ctab"><thead><tr><th>Элемент</th><th>Параметр</th><th class="num">Проект</th><th class="num">Съёмка</th><th class="num">Разница, м</th><th class="num">На ИЧ</th><th>Примечание</th></tr></thead><tbody>'
    + r.rows.map(x => '<tr class="k-' + x.kind + '"><td>' + esc(x.el) + '</td><td>' + esc(x.par) + '</td><td class="num">' + esc(x.pv) + '</td><td class="num">' + esc(x.fv) + '</td><td class="num">' + esc(x.d) + '</td><td class="num"><b>' + esc(x.used) + '</b></td><td>' + esc(x.note) + '</td></tr>').join('') + '</tbody></table>';
}
function topBar() {
  return '<header class="top"><div class="brand"><span class="mark">ИЧ</span><span class="sep"></span><span class="sub">исполнительный чертёж<br>по съёмке</span></div>'
    + '<div class="top-info">' + (S.file ? esc(S.file) : 'съёмка → план, профиль, ведомость и сверка с проектом') + '</div>'
    + '<div class="top-actions"><button class="btn" id="open">Открыть съёмку…</button><button class="btn' + (S.geo ? ' ghost' : '') + '" id="geotop" title="Геоподоснова МГГТ в DXF — обязательна для ИЧ">' + (S.geo ? 'Геоподоснова ✓' : 'Геоподоснова…') + '</button><button class="btn ghost" id="projtop" title="Проект: PDF для сверки, DXF — для спецификации">Проект…</button><button class="btn ghost" id="demo">Пример</button><button class="btn ghost" id="help">Справка</button></div></header>';
}
// ---------- что нужно для корректной ИЧ: подсказка на старте и в работе ----------
function reqItems() {
  const kind = S.res ? S.res.kind : null, o = S.obj, g = S.gnb, has = v => v != null && String(v).trim() !== '';
  const it = [
    { k: 'need', ok: !!S.parsed, t: 'Съёмка с кодами «Абриса»', d: 'DXF с блоками _block2 (атрибуты №, H, TXT) или .are / .pco. Коды: ТК — 476, 478, 47, 99, 4028; НО / ЭС — 491, 65, 4028 с составом труб (_2d110); ГНБ — 4028, глубина локатора в номере («2-1.36»), приямки без глубины.', act: 'open' },
    { k: 'need', ok: !!S.geo, t: 'Геоподоснова МГГТ (DXF)', d: 'Обязательна: её слои ложатся на ИЧ, без неё DXF не выдаётся. DWG сохраните в AutoCAD как DXF.', act: 'geotop' },
    { k: 'want', ok: !!S.pdf, t: 'Проект в PDF', d: 'Для сверки ИЧ с проектом — лист плана или профиля открывается рядом с чертежом.', act: 'projtop' },
    { k: 'want', ok: !!(S.spec && S.spec.text.trim()), t: 'Спецификация проекта', d: 'Строки с трубами и кабелями (вставить или DXF проекта): из неё берутся материал, SDR, ГОСТ трубы и марки кабелей.', act: 'projtop' }
  ];
  if (!kind || kind === 'line') it.push({ k: 'want', ok: has(o.object) && has(o.ks), t: 'НО / ЭС: объект, КС №, договор, организация', d: 'Для надписей ИЧ и титула каталога координат.' });
  if (!kind || kind === 'wells') it.push({ k: 'want', ok: hasProject(), t: 'ТК: проектные отметки колодцев', d: 'Обечайка, дно, горловина, верх трубы, длины пролётов — для сверки и режима «под проект».' });
  if (!kind || kind === 'gnb') {
    it.push({ k: 'want', ok: has(g.no) && has(g.cables), t: 'ГНБ: номер, трубы, кабели по трубам', d: 'Число и d труб, Дскв, список кабелей; покрытие и пересечения с коммуникациями — для профиля.' });
    it.push({ k: 'want', ok: has(g.dStart) && has(g.dEnd) && has(g.protDate), t: 'ГНБ: данные бурения', d: 'Даты протокола и работ, пилотная скважина и расширения, локатор, зонд.' });
    it.push({ k: 'want', ok: has(g.org) && has(g.object) && has(g.chief), t: 'ГНБ: штамп', d: 'Организация, объект, заказчик, шифр, ОПС, годы, ФИО гл. инженера, руководителя проекта, геодезиста.' });
  }
  return it;
}
function reqList(compact) {
  const it = reqItems(), miss = it.filter(x => x.k === 'need' && !x.ok).length;
  const li = it.map(x => '<li class="req ' + (x.ok ? 'ok' : x.k) + '"><span class="rq-m">' + (x.ok ? '✓' : x.k === 'need' ? '!' : '○') + '</span><div><b>' + esc(x.t) + '</b> <em>' + (x.ok ? 'есть' : x.k === 'need' ? 'обязательно' : 'желательно') + '</em>'
    + (compact && x.ok ? '' : '<p>' + esc(x.d) + '</p>') + (!x.ok && x.act ? '<button class="btn small" data-req="' + x.act + '">Открыть…</button>' : '') + '</div></li>').join('');
  if (compact) return '<details class="reqbox"' + (miss ? ' open' : '') + '><summary>Что нужно для корректной ИЧ' + (miss ? ' — не хватает ' + miss : ' ✓') + '</summary><ul class="reqs">' + li + '</ul></details>';
  return '<div class="reqcol"><h2>Что нужно для корректной ИЧ</h2><ul class="reqs">' + li + '</ul><p class="fine">Файлы обрабатываются в браузере и никуда не отправляются. Данные объекта и проекта сохраняются в браузере.</p></div>';
}
function bindReq() { document.querySelectorAll('[data-req]').forEach(b => b.onclick = () => { const a = b.dataset.req; if (a === 'open') { S.pickFor = null; pick('.dxf,.are,.pco'); } else if (a === 'geotop') { S.pickFor = 'geo'; pick('.dxf'); } else { S.pickFor = 'proj'; pick('.pdf,.dxf'); } }); }
function emptyView() {
  return '<div class="empty"><div class="drop" id="drop"><h1>Перетащите сюда съёмку</h1><p>DXF с блоками точек <b>_block2</b> (из «Абриса» или после расстановки блоков) или полевой файл <b>.are / .pco</b>. Геоподоснову и проект можно перетащить сюда же или открыть кнопками вверху.</p><div class="row"><button class="btn primary" id="open2">Выбрать съёмку…</button><button class="btn" id="demo2">Открыть пример</button></div></div>'
    + reqList(false) + '</div>';
}

// ---------- просмотр: масштаб и сдвиг ----------
function fitView(name) {
  const b = S.res && (S.res.D.box[name] || S.res.D.box.all); if (!b) return;
  const pad = Math.max(b[2] - b[0], b[3] - b[1]) * 0.04 + 2;
  S.view = [b[0] - pad, -b[3] - pad, b[2] - b[0] + 2 * pad, b[3] - b[1] + 2 * pad]; applyView();
}
function applyView() { const s = $('#svg'); if (s && S.view) s.setAttribute('viewBox', S.view.map(v => v.toFixed(3)).join(' ')); }
function zoomAt(f, cx, cy) {
  const s = $('#svg'); if (!s || !S.view) return; const r = s.getBoundingClientRect(), v = S.view;
  const sc = Math.max(v[2] / r.width, v[3] / r.height), ox = v[0] + (v[2] - r.width * sc) / 2, oy = v[1] + (v[3] - r.height * sc) / 2;
  const wx = ox + cx * sc, wy = oy + cy * sc;
  S.view = [wx - (wx - v[0]) / f, wy - (wy - v[1]) / f, v[2] / f, v[3] / f]; applyView();
}
function bindView() {
  const s = $('#svg'); if (!s) return;
  if (!S.view) fitView(S.tab); else applyView();
  s.addEventListener('wheel', e => { e.preventDefault(); const r = s.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  s.addEventListener('dblclick', e => { const r = s.getBoundingClientRect(); zoomAt(2, e.clientX - r.left, e.clientY - r.top); });
  let drag = null;
  s.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; s.setPointerCapture(e.pointerId); s.classList.add('grab'); });
  s.addEventListener('pointermove', e => { if (!drag) return; const r = s.getBoundingClientRect(), v = S.view, sc = Math.max(v[2] / r.width, v[3] / r.height); v[0] -= (e.clientX - drag.x) * sc; v[1] -= (e.clientY - drag.y) * sc; drag = { x: e.clientX, y: e.clientY }; applyView(); });
  const up = () => { drag = null; s.classList.remove('grab'); }; s.addEventListener('pointerup', up); s.addEventListener('pointercancel', up);
  const c = () => { const r = s.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
  $('#zin').onclick = () => zoomAt(1.5, ...c()); $('#zout').onclick = () => zoomAt(1 / 1.5, ...c()); $('#zfit').onclick = () => fitView(S.tab);
}

// ---------- события ----------
function pick(accept) { const p = $('#picker'); p.accept = accept; p.value = ''; p.click(); }
$('#picker').onchange = () => { [...$('#picker').files].forEach(openFile); };
function bindTop() {
  $('#open').onclick = () => { S.pickFor = null; pick('.dxf,.are,.pco'); };
  $('#geotop').onclick = () => { S.pickFor = 'geo'; pick('.dxf'); };
  $('#projtop').onclick = () => { S.pickFor = 'proj'; pick('.pdf,.dxf'); };
  $('#demo').onclick = openDemo; $('#help').onclick = showHelp; bindProj(); bindReq();
}
function bindEmpty() {
  $('#open2').onclick = () => pick('.dxf,.are,.pco'); $('#demo2').onclick = openDemo;
  $('#drop').onclick = e => { if (e.target.id === 'drop' || e.target.tagName === 'H1' || e.target.tagName === 'P') pick('.dxf,.are,.pco'); };
}
function openDemo() {
  const raw = I.demo(); S.file = 'Пример (условные данные).dxf'; S.raw = raw; S.parsed = I.parsePoints(raw); S.set.start = 'auto'; S.set.net = null; S.view = null; S.tab = 'plan';
  if (!hasProject() || S.demoProj) { S.proj = JSON.parse(JSON.stringify(I.DEMO_PROJECT)); S.demoProj = true; }
  compute(); render(); toast('Открыт пример с условными данными и проектом к нему.');
}
let deb; const later = () => { clearTimeout(deb); deb = setTimeout(() => {
  const a = document.activeElement, key = a && a.dataset && a.dataset.g ? ['[data-g="' + a.dataset.g + '"]', 'sel', null, a.selectionStart] : a && a.dataset && a.dataset.obj ? ['[data-obj="' + a.dataset.obj + '"]', 'sel', null, a.selectionStart] : a && a.dataset && a.dataset.t ? [a.dataset.t, a.dataset.r, a.dataset.c, a.selectionStart] : a && a.id ? [a.id, null, null, a.selectionStart] : null;
  save(); compute(); render();
  if (key) { const el = key[1] === 'sel' ? document.querySelector(key[0]) : key[1] == null ? document.getElementById(key[0]) : document.querySelector('.ptab input[data-t="' + key[0] + '"][data-r="' + key[1] + '"][data-c="' + key[2] + '"]'); if (el) { el.focus(); try { el.setSelectionRange(key[3], key[3]); } catch (e) { /* поле без курсора */ } } }
}, 500); };
function bindWork() {
  bindCommon(); bindObj();
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { if (b.disabled) return; S.set.mode = b.dataset.mode; save(); compute(); render(); });
  document.querySelectorAll('[data-tol]').forEach(b => b.onclick = () => { S.set.tol = +b.dataset.tol; save(); compute(); render(); });
  document.querySelectorAll('[data-well]').forEach(b => b.onclick = () => {
    const w = S.res.order[+b.dataset.well]; S.tab = 'plan'; S.view = null; render();
    S.view = [w.c.x - 15, -w.c.y - 10, 30, 20]; applyView();
  });
  const tol = $('#tol'); if (tol) tol.oninput = () => { S.set.tol = num(tol.value) || 0; later(); };
  $('#prof').onchange = e => { S.set.profile = e.target.checked; S.view = null; save(); compute(); render(); };
  $('#start').onchange = e => { S.set.start = e.target.value; save(); compute(); render(); };
  $('#csv').onclick = () => {
    if (!S.res || !S.res.rows) return;
    const q = v => { v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [['Режим построения', S.res.mode], ['Элемент', 'Параметр', 'Проект', 'Съёмка', 'Расхождение, м', 'На ИЧ', 'Примечание']].concat(S.res.rows.map(x => [x.el, x.par, x.pv, x.fv, x.d.replace('−', '-'), x.used, x.note]));
    download(new TextEncoder().encode('﻿' + lines.map(l => l.map(q).join(';')).join('\r\n')), baseName() + ' — расхождения.csv', 'text/csv');
  };
  $('#fill').onclick = fillRows;
  $('#pload').onclick = () => pick('.json');
  $('#psave').onclick = () => { const p = { object: S.proj.object || baseName(), wells: S.proj.wells, spans: S.proj.spans }; download(new TextEncoder().encode(JSON.stringify(p, null, 1)), baseName() + ' — проект.json', 'application/json'); };
  $('#pclear').onclick = () => { if (!confirmClear()) return; S.proj = { object: '', wells: [], spans: [] }; S.set.mode = 'fact'; save(); compute(); render(); };
  document.querySelectorAll('.ptab input').forEach(inp => {
    inp.oninput = () => { S.demoProj = false; setCell(inp.dataset.t, +inp.dataset.r, +inp.dataset.c, inp.value); later(); };
    inp.onpaste = e => {
      const txt = (e.clipboardData || window.clipboardData).getData('text'); if (!/[\t\n]/.test(txt.trim())) return;
      e.preventDefault(); const t = inp.dataset.t, r0 = +inp.dataset.r, c0 = +inp.dataset.c, ncol = t === 'w' ? COLS_W.length : COLS_S.length;
      txt.replace(/\r/g, '').replace(/\n$/, '').split('\n').forEach((line, i) => line.split('\t').forEach((v, j) => { if (c0 + j < ncol) setCell(t, r0 + i, c0 + j, v); }));
      save(); compute(); render(); toast('Вставлено из буфера.');
    };
  });
  bindView();
}
let clearArmed = 0; function confirmClear() { if (Date.now() - clearArmed < 4000) return true; clearArmed = Date.now(); toast('Нажмите «Очистить» ещё раз, чтобы удалить проект.'); return false; }

function showHelp() {
  const v = document.createElement('div'); v.className = 'veil';
  v.innerHTML = '<div class="modal wide"><div class="modal-head"><h2>Справка</h2><button class="btn small" id="hx">Закрыть</button></div><div class="modal-body help">'
    + '<h3>Что делает программа</h3><p>По съёмке строит исполнительный чертёж телефонной канализации: план трассы с колодцами, пролётами и футлярами, профиль с таблицей и ведомость колодцев. Сверяет съёмку с проектом и показывает, что расходится. Всё считается в браузере, файлы никуда не уходят.</p>'
    + '<h3>Какие сети</h3><p>Сеть определяется по кодам «Абриса». Сейчас ИЧ строится для <b>телефонной канализации</b> (план, профиль, ведомость колодцев, сверка с проектом) и для <b>кабеля НО / ЭС</b> (план с опорами, трубами и футлярами, ведомость участков). Для <b>закрытого перехода ГНБ</b> — профиль с таблицей, план с длинами, сечения 1-1 и 2-2 с кабелями, штамп, каталог (№, X, Y, H) и протокол бурения. Остальные сети — кабельная канализация, кабельная линия, водопровод, теплосеть, канализация, газопровод, водосток — распознаются и показываются слева; ИЧ для них добавим по образцам. Если в съёмке несколько сетей, выберите нужную слева.</p>'
    + '<h3>Какая нужна съёмка</h3><p>DXF с блоками точек <b>_block2</b> (атрибуты №, H, TXT) или полевой файл .are / .pco. Коды — по «Абрису»:</p>'
    + '<table class="sum"><tr><th>Код</th><th>Доп. код</th><th>Что это</th></tr><tr><td>476</td><td>_kks-2, _kks-3, _2,99x1,60</td><td>обечайка, центр колодца; тип или размер камеры</td></tr><tr><td>47</td><td>_np / _vp</td><td>низ / верх плиты</td></tr><tr><td>99</td><td></td><td>дно колодца</td></tr><tr><td>478</td><td>_1d110, _24d125</td><td>верх трубы; число и диаметр труб</td></tr><tr><td>4028</td><td>_1d325</td><td>верх футляра; участок — футляр, если оба конца 4028</td></tr><tr><td>4028 / 4028..</td><td>номер «2-1.36»</td><td>ГНБ: земля над трубой и глубина локатора до оси; без глубины — верх трубы в приямке</td></tr></table>'
    + '<p>Связи: <b>..</b> — с предыдущей точкой, <b>..N</b> — с точкой N, <b>..,N</b> — с предыдущей и с N. Трубы должны начинаться и заканчиваться у колодцев (ближе 2 м от обечайки).</p>'
    + '<h3>Проект и подгонка</h3><p>Колодцы проекта сопоставляются со съёмкой по порядку вдоль трассы; направление хода выбирается по лучшему совпадению отметок (или задайте «Начало хода»). В режиме «под проект» значения, отличающиеся не больше допуска, берутся из проекта, остальные — по съёмке. Подгоняются обечайки, дно, горловина, верх трубы на входе и выходе, длины пролётов и футляров. План и промежуточные точки трубы остаются по съёмке.</p>'
    + '<p>Проект сохраняется в браузере автоматически; файлом (.json) его можно перенести на другой компьютер.</p>'
    + '<h3>Что пока не умеет</h3><p>Ответвления трассы, развёртки колодцев, линию земли и пересечения с коммуникациями (нужна геоподоснова), рамку и штамп, чтение проекта прямо из ИД.</p>'
    + '</div></div>';
  document.body.appendChild(v); v.onclick = e => { if (e.target === v || e.target.id === 'hx') v.remove(); };
}

// ---------- перетаскивание файлов ----------
document.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('drag'); });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('drag'); });
document.addEventListener('drop', e => { e.preventDefault(); document.body.classList.remove('drag'); [...e.dataTransfer.files].forEach(openFile); });
document.addEventListener('keydown', e => {
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || !$('#svg')) return;
  const s = $('#svg').getBoundingClientRect();
  if (e.key === '+' || e.key === '=') zoomAt(1.5, s.width / 2, s.height / 2); else if (e.key === '-') zoomAt(1 / 1.5, s.width / 2, s.height / 2); else if (e.key === '0') fitView(S.tab);
});
render();
})();
