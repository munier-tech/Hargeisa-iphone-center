"""HARGEISA IPHONE CENTER — web server (Python / Flask + waitress).

Serves the same single-page apps and the same JSON API (`/api.php?a=<action>`) as the previous PHP server, so the browser
front end and every saved record work unchanged. The data lives in PostgreSQL (Neon): set DATABASE_URL first.

    python server/app.py            ->  http://localhost:8080
"""
from __future__ import annotations
import logging, os, re, sys, threading, traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, g, make_response, request, send_from_directory
import json

import core
from core import ApiError, db, defer, now, q, ROOT
import h_auth, h_ops, h_inv, h_soft, h_center, h_chat, h_owner, acc, h_reports

import mimetypes
mimetypes.add_type('application/manifest+json', '.webmanifest')
PUBLIC = os.path.join(ROOT, 'public')
app = Flask(__name__, static_folder=None)
app.config['JSON_AS_ASCII'] = False
log = logging.getLogger('hic')
_startup_lock = threading.Lock()
_started = False

# every `act_<name>` function in the handler modules is an API action
ACTIONS = {}
for _m in (h_auth, h_ops, h_inv, h_soft, h_center, h_chat, h_owner, acc, h_reports):
    for _n in dir(_m):
        _f = getattr(_m, _n)
        if _n.startswith('act_') and callable(_f) and getattr(_f, '__module__', None) == _m.__name__: ACTIONS[_n[4:]] = _f


def _secure() -> bool:
    return request.is_secure or request.headers.get('X-Forwarded-Proto', '') == 'https'

def _finish(resp, code_headers=True):
    resp.headers['Cache-Control'] = 'no-store'
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['X-Frame-Options'] = 'SAMEORIGIN'
    resp.headers['Referrer-Policy'] = 'same-origin'
    for name, value, max_age in g.get('cookies', []):
        if max_age == 0: resp.set_cookie(name, '', max_age=0, expires=0, path='/', httponly=True, samesite='Lax', secure=_secure())
        else: resp.set_cookie(name, value, max_age=max_age, path='/', httponly=True, samesite='Lax', secure=_secure())
    return resp


@app.route('/api.php', methods=['GET', 'POST'])
def api():
    action = re.sub(r'[^a-z_]', '', request.args.get('a', ''))
    body, code, in_tx = None, 200, False
    core.STATS['req'] += 1
    try:
        # CSRF defence: every action except the public branding read needs our custom header (cross-site pages cannot send it)
        if action != 'branding' and request.headers.get('X-Requested-With') != 'HIC': raise ApiError('Bad request.', 400)
        fn = ACTIONS.get(action)
        if not action or fn is None: raise ApiError('Unknown action.', 404)
        inp = request.get_json(silent=True, force=True)
        inp = inp if isinstance(inp, dict) else {}
        q('BEGIN'); in_tx = True
        core.check_module(action)
        result = fn(inp)
        q('COMMIT'); in_tx = False
        body = {'ok': True, 'data': result, 'now': now()}
    except ApiError as e:
        _rollback(in_tx)
        body = {'ok': False, 'error': e.message, 'now': now(), **e.extra}; code = e.code if 400 <= e.code < 600 else 400
    except Exception:
        _rollback(in_tx)
        log.error('API error in %s\n%s', action, traceback.format_exc())
        core.STATS['err'] += 1; core.ERRLOG.append({'ts': core.now(), 'where': action, 'msg': traceback.format_exc().strip().splitlines()[-1][:300]})
        body = {'ok': False, 'error': 'Server error. Please try again.', 'now': now()}; code = 500
    resp = make_response(json.dumps(body, ensure_ascii=False, default=str), code)
    resp.headers['Content-Type'] = 'application/json; charset=utf-8'
    return _finish(resp)

def _rollback(in_tx: bool) -> None:
    try:
        if 'db' in g and (in_tx or core.in_tx()): q('ROLLBACK')
    except Exception: pass
    for sql, params in g.get('after_rollback', []):     # failed-login counters, forced log-outs
        try: q(sql, params)
        except Exception: pass


@app.teardown_request
def _close(exc):
    c = g.pop('db', None)
    if c is not None: core.release(c)                  # back to the connection pool


@app.route('/chat_file/<int:mid>')
def chat_file(mid): return h_chat.serve_file(mid)

@app.route('/backup_download/<name>')
def backup_download(name): return h_center.download_backup(name)


# ------------------------------------------------------------------ static pages
def _page(name: str, status: int = 200):
    resp = make_response(send_from_directory(PUBLIC, name)); resp.status_code = status
    resp.headers['Cache-Control'] = 'no-cache'; return resp

@app.route('/')
@app.route('/index.html')
def index(): return _page('index.html')

@app.route('/portal')
@app.route('/portal/')
def portal(): return _page('portal.html')

@app.route('/<path:path>')
def static_files(path):
    full = os.path.realpath(os.path.join(PUBLIC, path))
    if full.startswith(os.path.realpath(PUBLIC) + os.sep) and os.path.isfile(full) and not full.lower().endswith(('.php', '.py')):
        resp = make_response(send_from_directory(PUBLIC, path)); resp.headers['Cache-Control'] = 'no-cache'; return resp
    return _page('restricted.html', 404)

@app.errorhandler(404)
def nf(_): return _page('restricted.html', 404)

@app.errorhandler(405)
def na(_): return _page('restricted.html', 404)


def initialize():
    global _started
    with _startup_lock:
        if _started: return
        core.init_db()
        threading.Thread(target=h_center.auto_backup_loop, name='auto-backup', daemon=True).start()
        _started = True


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    initialize()
    host = os.environ.get('HIC_HOST', '0.0.0.0'); port = int(os.environ.get('HIC_PORT', os.environ.get('PORT', '8080')))
    try:
        from waitress import serve
        logging.getLogger('waitress').setLevel(logging.WARNING)
        print(f'HARGEISA IPHONE CENTER - listening on http://{host}:{port}  (Ctrl+C to stop)', flush=True)
        serve(app, host=host, port=port, threads=8, ident='HIC')
    except ImportError:
        app.run(host=host, port=port, threaded=True)


if __name__ == '__main__':
    main()
