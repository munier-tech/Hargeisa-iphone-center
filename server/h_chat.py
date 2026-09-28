"""Internal chat (staff to staff): 1-to-1 and group conversations, attachments, voice notes, read receipts, typing, presence, permissions, retention."""
from __future__ import annotations
import base64, io, os, re, secrets, time

from core import *
import core

CHAT_DIR = os.path.join(DATA, 'chat_files')          # only older attachments; new ones are stored in the chat_files table
TYPING: dict = {}                                     # (conv_id, user_id) -> last typing timestamp (in memory, resets on restart)
IMG = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif', 'webp': 'image/webp'}
DOC = {'pdf': 'application/pdf', 'doc': 'application/msword', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'xls': 'application/vnd.ms-excel',
       'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'ppt': 'application/vnd.ms-powerpoint', 'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
       'txt': 'text/plain', 'csv': 'text/csv', 'zip': 'application/zip'}
VOICE = {'webm': 'audio/webm', 'ogg': 'audio/ogg', 'm4a': 'audio/mp4', 'mp4': 'audio/mp4', 'wav': 'audio/wav', 'mp3': 'audio/mpeg'}
MIME = {**IMG, **DOC, **VOICE}


# ------------------------------------------------------------------ permissions
def chat_on() -> bool: return setting('chat_enabled', 'on') != 'off'

def max_mb() -> int:
    """Largest attachment. Vercel refuses requests over 4.5 MB, so there a file (sent as base64) is capped at 3 MB."""
    m = max(1, I(setting('chat_max_mb', '10'))); return min(m, 3) if core.ON_VERCEL else m

def need_chat(perm: str = 'chat') -> dict:
    u = me()
    if not chat_on(): raise ApiError('Chat has been turned off by the Super Admin.', 403)
    p = chat_perm_dict(u)
    if not p['chat']: raise ApiError('Chat is disabled for your account.', 403)
    if perm != 'chat' and not p.get(perm): raise ApiError('You are not allowed to do this in chat.', 403)
    return u

def member(conv_id: int, uid: int) -> dict | None:
    return row('SELECT * FROM chat_members WHERE conv_id=? AND user_id=?', (conv_id, uid))

def need_member(conv_id: int, uid: int) -> dict:
    m = member(conv_id, uid)
    if not m: raise ApiError('Conversation not found.', 404)
    return m

def unread_total(uid: int) -> int:
    return int(val("SELECT COUNT(*) FROM chat_msgs m JOIN chat_members cm ON cm.conv_id=m.conv_id AND cm.user_id=? WHERE m.id>cm.last_read_id AND m.user_id<>? AND m.deleted=0", (uid, uid)) or 0)


# ------------------------------------------------------------------ people
def act_chat_users(inp):
    u = need_chat(); out = []
    for r in rows("SELECT * FROM users WHERE status='active' AND id<>? ORDER BY name", (u['id'],)):
        if not chat_perm_dict(r)['chat']: continue
        p = public_user(r); out.append({'id': p['id'], 'name': p['name'], 'position': 'System Owner' if p['is_owner'] else 'Super Admin' if p['is_admin'] else p['position'], 'avatar': p['avatar'], 'online': p['online'], 'last_seen': p['last_seen']})
    return {'users': out, 'perms': chat_perm_dict(u), 'me': int(u['id']), 'max_mb': max_mb()}

def act_chat_open(inp):
    u = need_chat(); other = I(inp.get('user_id')); o = row("SELECT * FROM users WHERE id=? AND status='active'", (other,))
    if not o or other == int(u['id']) or not chat_perm_dict(o)['chat']: raise ApiError('That user is not available for chat.')
    a, b = sorted((int(u['id']), other)); key = f'{a}:{b}'; cid = val('SELECT id FROM chat_convs WHERE dkey=?', (key,))
    if not cid:
        cid = ins('chat_convs', {'kind': 'direct', 'dkey': key, 'created_by': u['id'], 'created_at': now()})
        for x in (a, b): q('INSERT INTO chat_members(conv_id,user_id,role,joined_at) VALUES(?,?,?,?)', (cid, x, 'member', now()))
    return {'id': int(cid)}


