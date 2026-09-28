/* Internal Chat Center (staff to staff) + Chat Permissions (Super Admin) */
const CH_EMO = ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😢', '😭', '😡', '👍', '👎', '👏', '🙏', '💪', '🔥', '✅', '❌', '⭐', '🎉', '❤️', '💯', '📱', '🔧', '💰', '📦', '⏰', '👋', '🙂', '😉', '😅', '🤝', '👌', '🚀', '⚠️', '📞', '💬', '☕'];
const chatTime = ts => new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const chatDay = ts => { const d = new Date(ts * 1000), t = new Date(), y = new Date(Date.now() - 864e5); const same = (a, b) => a.toDateString() === b.toDateString(); return same(d, t) ? 'Today' : same(d, y) ? 'Yesterday' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
const chatSize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const chatLink = t => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>').replace(/\n/g, '<br>');
/* polling call that does not flash the top loader bar */
async function qapi(a, body) {
  const res = await fetch('api.php?a=' + a, { method: 'POST', headers: { 'X-Requested-With': 'HIC', 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }), j = await res.json();
  if (j.now) S.skew = j.now - Math.floor(Date.now() / 1000);
  if (!j.ok) { if (j.auth && S.user && typeof showLogin === 'function') { S.user = null; showLogin(); } const e = new Error(j.error || 'Chat error'); e.chatOff = res.status === 403; throw e; }
  return j.data;
}
/* sound + browser notification for a new message (also used from app.js when chat is not open) */
function chatBeep() { try { const A = window.AudioContext || window.webkitAudioContext, c = new A(), o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = 880; g.gain.value = .06; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + .13); setTimeout(() => c.close(), 400); } catch (e) { } }
function chatNotify(text) {
  toast(text, 'ok'); chatBeep();
  try { if ('Notification' in window && Notification.permission === 'granted' && document.hidden) { const n = new Notification(S.br.company_name || 'Chat', { body: text, icon: '/assets/icons/icon-192.png' }); n.onclick = () => { window.focus(); location.hash = '#/chat'; n.close(); }; } } catch (e) { }
}

V.chat = async root => {
  const boot = await api('chat_users');
  const C = { active: 0, msgs: [], convs: [], users: boot.users, pres: {}, me: boot.me, perms: boot.perms, maxMb: boot.max_mb, reply: null, att: null, tab: 'all', q: '', typing: [], last: 0, since: 0, hasMore: false, sig: '', unreadSeen: {}, sending: false, busy: false, rec: null };
  const user = id => C.users.find(u => u.id === id) || (id === C.me ? { id, name: S.user.name, avatar: S.user.avatar, position: S.user.position } : { id, name: 'Former user' });
  const pres = id => C.pres[id] || { online: (C.users.find(u => u.id === id) || {}).online, last_seen: (C.users.find(u => u.id === id) || {}).last_seen };
  const conv = () => C.convs.find(c => c.id === C.active);
  const other = c => user((c.members.find(m => m.id !== C.me) || {}).id);
  const cname = c => c.kind === 'group' ? c.name : other(c).name;
  const av = (c, cls = 'sm') => c.kind === 'group' ? `<div class="avatar ${cls} grp">${ic('users')}</div>` : avatar({ ...other(c), online: pres(other(c).id).online }, cls);
  root.innerHTML = `<div class="chat" id="chat"><aside class="chat-l"><div class="chat-lh"><div class="search">${ic('search')}<input id="cq" type="search" placeholder="Search people & chats…" autocomplete="off" aria-label="Search chats"></div>${C.perms.group ? `<button class="btn ico primary" id="cng" title="New group">${ic('users')}</button>` : ''}</div>
      <div class="chat-tabs"><a data-t="all" class="on">All</a><a data-t="unread">Unread <span class="nb hidden" id="cun"></span></a><a data-t="online">Online</a></div><div class="chat-list" id="clist"></div></aside>
    <section class="chat-r" id="cr"><div class="chat-empty">${ic('chat')}<h3>${esc(S.br.company_name || 'Chat')}</h3><p class="muted">Select a person or a conversation to start chatting.</p></div></section></div>`;
  const shell = $('#chat', root);

  /* ---------- left list ---------- */
  const drawList = () => {
    const q = C.q.toLowerCase(), list = $('#clist', root); let h = '';
    const convRow = c => { const l = c.last; return `<div class="ci ${c.id === C.active ? 'on' : ''}" data-c="${c.id}">${av(c)}<div class="grow"><div class="row" style="justify-content:space-between;flex-wrap:nowrap"><b class="ell">${esc(cname(c))}</b><small class="muted">${l ? chatTime(l.ts) : ''}</small></div><div class="row" style="justify-content:space-between;flex-wrap:nowrap"><small class="muted ell">${l ? (l.mine ? 'You: ' : '') + esc(l.text) : 'No messages yet'}</small>${c.unread ? `<span class="nb">${c.unread}</span>` : ''}</div></div></div>`; };
    const userRow = u => { const p = pres(u.id); return `<div class="ci" data-u="${u.id}">${avatar({ ...u, online: p.online }, 'sm')}<div class="grow"><b class="ell">${esc(u.name)}</b><br><small class="muted">${esc(u.position)}${p.online ? '' : ' • ' + (p.last_seen ? 'seen ' + ago(p.last_seen) : 'never signed in')}</small></div></div>`; };
    let convs = C.convs.filter(c => !q || cname(c).toLowerCase().includes(q) || (c.last && c.last.text.toLowerCase().includes(q)));
    const us = C.users.filter(u => !q || u.name.toLowerCase().includes(q)), on = us.filter(u => pres(u.id).online), off = us.filter(u => !pres(u.id).online);
    if (C.tab === 'unread') { convs = convs.filter(c => c.unread); h = convs.map(convRow).join('') || '<div class="empty" style="padding:30px 10px">No unread messages 🎉</div>'; }
    else if (C.tab === 'online') h = on.map(userRow).join('') || '<div class="empty" style="padding:30px 10px">Nobody else is online right now.</div>';
    else h = (convs.length ? `<h6>Recent chats</h6>${convs.map(convRow).join('')}` : '') + (on.length ? `<h6>🟢 Online (${on.length})</h6>${on.map(userRow).join('')}` : '') + (off.length ? `<h6>⚪ Offline (${off.length})</h6>${off.map(userRow).join('')}` : '') || '<div class="empty" style="padding:30px 10px">Nothing found.</div>';
    list.innerHTML = h;
    const un = C.convs.reduce((a, c) => a + c.unread, 0), b = $('#cun', root); b.textContent = un; b.classList.toggle('hidden', !un);
    $$('[data-c]', list).forEach(el => el.onclick = () => openConv(+el.dataset.c));
    $$('[data-u]', list).forEach(el => el.onclick = () => safe(async () => { const r = await api('chat_open', { user_id: +el.dataset.u }); await sync(); openConv(r.id); }));
  };

  /* ---------- right pane ---------- */
  const drawHead = () => {
    const c = conv(); if (!c) return; const sub = $('#csub', root); if (!sub) return;
    if (C.typing.length) sub.innerHTML = `<span class="typing">${esc(C.typing.join(', '))} ${C.typing.length > 1 ? 'are' : 'is'} typing<i></i><i></i><i></i></span>`;
    else if (c.kind === 'group') sub.textContent = c.members.length + ' members: ' + c.members.map(m => user(m.id).name.split(' ')[0]).join(', ');
    else { const p = pres(other(c).id); sub.innerHTML = p.online ? '<span style="color:#22c55e">● Online</span>' : `<span class="muted">${p.last_seen ? 'Last seen ' + ago(p.last_seen) : 'Never signed in'}</span>`; }
  };
  const tick = (m, c) => { const others = c.members.filter(x => x.id !== C.me), seen = others.filter(x => x.read >= m.id).length; return `<span class="tk ${others.length && seen === others.length ? 'rd' : ''}" title="${seen === others.length ? 'Read' : c.kind === 'group' ? 'Seen by ' + seen : 'Delivered'}">${seen ? '✓✓' : '✓'}</span>`; };
  const attHtml = m => { const a = m.att; if (!a) return ''; const url = '/chat_file/' + m.id;
    if (a.kind === 'image') return `<img class="cimg" src="${url}" alt="${esc(a.name)}" loading="lazy" data-img="${url}">`;
    if (a.kind === 'voice') return `<audio controls preload="none" src="${url}"></audio>`;
    return `<a class="cfile" href="${url}" download="${esc(a.name)}">${ic('file')}<span><b>${esc(a.name)}</b><small>${chatSize(a.size || 0)}</small></span>${ic('download')}</a>`; };
  const drawMsgs = (keep = false) => {
    const c = conv(), box = $('#cmsgs', root); if (!c || !box) return;
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 90, prev = box.scrollTop; let day = '', h = C.hasMore ? `<div class="cmore"><button class="btn sm" id="cold">${ic('clock')} Load older messages</button></div>` : '';
    for (const m of C.msgs) {
      const d = chatDay(m.ts); if (d !== day) { day = d; h += `<div class="cday"><span>${d}</span></div>`; }
      const mine = m.user_id === C.me, canDel = !m.deleted && (mine ? C.perms.delete : S.user.is_admin);
      h += `<div class="cm ${mine ? 'mine' : 'theirs'} ${m.deleted ? 'del' : ''}" data-id="${m.id}">${!mine && c.kind === 'group' ? `<b class="cn">${esc(user(m.user_id).name)}</b>` : ''}
        ${m.reply ? `<div class="cq" data-goto="${m.reply.id}"><b>${esc(m.reply.name || '')}</b><span>${esc(m.reply.text)}</span></div>` : ''}
        ${m.deleted ? `<div class="cb"><i>🚫 This message was deleted</i></div>` : `${attHtml(m)}${m.body ? `<div class="cb">${chatLink(m.body)}</div>` : ''}`}
        <div class="cmeta"><span>${chatTime(m.ts)}</span>${mine && !m.deleted ? tick(m, c) : ''}</div>
        ${m.deleted ? '' : `<div class="cact"><button data-rp="${m.id}" title="Reply">${ic('reply')}</button>${canDel ? `<button data-dl="${m.id}" title="Delete">${ic('trash')}</button>` : ''}</div>`}</div>`;
    }
    box.innerHTML = h || `<div class="chat-empty" style="height:auto;padding:60px 10px">${ic('chat')}<p class="muted">No messages yet — say hello 👋</p></div>`;
    box.scrollTop = near || !keep ? box.scrollHeight : prev;
    $('#cold', box)?.addEventListener('click', () => safe(async () => { const r = await api('chat_history', { conv_id: C.active, before_id: C.msgs[0].id }); C.msgs = [...r.msgs, ...C.msgs]; C.hasMore = r.has_more; drawMsgs(true); }));
    $$('[data-rp]', box).forEach(b => b.onclick = () => { C.reply = C.msgs.find(m => m.id === +b.dataset.rp); drawReply(); $('#cin', root).focus(); });
    $$('[data-dl]', box).forEach(b => b.onclick = async () => { if (await confirmBox({ title: 'Delete this message?', message: 'It will be removed for everyone in this conversation.', confirmText: 'Delete' })) safe(async () => { await api('chat_delete', { id: +b.dataset.dl }); await sync(); }); });
    $$('[data-img]', box).forEach(i => i.onclick = () => modal({ title: esc(i.alt), size: 'lg', body: `<div style="text-align:center"><img src="${i.dataset.img}" alt="" style="max-width:100%;max-height:70vh;border-radius:12px"></div>`, footer: `<a class="btn" href="${i.dataset.img}" download="${esc(i.alt)}">${ic('download')} Download</a><button class="btn primary" data-close>Close</button>` }));
    $$('[data-goto]', box).forEach(q => q.onclick = () => { const el = $(`[data-id="${q.dataset.goto}"]`, box); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); } });
  };
  const drawReply = () => {
    const r = $('#cbar', root); if (!r) return; let h = '';
    if (C.reply) h += `<div class="cbar"><span>${ic('reply')}</span><div class="grow"><b>${esc(user(C.reply.user_id).name)}</b><br><small class="muted ell">${esc(C.reply.body || (C.reply.att ? '📎 ' + C.reply.att.name : ''))}</small></div><button class="btn sm ico ghost" id="crx">${ic('x')}</button></div>`;
    if (C.att) h += `<div class="cbar"><span>${ic('paperclip')}</span><div class="grow"><b>${esc(C.att.name)}</b><br><small class="muted">${chatSize(C.att.size)}</small></div><button class="btn sm ico ghost" id="cax">${ic('x')}</button></div>`;
    r.innerHTML = h; $('#crx', r)?.addEventListener('click', () => { C.reply = null; drawReply(); }); $('#cax', r)?.addEventListener('click', () => { C.att = null; drawReply(); });
  };
  const send = async () => {
    if (C.sending) return; const inp = $('#cin', root), body = inp.value.trim(); if (!body && !C.att) return; C.sending = true;
    try { await qapi('chat_send', { conv_id: C.active, body, reply_to: C.reply?.id, att: C.att ? { name: C.att.name, data: C.att.data, voice: C.att.voice } : undefined }); inp.value = ''; inp.style.height = ''; C.reply = null; C.att = null; drawReply(); await sync(true); }
    catch (e) { toast(e.message, 'err'); } finally { C.sending = false; }
  };
  const pickFile = f => { if (!f) return; if (f.size > C.maxMb * 1048576) return toast(`File too large — the limit is ${C.maxMb} MB.`, 'err'); const r = new FileReader(); r.onload = () => { C.att = { name: f.name, data: r.result, size: f.size }; drawReply(); }; r.readAsDataURL(f); };
  const record = async () => {
    const b = $('#cmic', root);
    if (C.rec) { C.rec.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Voice notes need a secure connection (https or localhost) and a supported browser.', 'err');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }), rec = new MediaRecorder(stream), chunks = [], t0 = Date.now(); C.rec = rec;
      rec.ondataavailable = e => chunks.push(e.data);
      rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); C.rec = null; b.classList.remove('rec'); b.innerHTML = ic('mic'); const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        if (Date.now() - t0 < 700) return toast('Hold a little longer to record a voice note.', 'err'); if (blob.size > C.maxMb * 1048576) return toast('Voice note too long.', 'err');
        const r = new FileReader(); r.onload = () => { C.att = { name: 'voice.' + ((rec.mimeType || 'audio/webm').includes('ogg') ? 'ogg' : (rec.mimeType || '').includes('mp4') ? 'm4a' : 'webm'), data: r.result, size: blob.size, voice: true }; send(); }; r.readAsDataURL(blob); };
      rec.start(); b.classList.add('rec'); b.innerHTML = ic('stop');
    } catch (e) { toast('Microphone access was denied.', 'err'); }
  };
  const emoji = () => { const old = $('#cemo', root); if (old) return old.remove(); const p = document.createElement('div'); p.id = 'cemo'; p.className = 'cemo'; p.innerHTML = CH_EMO.map(e => `<button type="button">${e}</button>`).join(''); $('#ccomp', root).appendChild(p);
    $$('button', p).forEach(b => b.onclick = () => { const i = $('#cin', root), s = i.selectionStart ?? i.value.length; i.value = i.value.slice(0, s) + b.textContent + i.value.slice(i.selectionEnd ?? s); i.focus(); i.selectionStart = i.selectionEnd = s + b.textContent.length; }); };

  const openConv = id => {
    C.active = id; C.msgs = []; C.last = 0; C.since = nowTs(); C.reply = null; C.att = null; C.typing = []; C.sig = ''; C.hasMore = false; C.hasMoreSet = false;
    const c = conv(); if (!c) return; shell.classList.add('open-conv');
    const info = c.kind === 'group' ? `<button class="btn ico ghost" id="cinfo" title="Group info">${ic('info')}</button>` : '';
    $('#cr', root).innerHTML = `<div class="chat-h"><button class="btn ico ghost cback" id="cback" title="Back">${ic('back')}</button>${av(c, 'sm')}<div class="grow"><b class="ell">${esc(cname(c))}</b><br><small id="csub" class="ell"></small></div><button class="btn ico ghost" id="csrch" title="Search this conversation">${ic('search')}</button>${info}</div>
      <div class="csearch hidden" id="csearch"><div class="search">${ic('search')}<input id="csi" type="search" placeholder="Search in this conversation…" autocomplete="off"></div><div id="csres"></div></div>
      <div class="cmsgs" id="cmsgs"><div class="empty">Loading…</div></div><div id="cbar"></div>
      <div class="ccomp" id="ccomp"><button class="btn ico ghost" id="cemob" title="Emoji">${ic('smile')}</button>${C.perms.attach ? `<button class="btn ico ghost" id="catt" title="Attach image or document">${ic('paperclip')}</button><input type="file" id="cfile" class="hidden" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip">` : ''}
        <textarea id="cin" rows="1" placeholder="Type a message" aria-label="Message"></textarea>${C.perms.voice ? `<button class="btn ico ghost" id="cmic" title="Voice note">${ic('mic')}</button>` : ''}<button class="btn ico primary" id="csend" title="Send">${ic('send')}</button></div>`;
    const inp = $('#cin', root); let tt = 0;
    inp.oninput = () => { inp.style.height = 'auto'; inp.style.height = Math.min(120, inp.scrollHeight) + 'px'; if (Date.now() - tt > 2500 && inp.value) { tt = Date.now(); qapi('chat_typing', { conv_id: C.active }).catch(() => { }); } };
    inp.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 760) { e.preventDefault(); send(); } };
    $('#csend', root).onclick = send; $('#cemob', root).onclick = emoji; $('#catt', root)?.addEventListener('click', () => $('#cfile', root).click()); $('#cfile', root)?.addEventListener('change', e => { pickFile(e.target.files[0]); e.target.value = ''; });
    $('#cmic', root)?.addEventListener('click', record);
    $('#cback', root).onclick = () => { C.active = 0; shell.classList.remove('open-conv'); $('#cr', root).innerHTML = `<div class="chat-empty">${ic('chat')}<h3>${esc(S.br.company_name || 'Chat')}</h3><p class="muted">Select a person or a conversation to start chatting.</p></div>`; drawList(); };
    $('#csrch', root).onclick = () => { const s = $('#csearch', root); s.classList.toggle('hidden'); if (!s.classList.contains('hidden')) $('#csi', root).focus(); else $('#csres', root).innerHTML = ''; };
    let st; $('#csi', root).oninput = e => { clearTimeout(st); st = setTimeout(async () => { const v = e.target.value.trim(), res = $('#csres', root); if (v.length < 2) return res.innerHTML = '';
      const r = await safe(() => api('chat_search', { conv_id: C.active, q: v })) || []; res.innerHTML = r.length ? r.map(m => `<div class="sr" data-sr="${m.id}"><b>${esc(user(m.user_id).name)}</b> <small class="muted">${chatDay(m.ts)} ${chatTime(m.ts)}</small><br>${esc(m.body || m.att?.name || '')}</div>`).join('') : '<div class="empty" style="padding:12px">No messages found.</div>';
      $$('[data-sr]', res).forEach(x => x.onclick = () => { const el = $(`[data-id="${x.dataset.sr}"]`, root); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); } else toast('That message is older — use "Load older messages".', 'ok'); }); }, 250); };
    $('#cinfo', root)?.addEventListener('click', groupInfo);
    drawList(); drawHead(); sync(true);
  };

  /* ---------- group dialogs ---------- */
  const pickUsers = (exclude = []) => `<div class="pickusers">${C.users.filter(u => !exclude.includes(u.id)).map(u => `<label class="ci"><input type="checkbox" value="${u.id}">${avatar({ ...u, online: pres(u.id).online }, 'sm')}<div class="grow"><b>${esc(u.name)}</b><br><small class="muted">${esc(u.position)}</small></div></label>`).join('') || '<p class="muted">Nobody else to add.</p>'}</div>`;
  const chosen = m => $$('.pickusers input:checked', m.el).map(i => +i.value);
  $('#cng', root)?.addEventListener('click', () => { const m = modal({ title: `${ic('users')} New group`, size: 'sm', body: `${fi('gname', 'Group name', '', { req: 1, ph: 'e.g. Repair team' })}<p class="muted" style="margin:12px 0 6px">Add members</p>${pickUsers()}`, footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="gok">${ic('check')} Create group</button>` });
    $('#gok', m.el).onclick = () => safe(async () => { const r = await api('chat_group_create', { name: $('[name=gname]', m.el).value, members: chosen(m) }); m.close(); await sync(); openConv(r.id); }); });
  const groupInfo = () => { const c = conv(); if (!c) return; const admin = S.user.is_admin || (c.members.find(x => x.id === C.me) || {}).role === 'admin';
    const m = modal({ title: `${ic('users')} ${esc(c.name)}`, size: 'sm', body: `${admin ? `<div class="row" style="flex-wrap:nowrap;margin-bottom:12px"><input id="grn" value="${esc(c.name)}" maxlength="60"><button class="btn" id="grs">${ic('check')} Rename</button></div>` : ''}<h6 style="margin:0 0 6px" class="muted">${c.members.length} members</h6>
      ${c.members.map(x => { const u = user(x.id); return `<div class="ci">${avatar({ ...u, online: pres(x.id).online }, 'sm')}<div class="grow"><b>${esc(x.id === C.me ? 'You' : u.name)}</b> ${x.role === 'admin' ? '<span class="chip" style="--c:#f59e0b">Admin</span>' : ''}<br><small class="muted">${esc(u.position || '')}</small></div>${admin && x.id !== C.me ? `<button class="btn sm ico danger" data-rm="${x.id}" title="Remove">${ic('x')}</button>` : ''}</div>`; }).join('')}
      ${admin && C.perms.add ? `<h6 style="margin:14px 0 6px" class="muted">Add members</h6>${pickUsers(c.members.map(x => x.id))}<button class="btn primary" id="gad" style="margin-top:8px">${ic('plus')} Add selected</button>` : ''}`, footer: `<button class="btn danger" id="glv">${ic('logout')} Leave group</button><button class="btn primary" data-close>Close</button>` });
    $('#grs', m.el)?.addEventListener('click', () => safe(async () => { await api('chat_group_rename', { conv_id: c.id, name: $('#grn', m.el).value }); m.close(); await sync(); }));
    $('#gad', m.el)?.addEventListener('click', () => safe(async () => { const r = await api('chat_group_add', { conv_id: c.id, members: chosen(m) }); toast(r.added + ' member(s) added', 'ok'); m.close(); await sync(); }));
    $$('[data-rm]', m.el).forEach(b => b.onclick = () => safe(async () => { await api('chat_group_remove', { conv_id: c.id, user_id: +b.dataset.rm }); m.close(); await sync(); }));
    $('#glv', m.el).onclick = async () => { if (await confirmBox({ title: 'Leave this group?', message: 'You will stop receiving its messages.', confirmText: 'Leave', color: 'warn' })) safe(async () => { await api('chat_group_remove', { conv_id: c.id }); m.close(); C.active = 0; await sync(); $('#cback', root)?.click(); }); }; };

  /* ---------- sync loop ---------- */
  const sync = async (force = false) => {
    if (curRoute !== 'chat' || C.busy) return; C.busy = true;
    try {
      const act = C.active, r = await qapi('chat_sync', { conv_id: C.active, after_id: C.last, since_ts: C.since, mark_read: C.active && !document.hidden ? 1 : 0 });
      if (act !== C.active) { C.convs = r.convs; drawList(); return; }          // the user switched conversations while this request was in flight
      C.since = Math.max(0, r.now - 1); r.presence.forEach(p => { C.pres[p.id] = p; });
      // new messages in conversations that are not open
      r.convs.forEach(c => { const seen = C.unreadSeen[c.id] || 0; if (c.id !== C.active && c.unread > seen && Object.keys(C.unreadSeen).length && c.last && !c.last.mine) chatNotify(`${cname({ ...c, members: c.members })}: ${c.last.text}`); C.unreadSeen[c.id] = c.unread; });
      const had = C.convs.length; C.convs = r.convs; S.chatUnread = r.unread; paintChatBadge();
      let changed = false, incoming = false;
      for (const m of r.msgs) { const i = C.msgs.findIndex(x => x.id === m.id); if (i >= 0) { if (JSON.stringify(C.msgs[i]) !== JSON.stringify(m)) { C.msgs[i] = m; changed = true; } } else { C.msgs.push(m); changed = true; if (m.user_id !== C.me && C.last) incoming = true; } }
      if (r.msgs.length) { C.msgs.sort((a, b) => a.id - b.id); C.last = Math.max(C.last, ...C.msgs.map(m => m.id)); }
      if (r.has_more !== undefined && !C.hasMoreSet) { C.hasMore = r.has_more; C.hasMoreSet = true; }
      const c = conv(), sig = c ? c.members.map(m => m.read).join(',') + '|' + C.typing.join(',') : '', ty = (r.typing || []).join(',');
      const headChanged = ty !== C.typing.join(','); C.typing = r.typing || [];
      drawList(); if (c) { drawHead(); if (changed || force || sig !== C.sig) { C.sig = sig; drawMsgs(!force); } }
      if (incoming && !document.hidden) chatBeep();
    } catch (e) { if (e.chatOff) { toast(e.message, 'err'); location.hash = '#/dashboard'; } } finally { C.busy = false; }
  };
  $('#cq', root).oninput = e => { C.q = e.target.value; drawList(); };
  $$('.chat-tabs a', root).forEach(a => a.onclick = () => { C.tab = a.dataset.t; $$('.chat-tabs a', root).forEach(x => x.classList.toggle('on', x === a)); drawList(); });
  await sync();
  every(() => sync(), 2000);
  every(async () => { const b = await qapi('chat_users').catch(() => null); if (b) { C.users = b.users; C.perms = b.perms; } }, 60000);
  if (!window._chatVis) { window._chatVis = true; document.addEventListener('visibilitychange', () => { if (!document.hidden && curRoute === 'chat' && window._chatSync) window._chatSync(true); }); }
  window._chatSync = sync;
  try { if ('Notification' in window && Notification.permission === 'default') $('#chat', root).addEventListener('click', () => Notification.requestPermission(), { once: true }); } catch (e) { }
};

