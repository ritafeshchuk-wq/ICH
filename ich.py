# -*- coding: utf-8 -*-
"""ИЧ телефонной канализации по съёмочному DXF (блоки _block2).
Прототип: план, профиль с таблицей, ведомость колодцев.
Запуск:  python3 ich.py вход.dxf выход.dxf --template шаблон.dxf [--project проект.json] [--fit СМ] [--profile да|нет]
Подробности — в README.md.
"""
import sys, re, math, argparse, json, csv
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dxf import tags as _tags, sections as _sections, entities as _entities, g as _g, points as _points

TPL = os.environ.get('ICH_TEMPLATE', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'template.dxf'))

# ---------- справочники ----------
WELL_TYPES = {            # доп. код -> (тип, длина, ширина, высота по каталогу)
    'kks-2': ('ККСр-2', 1.35, 1.07, 1.56),
    'kks-3': ('ККС-3', 1.95, 1.16, 1.60),
}
PIPE_MARK = 'Труба ПНД ПЭ 80 SDR 13,6 d=%dмм'
CASING_WALL = {325: 0.007, 273: 0.007, 820: 0.010}   # стенка футляра, м
R_WELL = 2.0          # радиус привязки конца трубы к колодцу, м
KX, KY = 2.0, 10.0    # ед. чертежа на метр: 1:500 по горизонтали, 1:100 по вертикали

L_ROUTE, L_CAS, L_TXT = 'ТК_пркл', 'НС_Футляры', 'Текст связь пр'
L_PROF, L_NET, L_OTM, L_VAL, L_TAB = ('260_НС_НСС_Профиль', '265_НС_НСС_Сеть на профиле',
                                      'Пр.отм.', 'S_NET_PROFILE_TABLE', 'Текст и таблицы')


def fnum(v, n=2):
    v = math.floor(abs(v) * 10 ** n + 0.5 + 1e-7) / 10 ** n * (1 if v >= 0 else -1)   # округление 5 вверх
    return ('%.*f' % (n, v)).replace('.', ',')


# ---------- чтение ----------
def read_dxf(path):
    t = _tags(path); s = _sections(t); E = _entities(t, *s['ENTITIES'])
    pts = []
    for p in _points(E):
        if p['blk'] != '_block2':
            continue
        a = p['att']
        try:
            h = float(a.get('H', '').replace(',', '.'))
        except ValueError:
            continue
        pts.append(dict(num=a.get('№', '').strip(), txt=a.get('TXT', '').strip(), H=h, x=p['x'], y=p['y']))
    return pts


CODE_RE = re.compile(r'^(\d+)(\.\.[\d,]*)?(?:_(.*))?$')


def parse(pts):
    out = []
    for p in pts:
        txt = p['txt'].replace('х', 'x').replace('Х', 'x').replace(' ', '')
        m = CODE_RE.match(txt)
        if not m or not p['num'].isdigit():
            continue                       # обоснование (1000., A1.) и нераспознанное
        p = dict(p, n=int(p['num']), code=m.group(1), link=m.group(2), suf=(m.group(3) or '').lower())
        out.append(p)
    return sorted(out, key=lambda p: p['n'])


def dist(a, b):
    return math.hypot(a['x'] - b['x'], a['y'] - b['y'])