# ------------------------------------------------------------------ sync (polled every ~2 s while chat is open, ~15 s otherwise via ping)
def _preview(m: dict) -> str:
    if m['deleted']: return 'Message deleted'
    if m['att_kind'] == 'image': return '📷 Photo'
    if m['att_kind'] == 'voice': return '🎤 Voice note'
    if m['att_kind'] == 'file': return '📎 ' + (m['att_name'] or 'File')
    return (m['body'] or '')[:80]

def _msg_out(m: dict, reply: dict | None = None) -> dict:
    return {'id': int(m['id']), 'conv_id': int(m['conv_id']), 'user_id': int(m['user_id']), 'body': '' if m['deleted'] else (m['body'] or ''), 'reply_to': m['reply_to'], 'ts': int(m['ts']), 'deleted': bool(m['deleted']),
            'att': None if (m['deleted'] or not m['att_kind']) else {'kind': m['att_kind'], 'name': m['att_name'], 'size': m['att_size']}, 'reply': reply}

def _with_replies(ms: list) -> list:
    ids = [m['reply_to'] for m in ms if m['reply_to']]; rep = {}
    if ids:
        for r in rows(f"SELECT m.id,m.body,m.att_kind,m.att_name,m.deleted,u.name uname FROM chat_msgs m LEFT JOIN users u ON u.id=m.user_id WHERE m.id IN ({','.join('?' * len(ids))})", ids):
            rep[r['id']] = {'id': int(r['id']), 'name': r['uname'], 'text': _preview(r)}
    return [_msg_out(m, rep.get(m['reply_to'])) for m in ms]

def act_chat_sync(inp):
    u = need_chat(); uid = int(u['id']); active = I(inp.get('conv_id')); after = I(inp.get('after_id')); since = I(inp.get('since_ts'))
    convs = []
    for c in rows("""SELECT c.id,c.kind,c.name,cm.last_read_id,
        (SELECT COUNT(*) FROM chat_msgs m WHERE m.conv_id=c.id AND m.id>cm.last_read_id AND m.user_id<>? AND m.deleted=0) unread,
        (SELECT MAX(id) FROM chat_msgs m WHERE m.conv_id=c.id) last_id
        FROM chat_convs c JOIN chat_members cm ON cm.conv_id=c.id AND cm.user_id=?""", (uid, uid)):
        mem = rows('SELECT user_id,role,last_read_id FROM chat_members WHERE conv_id=?', (c['id'],))
        last = row('SELECT id,body,att_kind,att_name,deleted,user_id,ts FROM chat_msgs WHERE id=?', (c['last_id'],)) if c['last_id'] else None
        convs.append({'id': int(c['id']), 'kind': c['kind'], 'name': c['name'], 'unread': int(c['unread']), 'members': [{'id': int(m['user_id']), 'role': m['role'], 'read': int(m['last_read_id'] or 0)} for m in mem],
                      'last': {'id': int(last['id']), 'text': _preview(last), 'ts': int(last['ts']), 'mine': int(last['user_id']) == uid} if last else None, 'ts': int(last['ts']) if last else 0})
    convs.sort(key=lambda c: -c['ts'])
    out = {'convs': convs, 'unread': sum(c['unread'] for c in convs), 'presence': [{'id': int(r['id']), 'online': public_user(r)['online'], 'last_seen': int(r['last_seen'] or 0)} for r in rows("SELECT * FROM users WHERE status='active' ORDER BY id")],
           'now': now(), 'msgs': [], 'typing': []}
    if active and member(active, uid):
        if after == 0: ms = list(reversed(rows('SELECT * FROM chat_msgs WHERE conv_id=? ORDER BY id DESC LIMIT 60', (active,))))
        else: ms = rows('SELECT * FROM chat_msgs WHERE conv_id=? AND (id>? OR COALESCE(deleted_ts,0)>?) ORDER BY id LIMIT 200', (active, after, since))
        out['msgs'] = _with_replies(ms); out['has_more'] = after == 0 and len(ms) >= 60
        if inp.get('mark_read'):
            top = val('SELECT MAX(id) FROM chat_msgs WHERE conv_id=?', (active,)) or 0
            q('UPDATE chat_members SET last_read_id=? WHERE conv_id=? AND user_id=? AND last_read_id<?', (top, active, uid, top))
            for c in convs:
                if c['id'] == active: c['unread'] = 0
            out['unread'] = sum(c['unread'] for c in convs)
        t = time.time(); typing_ids = [k[1] for k, v in list(TYPING.items()) if k[0] == active and k[1] != uid and t - v < 4]
        if typing_ids: out['typing'] = [r['name'] for r in rows(f"SELECT name FROM users WHERE id IN ({','.join('?' * len(typing_ids))})", typing_ids)]
    touch_user(u)                                     # having chat open counts as being online
    return out

