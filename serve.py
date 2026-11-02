"""Servidor local para el lector: python3 serve.py [puerto] [carpeta]

Sirve esta carpeta (u otra, como dist/) en http://127.0.0.1:8765 sin caché,
para que los cambios en los archivos se vean al recargar.
"""
import functools
import http.server
import os
import sys

ROOT = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.mjs': 'text/javascript',
        '.js': 'text/javascript',
        '.webmanifest': 'application/manifest+json',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    handler = functools.partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer(('127.0.0.1', PORT), handler) as server:
        print(f'Lector disponible en http://127.0.0.1:{PORT}')
        server.serve_forever()