# ---------- модель ----------
def build(P, start=None, names=None):
    by = {p['n']: p for p in P}
    wells = []
    for p in P:
        if p['code'] != '476':
            continue
        w = dict(c=p, top=p['H'], suf=p['suf'])
        near = lambda code: min((q for q in P if q['code'] == code and dist(q, p) < R_WELL),
                                key=lambda q: dist(q, p), default=None)
        q = near('47'); w['plate'] = q['H'] if q and '_vp' not in '_' + q['suf'] else None
        q = near('99'); w['bottom'] = q['H'] if q else None
        if w['suf'] in WELL_TYPES:
            w['type'], w['L'], w['W'], w['Hcat'] = WELL_TYPES[w['suf']]
        else:
            m = re.match(r'(\d+[.,]\d+)x(\d+[.,]\d+)', w['suf'])
            w['type'] = 'камера' if m else (w['suf'] or '?')
            w['L'], w['W'] = (float(m.group(1).replace(',', '.')), float(m.group(2).replace(',', '.'))) if m else (1.35, 1.07)
            w['Hcat'] = None
        wells.append(w)

    pipe = [p for p in P if p['code'] in ('478', '4028')]
    adj = {p['n']: set() for p in pipe}
    for i, p in enumerate(pipe):
        if not p['link']:
            continue
        refs = [int(v) for v in p['link'][2:].split(',') if v]
        if not refs and i:
            refs = [pipe[i - 1]['n']]
        for r in refs:
            if r in adj:
                adj[p['n']].add(r); adj[r].add(p['n'])
    seen, chains = set(), []
    for n in adj:
        if n in seen or len(adj[n]) > 1:
            continue
        ch, prev, cur = [n], None, n
        seen.add(n)
        while True:
            nx = [v for v in adj[cur] if v != prev]
            if not nx:
                break
            prev, cur = cur, nx[0]; ch.append(cur); seen.add(cur)
        chains.append([by[v] for v in ch])

    spans = []
    for ch in chains:
        ends = []
        for e in (ch[0], ch[-1]):
            w = min(wells, key=lambda w: dist(w['c'], e))
            ends.append(w if dist(w['c'], e) < R_WELL else None)
        if None in ends or ends[0] is ends[1]:
            print('! цепочка %s..%s не привязана к двум колодцам — пропущена' % (ch[0]['n'], ch[-1]['n']))
            continue
        spans.append(dict(a=ends[0], b=ends[1], pts=ch))

    # порядок колодцев по ходу
    deg = {id(w): [s for s in spans if s['a'] is w or s['b'] is w] for w in wells}
    if any(len(v) > 2 for v in deg.values()):
        raise SystemExit('Ответвления пока не поддерживаются')
    endw = [w for w in wells if len(deg[id(w)]) == 1]
    cur = next((w for w in endw if start and w['c']['n'] == start), endw[0])
    route, used = [], set()
    while True:
        nxt = [s for s in deg[id(cur)] if id(s) not in used]
        if not nxt:
            break
        s = nxt[0]; used.add(id(s))
        if s['b'] is cur:
            s['a'], s['b'], s['pts'] = s['b'], s['a'], s['pts'][::-1]
        route.append(s); cur = s['b']
    order = [route[0]['a']] + [s['b'] for s in route]
    for i, w in enumerate(order):
        w['name'] = names[i] if names and i < len(names) else 'К-%d' % (i + 1)

    # пикетаж, трубы, футляры
    st = 0.0
    for s in route:
        s['a']['st'] = st
        poly = [s['a']['c']] + s['pts'] + [s['b']['c']]
        for i in range(1, len(poly)):
            st += dist(poly[i - 1], poly[i])
            poly[i] = dict(poly[i], st=st) if i < len(poly) - 1 else poly[i]
        s['pts'] = poly[1:-1]; s['len'] = st - s['a']['st']; s['b']['st'] = st
        m = next((re.match(r'(\d+)[dx](\d+)', p['suf']) for p in s['pts'] if p['code'] == '478' and p['suf']), None)
        s['n'], s['d'] = (int(m.group(1)), int(m.group(2))) if m else (1, 110)
        cas = [p for p in s['pts'] if p['code'] == '4028']
        s['cas'] = None
        if len(cas) >= 2:
            m = re.match(r'(\d+)[dx](\d+)', cas[0]['suf'])
            D = int(m.group(2)) if m else 0
            s['cas'] = dict(pts=cas, D=D, L=cas[-1]['st'] - cas[0]['st'])
            drop = D / 1000. - CASING_WALL.get(D, 0.007) - s['d'] / 1000.     # одна труба лежит на дне футляра
            s['drop'] = drop if s['n'] == 1 else 0.0
        for p in s['pts']:
            p['top'] = p['H'] - (s['drop'] if s['cas'] and p['code'] == '4028' else 0.0)
            p['wall'] = False
        for e, w in ((s['pts'][0], s['a']), (s['pts'][-1], s['b'])):
            e['wall'] = True
    return order, route


# ---------- примитивы ----------
class Dwg:
    def __init__(self):
        self.e = []

    def line(self, layer, x1, y1, x2, y2, color=None, lt=None):
        self.e.append(('LINE', layer, color, lt, (x1, y1, x2, y2)))

    def poly(self, layer, pts, color=None, closed=False, lt=None):
        self.e.append(('POLY', layer, color, lt, (list(pts), closed)))

    def circle(self, layer, x, y, r, color=None):
        self.e.append(('CIRCLE', layer, color, None, (x, y, r)))

    def text(self, layer, s, x, y, h=2.5, ang=0.0, al=1, color=None):
        """al: 0 — влево, 1 — центр, 2 — вправо (по вертикали всегда середина)"""
        self.e.append(('TEXT', layer, color, None, (s, x, y, h, ang, al)))


# ---------- план ----------
def unit(a, b):
    d = math.hypot(b[0] - a[0], b[1] - a[1]) or 1.0
    return (b[0] - a[0]) / d, (b[1] - a[1]) / d