def act_chat_history(inp):
    u = need_chat(); cid = I(inp.get('conv_id')); need_member(cid, int(u['id']))
    ms = list(reversed(rows('SELECT * FROM chat_msgs WHERE conv_id=? AND id<? ORDER BY id DESC LIMIT 50', (cid, I(inp.get('before_id'))))))
    return {'msgs': _with_replies(ms), 'has_more': len(ms) >= 50}

def act_chat_typing(inp):
    u = need_chat(); cid = I(inp.get('conv_id'))
    if member(cid, int(u['id'])): TYPING[(cid, int(u['id']))] = time.time()
    return []

def act_chat_search(inp):
    u = need_chat(); cid = I(inp.get('conv_id')); need_member(cid, int(u['id'])); t = s(inp.get('q'), 80)
    if len(t) < 2: return []
    like = '%' + t.replace('%', '\\%').replace('_', '\\_') + '%'
    return _with_replies(rows("SELECT * FROM chat_msgs WHERE conv_id=? AND deleted=0 AND (body ILIKE ? ESCAPE '\\' OR att_name ILIKE ? ESCAPE '\\') ORDER BY id DESC LIMIT 40", (cid, like, like)))


# ------------------------------------------------------------------ send / delete
def _save_att(att: dict, perms: dict) -> tuple:
    name = re.sub(r'[^\w.\- ()]', '_', s(att.get('name'), 120)) or 'file'; ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    kind = 'voice' if att.get('voice') else ('image' if ext in IMG else 'file')
    if kind == 'voice':
        ext = ext if ext in VOICE else 'webm'
        if not perms['voice']: raise ApiError('Voice notes are not allowed for your account.', 403)
    elif ext not in MIME: raise ApiError('This file type is not allowed. Use images, PDF, Office documents, text or zip.')
    if kind != 'voice' and not perms['attach']: raise ApiError('You are not allowed to attach files.', 403)
    raw = str(att.get('data') or ''); raw = raw.split(',', 1)[1] if raw.startswith('data:') and ',' in raw else raw
    try: blob = base64.b64decode(raw, validate=True)
    except Exception: raise ApiError('The attachment could not be read.')
    limit = max_mb() * 1024 * 1024
    if not blob or len(blob) > limit: raise ApiError(f'The file is too large (limit {limit // 1048576} MB).')
    fname = secrets.token_hex(16) + '.' + ext
    q('INSERT INTO chat_files(name,mime,size,data,ts) VALUES(?,?,?,?,?)', (fname, MIME.get(ext), len(blob), blob, now()))
    return kind, name if kind != 'voice' else 'Voice note', fname, len(blob)

def act_chat_send(inp):
    u = need_chat(); uid = int(u['id']); cid = I(inp.get('conv_id')); need_member(cid, uid); perms = chat_perm_dict(u)
    body = s(inp.get('body'), 4000); att = inp.get('att') if isinstance(inp.get('att'), dict) else None
    if not body and not att: raise ApiError('Type a message first.')
    reply = I(inp.get('reply_to')) or None
    if reply and not val('SELECT 1 FROM chat_msgs WHERE id=? AND conv_id=?', (reply, cid)): reply = None
    kind = name = fname = size = None
    if att: kind, name, fname, size = _save_att(att, perms)
    mid = ins('chat_msgs', {'conv_id': cid, 'user_id': uid, 'body': body, 'reply_to': reply, 'att_kind': kind, 'att_name': name, 'att_file': fname, 'att_size': size, 'ts': now()})
    q('UPDATE chat_members SET last_read_id=? WHERE conv_id=? AND user_id=?', (mid, cid, uid))
    TYPING.pop((cid, uid), None)
    return {'id': mid}