/* ------------------------------------------------ Chat Permissions (Super Admin) */
const CHAT_PERM_COLS = [['chat', 'Can chat'], ['group', 'Create groups'], ['add', 'Add members'], ['attach', 'Attach files'], ['delete', 'Delete messages'], ['voice', 'Voice notes']];
V.chatperms = async root => {
  const d = await api('chat_perms_get'), st = d.settings, s = d.stats;
  root.innerHTML = pageHead('Chat Permissions', 'Control who can chat, create groups, add members, attach files and delete messages — Super Admin only') +
    `<div class="grid g-auto" style="margin-bottom:16px">${statCard('Conversations', s.convs, 'chat', '#4f8cff')}${statCard('Groups', s.groups, 'users', '#8b5cf6')}${statCard('Messages stored', s.msgs, 'list', '#22c55e')}${statCard('Attachments size', fmtBytes(s.files_bytes), 'paperclip', '#f59e0b')}</div>
    <form class="card" id="cs" style="margin-bottom:16px"><h3>${ic('sliders')} Chat settings</h3><div class="form">${fs('enabled', 'Internal chat', [['on', 'Turned on for everyone allowed below'], ['off', 'Turned OFF for everyone']], st.enabled ? 'on' : 'off', { blank: false })}${fi('retention_days', 'Keep messages for (days, 0 = forever)', st.retention_days, { type: 'number', attrs: 'min=0 max=3650' })}${fi('max_mb', 'Largest attachment (MB)', st.max_mb, { type: 'number', attrs: 'min=1 max=50' })}
      <div class="full row"><button class="btn primary">${ic('check')} Save settings</button><button type="button" class="btn warn" id="cp">${ic('trash')} Delete messages older than the retention period now</button></div></div></form>
    <div class="card" style="padding:0"><div style="padding:16px 16px 4px"><h3 style="margin:0">${ic('shield')} Who can do what</h3><p class="muted" style="margin:4px 0 0">Changes apply immediately. Turn off <b>Can chat</b> to disable chat completely for a user. The Super Admin can always chat.</p></div>` +
    tbl([{ h: 'User', f: u => `<b>${esc(u.name)}</b> ${u.online ? '<span class="chip" style="--c:#22c55e">Online</span>' : ''}<small>${esc(u.position)} • ${u.status}</small>` }, ...CHAT_PERM_COLS.map(([k, l]) => ({ h: l, f: u => `<label class="sw"><input type="checkbox" data-u="${u.id}" data-k="${k}" ${u.perms[k] ? 'checked' : ''} ${k !== 'chat' && !u.perms.chat ? 'disabled' : ''}><i></i></label>` }))], d.users, { empty: 'No staff users yet.' }) + '</div>' +
    `<div class="notice info" style="margin-top:16px">${ic('info')}<span>Private conversations stay private — the Super Admin cannot read other people's chats. Chat attachments are stored in <code>data\\chat_files</code>; include that folder when you copy backups to another drive.</span></div>`;
  wireLive(root);
  $('#cs').onsubmit = e => { e.preventDefault(); const f = formData(e.target); safe(async () => { await api('chat_settings_save', { enabled: f.enabled === 'on', retention_days: +f.retention_days, max_mb: +f.max_mb }); toast('Chat settings saved', 'ok'); V.chatperms(root); }); };
  $('#cp').onclick = async () => { if (await confirmBox({ title: 'Delete old messages now?', message: `All messages older than ${st.retention_days} day(s) are permanently removed, including their attachments.`, confirmText: 'Delete', color: 'warn' })) safe(async () => { const r = await api('chat_purge'); toast(r.deleted + ' message(s) deleted', 'ok'); V.chatperms(root); }); };
  $$('[data-k]', root).forEach(cb => cb.onchange = () => { const row = $$(`[data-u="${cb.dataset.u}"]`, root), perms = {}; row.forEach(x => { perms[x.dataset.k] = x.checked ? 1 : 0; });
    safe(async () => { await api('chat_perms_save', { user_id: +cb.dataset.u, perms }); toast('Saved', 'ok'); if (cb.dataset.k === 'chat') V.chatperms(root); }); });
};
