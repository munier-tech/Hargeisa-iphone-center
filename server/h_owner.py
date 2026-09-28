"""System Owner control: sidebar layout (order, names, hidden items, who sees what) and turning whole modules on/off."""
from __future__ import annotations
import json, re

from core import *

KEY = re.compile(r'^[a-z_]{1,24}$')
ALWAYS_NAV = ('dashboard', 'profile')


def act_owner_get(inp):
    owner()
    import h_chat
    return {'nav': nav_cfg(), 'chat_on': h_chat.chat_on(), 'modules': TOGGLE_MODULES, 'positions': NAV_POSITIONS,
            'users': [public_user(u) | {'perms': None} for u in rows("SELECT * FROM users WHERE status<>'pending' ORDER BY is_owner DESC, is_admin DESC, name")]}


def act_owner_nav_save(inp):
    owner()
    uids = {int(r['id']) for r in rows('SELECT id FROM users')}
    items = {}
    for k, v in (inp.get('items') or {}).items() if isinstance(inp.get('items'), dict) else []:
        if not KEY.match(str(k)) or not isinstance(v, dict) or k == 'owner': continue
        it = {}
        label = s(v.get('label'), 40)
        if label: it['label'] = label
        if k in ALWAYS_NAV:                                          # landing page + own profile: rename only, never hidden
            if it: items[k] = it
            continue
        if v.get('hidden'): it['hidden'] = True
        pos = [p for p in (v.get('pos') or []) if p in NAV_POSITIONS]
        users = [I(x) for x in (v.get('users') or []) if I(x) in uids]
        if pos: it['pos'] = unique(pos)
        if users: it['users'] = unique(users)
        if it: items[k] = it
    order = unique([k for k in (inp.get('order') or []) if isinstance(k, str) and KEY.match(k)])[:80]
    groups = {k: s(v, 40) for k, v in (inp.get('groups') or {}).items() if isinstance(inp.get('groups'), dict) and KEY.match(str(k)) and s(v, 40)}
    set_setting('ui_nav', json.dumps({'items': items, 'order': order, 'groups': groups, 'v': now()}))
    audit('update', 'settings', None, 'sidebar layout')
    return nav_cfg()


def act_owner_modules_save(inp):
    owner()
    off = unique([m for m in (inp.get('off') or []) if m in TOGGLE_MODULES])
    set_setting('ui_modules_off', json.dumps(off))
    if 'chat' in inp: set_setting('chat_enabled', 'on' if inp.get('chat') else 'off')
    c = nav_cfg()                                                   # bump the layout version so open screens refresh their menu
    set_setting('ui_nav', json.dumps({'items': c['items'], 'order': c['order'], 'groups': c['groups'], 'v': now()}))
    g.pop('_off', None)
    audit('update', 'settings', None, 'modules off: ' + (', '.join(off) or 'none'))
    return nav_cfg()