def act_chat_delete(inp):
    u = need_chat(); uid = int(u['id']); m = row('SELECT * FROM chat_msgs WHERE id=?', (I(inp.get('id')),))
    if not m: raise ApiError('Message not found.', 404)
    need_member(int(m['conv_id']), uid)
    if not u['is_admin']:
        if int(m['user_id']) != uid: raise ApiError('You can only delete your own messages.', 403)
        if not chat_perm_dict(u)['delete']: raise ApiError('You are not allowed to delete messages.', 403)
    if m['att_file']: _drop_file(m['att_file'])
    q("UPDATE chat_msgs SET deleted=1,body='',att_file=NULL,att_kind=NULL,deleted_by=?,deleted_ts=? WHERE id=?", (uid, now(), m['id']))
    if u['is_admin'] and int(m['user_id']) != uid: audit('delete', 'chat_message', int(m['id']), 'by Super Admin')
    return []

def serve_file(mid: int):
    """Flask route helper: only members of the conversation can open an attachment."""
    from flask import abort, send_file, send_from_directory, make_response
    u = me(False)
    if not u or not chat_on() or not chat_perm_dict(u)['chat']: abort(404)
    m = row('SELECT * FROM chat_msgs WHERE id=?', (mid,))
    if not m or m['deleted'] or not m['att_file'] or not member(int(m['conv_id']), int(u['id'])): abort(404)
    ext = m['att_file'].rsplit('.', 1)[-1]; opts = dict(mimetype=MIME.get(ext, 'application/octet-stream'), as_attachment=ext not in IMG and ext not in VOICE, download_name=m['att_name'] or m['att_file'])
    blob = val('SELECT data FROM chat_files WHERE name=?', (m['att_file'],))
    if blob is not None: resp = make_response(send_file(io.BytesIO(bytes(blob)), **opts))
    elif os.path.isfile(os.path.join(CHAT_DIR, m['att_file'])): resp = make_response(send_from_directory(CHAT_DIR, m['att_file'], **opts))
    else: abort(404)
    resp.headers['X-Content-Type-Options'] = 'nosniff'; resp.headers['Cache-Control'] = 'private, max-age=3600'; resp.headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'"
    return resp


# ------------------------------------------------------------------ groups
def _group(cid: int, uid: int, need_admin: bool = True) -> dict:
    c = row("SELECT * FROM chat_convs WHERE id=? AND kind='group'", (cid,)); m = member(cid, uid)
    if not c or not m: raise ApiError('Group not found.', 404)
    return c

def act_chat_group_create(inp):
    u = need_chat('group'); name = s(inp.get('name'), 60)
    if not name: raise ApiError('Give the group a name.')
    ids = {int(u['id'])} | {I(x) for x in (inp.get('members') or []) if I(x)}
    cid = ins('chat_convs', {'kind': 'group', 'name': name, 'created_by': u['id'], 'created_at': now()})
    for i in ids:
        r = row("SELECT * FROM users WHERE id=? AND status='active'", (i,))
        if r and chat_perm_dict(r)['chat']: q('INSERT INTO chat_members(conv_id,user_id,role,joined_at) VALUES(?,?,?,?)', (cid, i, 'admin' if i == int(u['id']) else 'member', now()))
    audit('create', 'chat_group', cid, name)
    return {'id': int(cid)}

def _can_manage(u: dict, cid: int) -> bool:
    m = member(cid, int(u['id'])); return bool(u['is_admin'] or (m and m['role'] == 'admin'))

def act_chat_group_add(inp):
    u = need_chat('add'); cid = I(inp.get('conv_id')); _group(cid, int(u['id']))
    if not _can_manage(u, cid): raise ApiError('Only the group admin can add members.', 403)
    n_ = 0
    for i in {I(x) for x in (inp.get('members') or []) if I(x)}:
        r = row("SELECT * FROM users WHERE id=? AND status='active'", (i,))
        if r and chat_perm_dict(r)['chat'] and not member(cid, i): q('INSERT INTO chat_members(conv_id,user_id,role,joined_at,last_read_id) VALUES(?,?,?,?,(SELECT COALESCE(MAX(id),0) FROM chat_msgs WHERE conv_id=?))', (cid, i, 'member', now(), cid)); n_ += 1
    return {'added': n_}

