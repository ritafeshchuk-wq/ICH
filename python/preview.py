# -*- coding: utf-8 -*-
"""Быстрый просмотр DXF в PNG (линии, полилинии, окружности, тексты). Нужен matplotlib.
Запуск: python3 preview.py чертёж.dxf картинка.png"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dxf import tags, sections, entities, g
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
ACI = {7: 'k', 5: 'b', 3: 'g', 30: '#d70', 8: '#999', 1: 'r'}


def render(f, out, box=None, dpi=110, w=22):
    t = tags(f); s = sections(t); E = entities(t, *s['ENTITIES'])
    xs, ys, texts = [], [], []
    fig, ax = plt.subplots()
    for e in E:
        c = ACI.get(int(g(e, 62)) if g(e, 62) else 7, 'k')
        if e['type'] == 'LINE':
            X = [float(g(e, 10)), float(g(e, 11))]; Y = [float(g(e, 20)), float(g(e, 21))]
            ax.plot(X, Y, c, lw=.5); xs += X; ys += Y
        elif e['type'] == 'LWPOLYLINE':
            X = [float(v) for k, v in e['tags'] if k == 10]; Y = [float(v) for k, v in e['tags'] if k == 20]
            if int(g(e, 70) or 0) & 1:
                X.append(X[0]); Y.append(Y[0])
            ax.plot(X, Y, c, lw=.7); xs += X; ys += Y
        elif e['type'] == 'CIRCLE':
            ax.add_patch(plt.Circle((float(g(e, 10)), float(g(e, 20))), float(g(e, 40)), fill=False, ec=c, lw=.5))
        elif e['type'] == 'TEXT':
            x = float(g(e, 11) or g(e, 10)); y = float(g(e, 21) or g(e, 20))
            al = {0: 'left', 1: 'center', 2: 'right'}.get(int(g(e, 72) or 0), 'left')
            texts.append(ax.text(x, y, g(e, 1), color=c, rotation=float(g(e, 50) or 0), ha=al, va='center',
                                 rotation_mode='anchor'))
            texts[-1].h = float(g(e, 40))
    if box:
        ax.set_xlim(box[0], box[2]); ax.set_ylim(box[1], box[3])
    else:
        ax.set_xlim(min(xs) - 5, max(xs) + 5); ax.set_ylim(min(ys) - 5, max(ys) + 5)
    ax.set_aspect('equal'); ax.axis('off')
    x0, x1 = ax.get_xlim(); y0, y1 = ax.get_ylim()
    fig.set_size_inches(w, w * (y1 - y0) / (x1 - x0)); fig.subplots_adjust(0, 0, 1, 1)
    k = w * 72 / (x1 - x0) * 0.72
    for tx in texts:
        tx.set_fontsize(tx.h * k)
    fig.savefig(out, dpi=dpi); plt.close(fig)


if __name__ == '__main__':
    render(sys.argv[1], sys.argv[2])
