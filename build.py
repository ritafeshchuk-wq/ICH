# Собирает index.html из src/: стили, скелет DXF и скрипты — в один файл (работает и с GitHub Pages, и скачанным).
import json, os
here = os.path.dirname(os.path.abspath(__file__)); src = os.path.join(here, 'src')
rd = lambda n: open(os.path.join(src, n), encoding='utf-8').read()
skel = json.dumps(json.load(open(os.path.join(src, 'dxf-skeleton.json'), encoding='utf-8')), ensure_ascii=False)
import re
VER = re.search(r"version: '([^']+)'", rd('ich.js')).group(1); MARK = 'sha256:328908ed1181127a9f21b77d19d70a47e4ad0be284785c97777810ddff0d519a'
C = '/* Программа для ЭВМ «ИЧ». © d1sco, 2026. Все права защищены. */\n'
html = ('<!DOCTYPE html>\n<!-- Программа для ЭВМ «ИЧ», версия ' + VER + '. © d1sco, 2026. Все права защищены. Отпечаток автора ' + MARK + '. Использование и распространение — с разрешения автора. -->\n<html lang="ru"><head><meta name="author" content="d1sco"><meta name="copyright" content="© d1sco, 2026"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n'
        '<title>ИЧ — исполнительный чертёж по съёмке</title>\n<style>\n' + C + rd('style.css') + '</style></head>\n'
        '<body><div id="app"></div><input id="picker" type="file" multiple hidden><div id="toast" role="status"></div>\n'
        '<script>window.ICH_SKEL=' + skel + ';</script>\n<script>\n' + rd('ich.js') + '</script>\n<script>\n' + rd('no.js') + '</script>\n<script>\n' + rd('gnb.js') + '</script>\n<script>\n' + rd('geo.js') + '</script>\n<script>\n' + rd('ui.js') + '</script>\n</body></html>\n')
html = html.replace('<script>\n', '<script>\n' + C)
open(os.path.join(here, 'index.html'), 'w', encoding='utf-8', newline='\n').write(html)
print('index.html:', len(html), 'байт')