def act_chat_group_remove(inp):
    u = need_chat(); cid = I(inp.get('conv_id')); target = I(inp.get('user_id')) or int(u['id']); _group(cid, int(u['id']))
    if target != int(u['id']) and not _can_manage(u, cid): raise ApiError('Only the group admin can remove members.', 403)
    q('DELETE FROM chat_members WHERE conv_id=? AND user_id=?', (cid, target))
    return []

def act_chat_group_rename(inp):
    u = need_chat(); cid = I(inp.get('conv_id')); _group(cid, int(u['id']))
    if not _can_manage(u, cid): raise ApiError('Only the group admin can rename the group.', 403)
    name = s(inp.get('name'), 60)
    if not name: raise ApiError('Give the group a name.')
    q('UPDATE chat_convs SET name=? WHERE id=?', (name, cid)); return []


# ------------------------------------------------------------------ Super Admin: chat permissions, settings, retention
def _settings() -> dict:
    return {'enabled': chat_on(), 'retention_days': max(0, I(setting('chat_retention_days', '0'))), 'max_mb': max_mb()}

def act_chat_perms_get(inp):
    admin(); out = []
    for r in rows("SELECT * FROM users WHERE is_admin=0 ORDER BY status, name"):
        p = public_user(r); out.append({'id': p['id'], 'name': p['name'], 'position': p['position'], 'status': p['status'], 'perms': chat_perm_dict(r), 'online': p['online']})
    st = row("SELECT (SELECT COUNT(*) FROM chat_msgs WHERE deleted=0) AS msgs,(SELECT COUNT(*) FROM chat_convs) AS convs,(SELECT COUNT(*) FROM chat_convs WHERE kind='group') AS groups").copy()
    files = int(val('SELECT COALESCE(SUM(size),0) FROM chat_files') or 0)
    return {'users': out, 'settings': _settings(), 'stats': {**st, 'files_bytes': files}}

def act_chat_perms_save(inp):
    admin(); uid = I(inp.get('user_id')); u = row('SELECT * FROM users WHERE id=? AND is_admin=0', (uid,))
    if not u: raise ApiError('User not found.', 404)
    p = inp.get('perms') if isinstance(inp.get('perms'), dict) else {}
    q('UPDATE users SET chat_perms=? WHERE id=?', (json.dumps({k: 1 if p.get(k) else 0 for k in CHAT_DEFAULT}), uid))
    audit('update', 'chat_permissions', uid, u['name'])
    return []

def act_chat_settings_save(inp):
    admin()
    set_setting('chat_enabled', 'off' if inp.get('enabled') in (False, 'off', 0, '0') else 'on')
    set_setting('chat_retention_days', str(min(3650, max(0, I(inp.get('retention_days'))))))
    set_setting('chat_max_mb', str(min(50, max(1, I(inp.get('max_mb')) or 10))))
    audit('update', 'settings', None, 'chat')
    return _settings()

def _drop_file(name: str) -> None:
    q('DELETE FROM chat_files WHERE name=?', (name,))
    try: os.remove(os.path.join(CHAT_DIR, name))           # an older attachment still on disk
    except OSError: pass

def _purge(days: int) -> int:
    cut = now() - days * 86400; n_ = 0
    for m in rows('SELECT id,att_file FROM chat_msgs WHERE ts<?', (cut,)):
        if m['att_file']: _drop_file(m['att_file'])
        n_ += 1
    q('DELETE FROM chat_msgs WHERE ts<?', (cut,))
    return n_

def act_chat_purge(inp):
    admin(); days = max(0, I(setting('chat_retention_days', '0')))
    if not days: raise ApiError('Set a retention period first (0 means keep forever).')
    n_ = _purge(days); audit('delete', 'chat', None, f'retention purge: {n_} message(s)'); return {'deleted': n_}

def purge_if_due(td: str) -> None:
    days = max(0, I(setting('chat_retention_days', '0')))
    if days and setting('chat_last_purge', '') != td: set_setting('chat_last_purge', td); _purge(days)