def draw_plan(D, order, route):
    xy = lambda p: (p['x'], p['y'])
    dirs = {}
    for s in route:
        poly = [xy(s['a']['c'])] + [xy(p) for p in s['pts']] + [xy(s['b']['c'])]
        D.poly(L_ROUTE, poly, 7)
        dirs.setdefault(id(s['a']), []).append(unit(poly[1], poly[2]) if len(poly) > 3 else unit(poly[0], poly[-1]))
        dirs.setdefault(id(s['b']), []).append(unit(poly[-3], poly[-2]) if len(poly) > 3 else unit(poly[0], poly[-1]))
        # подпись пролёта: число труб / длина между центрами колодцев
        half, acc = s['len'] / 2, 0.0
        for i in range(1, len(poly)):
            d = math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1])
            if acc + d >= half:
                u = unit(poly[i - 1], poly[i]); k = half - acc
                mx, my = poly[i - 1][0] + u[0] * k, poly[i - 1][1] + u[1] * k
                break
            acc += d
        nx, ny = u[1], -u[0]
        if (abs(u[1]) > abs(u[0]) and nx < 0) or (abs(u[1]) <= abs(u[0]) and ny > 0):
            nx, ny = -nx, -ny                         # подпись пролёта — ниже трассы, у крутых участков — справа
        lx, ly = mx + nx * 4, my + ny * 4
        D.line(L_TXT, mx, my, lx, ly, 7)
        D.line(L_TXT, lx - 2.2, ly, lx + 2.2, ly, 7)
        up = ly >= my
        D.text(L_TXT, '%d' % s['n'], lx, ly + (2.3 if up else -0.8), 1.0, 0, 1, 7)
        D.text(L_TXT, fnum(s['len']), lx, ly + (0.8 if up else -2.3), 1.0, 0, 1, 7)
        if s['cas']:
            c = [xy(p) for p in s['cas']['pts']]; hw = 0.4
            left, right = [], []
            for i, p in enumerate(c):
                u = unit(c[max(i - 1, 0)], c[min(i + 1, len(c) - 1)])
                left.append((p[0] - u[1] * hw, p[1] + u[0] * hw)); right.append((p[0] + u[1] * hw, p[1] - u[0] * hw))
            D.poly(L_CAS, left + right[::-1], 5, closed=True)
            m = c[len(c) // 2]; u = unit(c[0], c[-1]); n = (-u[1], u[0]) if u[0] > 0 else (u[1], -u[0])
            lx, ly = m[0] + n[0] * 5, m[1] + n[1] * 5     # подпись футляра — выше трассы
            D.line(L_TXT, m[0], m[1], lx, ly, 5)
            D.text(L_TXT, 'ф-р d=%d мм, L=%s' % (s['cas']['D'], fnum(s['cas']['L'])), lx, ly + 0.9, 1.0, 0, 1, 5)
    for w in order:
        dd = dirs[id(w)]; ux, uy = sum(d[0] for d in dd), sum(d[1] for d in dd)
        u = unit((0, 0), (ux, uy)) if abs(ux) + abs(uy) > 1e-6 else dd[0]
        n = (-u[1], u[0]); cx, cy = xy(w['c']); a, b = w['L'] / 2, w['W'] / 2
        D.poly(L_ROUTE, [(cx + u[0] * i * a + n[0] * j * b, cy + u[1] * i * a + n[1] * j * b)
                         for i, j in ((-1, -1), (1, -1), (1, 1), (-1, 1))], 7, closed=True)
        for r in (0.45, 0.35):
            D.circle(L_ROUTE, cx, cy, r, 7)
        if n[1] < 0:
            n = (-n[0], -n[1])                        # подпись колодца — выше трассы
        lx, ly = cx + n[0] * 7, cy + n[1] * 7
        D.line(L_TXT, cx, cy, lx, ly, 7)
        D.line(L_TXT, lx - 3.5, ly, lx + 3.5, ly, 7)
        D.text(L_TXT, w['name'], lx, ly + 2.3, 1.0, 0, 1, 7)
        D.text(L_TXT, w['type'], lx, ly + 0.8, 1.0, 0, 1, 7)


# ---------- профиль ----------
ROWS = [('Отметки обечаек колодцев', 15), ('Отметки верха трубопровода', 15), ('Отметки дна колодцев', 15),
        ('Покрытие', 10), ('Сечение блока кабельной|канализации', 10), ('Обозначение трубы, материал,|диаметр', 10),
        ('Расстояние', 10), ('План трассы', 20)]


def draw_profile(D, order, route, X0, YB):
    hs = [w['top'] for w in order] + [w['bottom'] for w in order if w['bottom'] is not None] + \
         [p['top'] - s['d'] / 1000. for s in route for p in s['pts']]
    H0 = math.floor(min(hs) - 1.0); H1 = math.ceil(max(hs) + 1.0)
    X = lambda st: X0 + st * KX
    Y = lambda h: YB + (h - H0) * KY
    Ltot = order[-1]['st']; xl, xh, xr = X0 - 75, X0 - 15, X(Ltot) + 15

    # шкала отметок
    D.line(L_PROF, xh, YB, xh, Y(H1), 7)
    for h in range(H0, H1 + 1):
        D.line(L_PROF, xh - 2, Y(h), xh, Y(h), 7)
        D.text(L_PROF, fnum(h), xh - 3, Y(h), 2.5, 0, 2, 7)
    D.text(L_PROF, 'М 1:500 по горизонтали', xl, Y(H0) + 12, 2.5, 0, 0, 7)
    D.text(L_PROF, 'М 1:100 по вертикали', xl, Y(H0) + 7, 2.5, 0, 0, 7)

    # таблица
    ys = [YB]
    for _, h in ROWS:
        ys.append(ys[-1] - h)
    for y in ys:
        D.line(L_PROF, xl, y, xr, y, 7)
    for x in (xl, xh, xr):
        D.line(L_PROF, x, ys[0], x, ys[-1], 7)
    for i, (name, h) in enumerate(ROWS):
        parts = name.split('|'); ym = (ys[i] + ys[i + 1]) / 2
        for k, part in enumerate(parts):
            D.text(L_PROF, part, xl + 2, ym + (len(parts) - 1) * 2 - k * 4, 2.5, 0, 0, 7)
    mid = lambda i: (ys[i] + ys[i + 1]) / 2

    # колонки: колодцы и точки перелома трубы
    cols = []
    for i, w in enumerate(order):
        cols.append(('w', w['st'], w))
        if i < len(route):
            cols += [('p', p['st'], p) for p in route[i]['pts'] if not p['wall']]
    for kind, st, o in cols:
        x = X(st)
        ytop = Y(o['top']) if kind == 'w' else Y(o['top'])
        D.line(L_OTM, x, ytop, x, YB, 30 if kind == 'w' else 8)
        D.line(L_PROF, x, ys[0], x, ys[3], 7)
        D.line(L_PROF, x, ys[6], x, ys[7], 7)
        if kind == 'p':
            i = cols.index((kind, st, o))
            tight = (st - cols[i - 1][1]) * KX < 7 and (cols[i + 1][1] - st) * KX >= 7
            D.text(L_VAL, fnum(o['top']), x + 1.9 if tight else x - 1.6, mid(1), 2.5, 90, 1, 7)
    for a, b in zip(cols, cols[1:]):
        w = (b[1] - a[1]) * KX
        D.text(L_VAL, fnum(b[1] - a[1]), (X(a[1]) + X(b[1])) / 2, mid(6), 2.0, 90 if w < 8 else 0, 1, 7)

    # колодцы
    for i, w in enumerate(order):
        x = X(w['st']); a = w['L'] / 2 * KX
        bot = w['bottom'] if w['bottom'] is not None else w['top'] - 2.0
        plate = w['plate'] if w['plate'] is not None else w['top'] - 0.4
        D.poly(L_NET, [(x - a, Y(bot)), (x + a, Y(bot)), (x + a, Y(plate)), (x - a, Y(plate))], 7, closed=True)
        D.poly(L_NET, [(x - 0.7, Y(plate)), (x - 0.7, Y(w['top'])), (x + 0.7, Y(w['top'])), (x + 0.7, Y(plate))], 7)
        D.text(L_NET, w['name'], x, Y(w['top']) + 9, 2.5, 0, 1, 7)
        D.text(L_NET, w['type'], x, Y(w['top']) + 5, 2.5, 0, 1, 7)
        D.text(L_VAL, fnum(w['top']), x - 1.6, mid(0), 2.5, 90, 1, 7)
        if w['bottom'] is not None:
            D.text(L_VAL, fnum(w['bottom']), x - 1.6, mid(2), 2.5, 90, 1, 7)
        if i > 0:                                   # труба, пришедшая в колодец
            D.text(L_VAL, fnum(route[i - 1]['pts'][-1]['top']), x - 1.6, mid(1), 2.5, 90, 1, 7)
        if i < len(route):                          # труба, уходящая из колодца
            D.text(L_VAL, fnum(route[i]['pts'][0]['top']), x + 1.9, mid(1), 2.5, 90, 1, 7)
        for r in (ys[7], ys[8]):
            pass
        D.line(L_PROF, x, ys[3], x, ys[6], 7) if i in (0, len(order) - 1) else None
        D.circle(L_PROF, x, mid(7) - 3, 1.2, 7)
        D.text(L_PROF, w['name'], x, mid(7) + 4, 2.0, 0, 1, 7)

    # трубы и футляры
    for s in route:
        d = s['d'] / 1000.
        D.poly(L_OTM, [(X(p['st']), Y(p['top'])) for p in s['pts']], 3)
        D.poly(L_OTM, [(X(p['st']), Y(p['top'] - d)) for p in s['pts']], 3)
        if s['cas']:
            c = s['cas']; Dm = c['D'] / 1000.
            D.poly(L_CAS, [(X(p['st']), Y(p['H'])) for p in c['pts']] +
                   [(X(p['st']), Y(p['H'] - Dm)) for p in c['pts'][::-1]], 5, closed=True)
            xm = (X(c['pts'][0]['st']) + X(c['pts'][-1]['st'])) / 2; ym = Y(max(p['H'] for p in c['pts']))
            D.text(L_CAS, 'Ст. футляр D%d, L=%s м' % (c['D'], fnum(c['L'])), xm, ym + 4, 2.5, 0, 1, 5)
        xa, xb = X(s['a']['st']), X(s['b']['st'])
        D.line(L_PROF, xa, mid(7) - 3, xb, mid(7) - 3, 7)
        D.text(L_PROF, '%d / %s' % (s['n'], fnum(s['len'])), (xa + xb) / 2, mid(7) - 7, 2.0, 0, 1, 7)
        if s['cas']:
            D.poly(L_CAS, [(X(s['cas']['pts'][0]['st']), mid(7) - 4), (X(s['cas']['pts'][-1]['st']), mid(7) - 4),
                           (X(s['cas']['pts'][-1]['st']), mid(7) - 2), (X(s['cas']['pts'][0]['st']), mid(7) - 2)], 5, closed=True)

    # строки «Сечение блока» и «Обозначение трубы»: объединяем соседние одинаковые пролёты
    groups = []
    for s in route:
        key = (s['n'], s['d'])
        if groups and groups[-1][0] == key:
            groups[-1][2] = s['b']['st']
        else:
            groups.append([key, s['a']['st'], s['b']['st']])
    for (n, d), a, b in groups:
        xm = (X(a) + X(b)) / 2
        D.line(L_PROF, X(b), ys[4], X(b), ys[6], 7)
        D.text(L_VAL, '%d x d%d' % (n, d), xm, mid(4), 2.5, 0, 1, 7)
        D.text(L_VAL, PIPE_MARK % d, xm, mid(5), 2.5, 0, 1, 7)
    return xl, ys[-1], xr, Y(H1) + 12


# ---------- ведомость колодцев ----------
def draw_wells_table(D, order, x0, y0):
    heads = ['№', 'Колодец', 'Тип', 'Длина', 'Ширина', 'Обечайка', 'Низ плиты', 'Дно', 'Высота', 'Нг.', 'Глубина']
    wd = [8, 30, 22, 16, 16, 22, 22, 22, 18, 16, 18]; rh = 8
    D.text(L_TAB, 'Ведомость колодцев (длина и ширина — по типу колодца)', x0, y0 + 5, 3.0, 0, 0, 7)
    rows = [heads]
    for i, w in enumerate(order):
        f = lambda v: fnum(v) if v is not None else '—'
        dif = lambda a, b: fnum(a - b) if a is not None and b is not None else '—'
        rows.append(['%d' % (i + 1), w['name'], w['type'], fnum(w['L']), fnum(w['W']), f(w['top']), f(w['plate']),
                     f(w['bottom']), dif(w['plate'], w['bottom']), dif(w['top'], w['plate']), dif(w['top'], w['bottom'])])
    xs = [x0]
    for v in wd:
        xs.append(xs[-1] + v)
    for r in range(len(rows) + 1):
        D.line(L_TAB, xs[0], y0 - r * rh, xs[-1], y0 - r * rh, 7)
    for x in xs:
        D.line(L_TAB, x, y0, x, y0 - len(rows) * rh, 7)
    for r, row in enumerate(rows):
        for c, v in enumerate(row):
            D.text(L_TAB, v, (xs[c] + xs[c + 1]) / 2, y0 - r * rh - rh / 2, 2.5, 0, 1, 7)



# ---------- сверка с проектом ----------
def r2(v):
    return math.floor(abs(v) * 100 + 0.5 + 1e-7) / 100 * (1 if v >= 0 else -1)


def compare(order, route, proj, tol):
    """Сверяет съёмку с проектом. tol=None — ИЧ по факту; иначе значения с расхождением
    не больше tol (м) принимаются по проекту. Возвращает строки отчёта."""
    rows = []

    def num(el, par, pv, fv):
        if pv is None or fv is None:
            rows.append([el, par, fnum(pv) if pv is not None else '—', fnum(fv) if fv is not None else '—', '', 
                         fnum(fv) if fv is not None else '—', 'нет в проекте' if pv is None else 'нет в съёмке'])
            return fv
        fv = r2(fv); d = r2(fv - pv)
        if abs(d) < 0.005:
            used, note = fv, 'совпадает'
        elif tol is not None and abs(d) <= tol + 1e-9:
            used, note = pv, 'принято по проекту'
        else:
            used, note = fv, 'по факту' + (', больше допуска' if tol is not None else '')
        rows.append([el, par, fnum(pv), fnum(fv), ('%+.2f' % d).replace('.', ','), fnum(used), note])
        return used

    def txt(el, par, pv, fv):
        rows.append([el, par, str(pv), str(fv), '', str(fv), 'совпадает' if str(pv) == str(fv) else 'ОТЛИЧАЕТСЯ, на ИЧ по факту'])

    PW, PS = proj['wells'], proj['spans']
    if len(PW) != len(order):
        rows.append(['Трасса', 'Число колодцев', len(PW), len(order), '', len(order), 'ОТЛИЧАЕТСЯ — сверка по порядку, проверить вручную'])
    for i, (w, pw) in enumerate(zip(order, PW)):
        el = pw['name']
        txt(el, 'Тип колодца', pw['type'], w['type'])
        f_in = route[i - 1]['pts'][-1] if i > 0 else None
        f_out = route[i]['pts'][0] if i < len(route) else None
        f_neck = w['top'] - w['plate'] if w['plate'] is not None else None
        top = num(el, 'Обечайка', pw.get('top'), w['top'])
        bot = num(el, 'Дно', pw.get('bottom'), w['bottom'])
        neck = num(el, 'Горловина (Нг.)', pw.get('neck'), f_neck)
        if pw.get('top') is not None and pw.get('bottom') is not None and w['bottom'] is not None:
            rows.append([el, 'Глубина (обечайка − дно)', fnum(pw['top'] - pw['bottom']), fnum(r2(w['top']) - r2(w['bottom'])),
                         ('%+.2f' % (r2(w['top']) - r2(w['bottom']) - (pw['top'] - pw['bottom']))).replace('.', ','), fnum(top - bot), 'производная'])
        if f_in is not None:
            f_in['top'] = num(el, 'Верх трубы, вход', pw.get('pipe_in'), f_in['top'])
        if f_out is not None:
            f_out['top'] = num(el, 'Верх трубы, выход', pw.get('pipe_out'), f_out['top'])
        w['top'], w['bottom'] = top, bot
        w['plate'] = top - neck if neck is not None else None
    lens = []
    for s, ps in zip(route, PS):
        el = '%s – %s' % (s['a']['name'], s['b']['name'])
        txt(el, 'Трубы', '%d×d%d' % (ps['n'], ps['d']), '%d×d%d' % (s['n'], s['d']))
        lens.append(num(el, 'Длина пролёта', ps.get('len'), s['len']))
        pc, fc = ps.get('casing'), s['cas']
        if pc or fc:
            txt(el, 'Футляр', 'd%d' % pc['D'] if pc else 'нет', 'd%d' % fc['D'] if fc else 'нет')
            if pc and fc:
                fc['L'] = num(el, 'Длина футляра', pc.get('L'), fc['L'])
    f_tot = sum(r2(s['len']) for s in route)
    rows.append(['Трасса', 'Общая длина', fnum(sum(p['len'] for p in PS)), fnum(f_tot),
                 ('%+.2f' % (f_tot - sum(p['len'] for p in PS))).replace('.', ','), fnum(sum(lens) + sum(r2(s['len']) for s in route[len(lens):])), 'производная'])
    # пикетаж по принятым длинам
    cur = 0.0
    for s, used in zip(route, lens + [s['len'] for s in route[len(lens):]]):
        f = used / s['len']; a0 = s['a']['st']
        for p in s['pts']:
            p['st'] = cur + (p['st'] - a0) * f
        s['a']['st'] = cur; cur += used; s['len'] = used
    route[-1]['b']['st'] = cur
    return rows


def write_report(rows, path, mode):
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f, delimiter=';')
        w.writerow(['Режим построения', mode])
        w.writerow(['Элемент', 'Параметр', 'Проект', 'Съёмка', 'Расхождение, м', 'На ИЧ', 'Примечание'])
        w.writerows(rows)


