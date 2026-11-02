"""Prepara la carpeta para publicar: python3 tools/build_pwa.py [carpeta]

Copia a dist/ (o a la carpeta indicada) solo lo que la app necesita y completa
sw.js con la lista de archivos que se guardan para funcionar sin conexión.
"""
import hashlib
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, 'dist')
MARKER = '.lector-build'
INCLUDE = ['index.html', 'manifest.webmanifest', 'icons', 'src']
# Parts of foliate-js the app does not load.
SKIP_DIRS = {'tests', 'rollup'}
SKIP_FILES = {'reader.html', 'reader.js', 'package.json', 'package-lock.json',
              'eslint.config.js', 'rollup.config.js', 'README.md'}


def wanted(name):
    return name not in SKIP_FILES and not name.endswith('.map') and not name.startswith('.')


if os.path.exists(OUT):
    if not os.path.exists(os.path.join(OUT, MARKER)):
        sys.exit(f'{OUT} ya existe y no es una carpeta generada por este script.')
    shutil.rmtree(OUT)
os.makedirs(OUT)
open(os.path.join(OUT, MARKER), 'w').close()
open(os.path.join(OUT, '.nojekyll'), 'w').close()  # GitHub Pages: publish files as they are

files = []
digest = hashlib.sha256()
for item in INCLUDE:
    source = os.path.join(ROOT, item)
    if os.path.isfile(source):
        paths = [source]
    else:
        paths = []
        for folder, dirs, names in os.walk(source):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith('.'))
            paths += [os.path.join(folder, n) for n in sorted(names) if wanted(n)]
    for path in paths:
        rel = os.path.relpath(path, ROOT).replace(os.sep, '/')
        target = os.path.join(OUT, rel)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copyfile(path, target)
        files.append(rel)
        digest.update(rel.encode())
        with open(path, 'rb') as f:
            digest.update(f.read())

with open(os.path.join(ROOT, 'sw.js'), encoding='utf-8') as f:
    worker = f.read()
for placeholder in ("const VERSION = 'dev'", 'const PRECACHE = [/*FILES*/]'):
    if placeholder not in worker:
        sys.exit(f'sw.js ya no contiene: {placeholder}')
worker = worker.replace("const VERSION = 'dev'", f"const VERSION = '{digest.hexdigest()[:12]}'")
worker = worker.replace('const PRECACHE = [/*FILES*/]', f"const PRECACHE = {json.dumps(['./'] + files)}")
with open(os.path.join(OUT, 'sw.js'), 'w', encoding='utf-8') as f:
    f.write(worker)

size = sum(os.path.getsize(os.path.join(OUT, f)) for f in files)
print(f'{len(files)} archivos, {size / 1e6:.1f} MB, en {OUT}')