# ---------- запись DXF (на шаблоне) ----------
def write(D, OUT):
    raw = open(TPL, 'rb').read().decode('utf-8')
    NL = '\r\n' if '\r\n' in raw else '\n'
    L = raw.split(NL)
    t2 = _tags(TPL); s2 = _sections(t2); E2 = _entities(t2, *s2['ENTITIES'])
    setv = lambda k, v: L.__setitem__(2 * k + 1, v)
    hs_k = [i + 1 for i in range(len(t2)) if t2[i] == (9, '$HANDSEED')][0]; st = {'seed': int(t2[hs_k][1], 16)}

    def H():
        h = '%X' % st['seed']; st['seed'] += 1; return h
    f3 = lambda v: '%.3f' % v
    delete, delh = set(), set()
    for i, e in enumerate(E2):
        if _g(e, 330) == '17' or (e['type'] in ('ATTRIB', 'SEQEND') and i - 1 in delete):
            delete.add(i); delh.add(_g(e, 5))
    delpairs = set()
    for i in delete:
        a = E2[i]['idx']; delpairs.update(range(a, a + 1 + len(E2[i]['tags'])))
    for sec in ('TABLES', 'OBJECTS'):
        a_, b_ = s2[sec]; k = a_
        while k < b_:
            if t2[k][0] == 331 and t2[k][1] in delh:
                delpairs.add(k)
                if t2[k + 1][0] == 5 and sec == 'OBJECTS':
                    delpairs.add(k + 1)          # пара SORTENTSTABLE
            elif t2[k][0] == 330 and t2[k][1] in delh:
                delpairs.add(k)
            k += 1
    new = []
    for typ, layer, color, lt, d in D.e:
        tg = ['  0', {'POLY': 'LWPOLYLINE'}.get(typ, typ), '  5', H(), '330', '17', '100', 'AcDbEntity', '  8', layer]
        if lt:
            tg += ['  6', lt]
        if color is not None:
            tg += [' 62', '%6d' % color]
        if lt:
            tg += [' 48', '1.0']
        if typ == 'LINE':
            tg += ['100', 'AcDbLine', ' 10', f3(d[0]), ' 20', f3(d[1]), ' 30', '0.0', ' 11', f3(d[2]), ' 21', f3(d[3]), ' 31', '0.0']
        elif typ == 'POLY':
            pts, closed = d
            tg += ['100', 'AcDbPolyline', ' 90', '%9d' % len(pts), ' 70', '     1' if closed else '     0', ' 43', '0.0']
            for x, y in pts:
                tg += [' 10', f3(x), ' 20', f3(y)]
        elif typ == 'CIRCLE':
            tg += ['100', 'AcDbCircle', ' 10', f3(d[0]), ' 20', f3(d[1]), ' 30', '0.0', ' 40', f3(d[2])]
        elif typ == 'TEXT':
            s, x, y, h, ang, al = d
            tg += ['100', 'AcDbText', ' 10', f3(x), ' 20', f3(y), ' 30', '0.0', ' 40', f3(h), '  1', s, ' 50', '%.3f' % ang,
                   ' 72', '%6d' % al, ' 11', f3(x), ' 21', f3(y), ' 31', '0.0', '100', 'AcDbText', ' 73', '     2']
        new += tg
    TB = _entities(t2, *s2['TABLES']); existing = {_g(e, 2) for e in TB if e['type'] == 'LAYER'}
    ref = next(e for e in TB if e['type'] == 'LAYER' and _g(e, 2) != '0')
    needed = sorted({e[1] for e in D.e} - existing); lay = []
    for nm in needed:
        lay += ['  0', 'LAYER', '  5', H(), '330', _g(ref, 330), '100', 'AcDbSymbolTableRecord', '100', 'AcDbLayerTableRecord',
                '  2', nm, ' 70', '     0', ' 62', '     7', '  6', 'Continuous', '370', '    -3', '390', _g(ref, 390),
                '347', _g(ref, 347), '348', '0']
    inl = False
    for kk in range(*s2['TABLES']):
        if t2[kk] == (0, 'TABLE') and t2[kk + 1] == (2, 'LAYER'):
            inl = True; lt_ = kk
        if inl and t2[kk] == (0, 'ENDTAB'):
            le = kk; break
    for kk in range(lt_, lt_ + 12):
        if t2[kk][0] == 70:
            setv(kk, '%6d' % (int(t2[kk][1]) + len(needed))); break
    xs, ys = [], []
    for typ, _, _, _, d in D.e:
        if typ == 'LINE':
            xs += [d[0], d[2]]; ys += [d[1], d[3]]
        elif typ == 'POLY':
            xs += [p[0] for p in d[0]]; ys += [p[1] for p in d[0]]
    for kk in range(*s2['HEADER']):
        if t2[kk] == (9, '$EXTMIN'):
            setv(kk + 1, f3(min(xs) - 5)); setv(kk + 2, f3(min(ys) - 5))
        if t2[kk] == (9, '$EXTMAX'):
            setv(kk + 1, f3(max(xs) + 5)); setv(kk + 2, f3(max(ys) + 5))
    setv(hs_k, '%X' % st['seed'])
    out = []
    for kk in range(len(t2)):
        if kk == le:
            out += lay
        if kk == s2['ENTITIES'][1]:
            out += new
        if kk not in delpairs:
            out += [L[2 * kk], L[2 * kk + 1]]
    out += L[2 * len(t2):]
    open(OUT, 'wb').write(NL.join(out).encode('utf-8'))


def ask_fit():
    """Спрашивает, подгонять ли под проект и с каким допуском. Возвращает допуск в метрах или None."""
    if not sys.stdin.isatty():
        return None
    if input('Подправить ИЧ под проект? [д/н]: ').strip().lower() not in ('д', 'да', 'y', 'yes'):
        return None
    while True:
        try:
            return float(input('До какого расхождения подгонять, см (например 10 или 60): ').replace(',', '.')) / 100.
        except ValueError:
            print('Нужно число в сантиметрах')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src', help='съёмка: DXF с блоками _block2')
    ap.add_argument('out', help='куда записать ИЧ (DXF)')
    ap.add_argument('--template', help='DXF-шаблон (AutoCAD 2018, текстовый): слои, стили; по умолчанию template.dxf рядом с программой или $ICH_TEMPLATE')
    ap.add_argument('--project', help='проектные данные (json)')
    ap.add_argument('--fit', help='допуск подгонки под проект, см; 0 или "нет" — строить по факту; не задан — спросить')
    ap.add_argument('--profile', choices=['да', 'нет'], help='строить профиль; не задан — спросить (без вопроса — строить)')
    ap.add_argument('--start', type=int); ap.add_argument('--names')
    a = ap.parse_args()
    global TPL
    if a.template:
        TPL = a.template
    if not os.path.exists(TPL):
        raise SystemExit('Не найден шаблон DXF: %s (укажите --template)' % TPL)
    P = parse(read_dxf(a.src))
    proj = json.load(open(a.project, encoding='utf-8')) if a.project else None
    names = [w['name'] for w in proj['wells']] if proj else (a.names.split(',') if a.names else None)
    order, route = build(P, a.start, names)
    if proj and not a.start and len(order) == len(proj['wells']):       # направление хода — по лучшему совпадению с проектом
        sc = lambda seq: sum(abs(w['top'] - pw['top']) for w, pw in zip(seq, proj['wells']))
        if sc(order[::-1]) < sc(order):
            order, route = build(parse(read_dxf(a.src)), order[-1]['c']['n'], names)
    tol, mode, rows = None, 'по фактической съёмке', None
    if proj:
        if a.fit is None:
            tol = ask_fit()
        elif a.fit.lower() not in ('0', 'нет', 'no'):
            tol = float(a.fit.replace(',', '.')) / 100.
        if tol is not None:
            mode = 'подогнано под проект, допуск %g см' % (tol * 100)
        rows = compare(order, route, proj, tol)
        rep = re.sub(r'\.dxf$', '', a.out, flags=re.I) + ' — расхождения.csv'
        write_report(rows, rep, mode)
    if a.profile is None:
        prof = not sys.stdin.isatty() or input('Строить профиль? [д/н]: ').strip().lower() in ('д', 'да', 'y', 'yes', '')
    else:
        prof = a.profile == 'да'
    D = Dwg()
    draw_plan(D, order, route)
    xs = [p['x'] for p in P]; ys = [p['y'] for p in P]
    if prof:
        H1 = math.ceil(max(w['top'] for w in order) + 1); H0 = math.floor(min(w['bottom'] or w['top'] - 2 for w in order) - 1)
        YB = min(ys) - 40 - (H1 - H0) * KY
        xl, yb, xr, yt = draw_profile(D, order, route, min(xs) + 75, YB)
    else:
        xl, yb = min(xs), min(ys) - 20                  # без профиля: ведомость сразу под планом
    mode += ', с профилем' if prof else ', без профиля'
    draw_wells_table(D, order, xl, yb - 20)
    D.text(L_TAB, 'ИЧ построена: ' + mode, xl, yb - 8, 3.0, 0, 0, 1 if tol is not None else 7)
    write(D, a.out)
    print('Режим: %s. Колодцев: %d, пролётов: %d, длина трассы: %s' % (mode, len(order), len(route), fnum(order[-1]['st'])))
    if rows:
        c = lambda k: sum(1 for r in rows if r[6].startswith(k))
        print('Сверка: совпадает %d, принято по проекту %d, по факту %d, отличий состава %d' % (c('совпадает'), c('принято'), c('по факту'), c('ОТЛИЧАЕТСЯ')))
    return D, order, route


if __name__ == '__main__':
    main()
