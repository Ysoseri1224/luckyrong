function base64url(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(str) {
  return decodeURIComponent(escape(atob(str.replace(/-/g, '+').replace(/_/g, '/'))));
}

async function sha256(message) {
  const data = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signJwt(payload, secret) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${header}.${body}.${signature}`;
}

async function verifyJwt(token, secret) {
  const [header, body, signature] = token.split('.');
  if (!header || !body || !signature) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sig = Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(`${header}.${body}`));
  if (!valid) return null;
  try {
    const payload = JSON.parse(base64urlDecode(body));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch { return null; }
}

// --- API HANDLERS ---

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': 'https://luckyrong.ysoseri.us',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
  };
}

function jsonResponse(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...extra },
  });
}

async function getUserFromCookie(request, secret) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/tt_session=([^;]+)/);
  if (!match) return null;
  return verifyJwt(match[1], secret);
}

async function handleLogin(request, env) {
  const { email, password } = await request.json();
  const hash = await sha256(password);
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ? AND password_hash = ?').bind(email, hash).first();
  if (!user) return jsonResponse({ error: '邮箱或密码错误' }, 401);
  const token = await signJwt({ sub: user.id, email: user.email, name: user.display_name, tz: user.time_zone, exp: Math.floor(Date.now() / 1000) + 7 * 86400 }, env.JWT_SECRET);
  return new Response(JSON.stringify({ ok: true, user: { id: user.id, name: user.display_name, timeZone: user.time_zone } }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `tt_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${7 * 86400}`,
      ...corsHeaders(),
    },
  });
}

async function handleSync(request, env) {
  const user = await getUserFromCookie(request, env.JWT_SECRET);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);
  const profile = await env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind('shared').first();
  const events = await env.DB.prepare('SELECT * FROM events WHERE deleted_at IS NULL').all();
  const courses = await env.DB.prepare('SELECT * FROM courses WHERE deleted_at IS NULL').all();
  const anniversaries = await env.DB.prepare('SELECT * FROM anniversaries WHERE deleted_at IS NULL').all();
  const memories = await env.DB.prepare('SELECT * FROM memories WHERE deleted_at IS NULL').all();
  return jsonResponse({
    user: { id: user.sub, name: user.name, timeZone: user.tz },
    profile: profile || null,
    events: events.results || [],
    courses: courses.results || [],
    anniversaries: anniversaries.results || [],
    memories: memories.results || [],
  });
}

async function handlePush(request, env) {
  const user = await getUserFromCookie(request, env.JWT_SECRET);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);
  const { collection, entity } = await request.json();
  const tables = { events: 'events', courses: 'courses', anniversaries: 'anniversaries', memories: 'memories' };
  const table = tables[collection];
  if (!table) return jsonResponse({ error: 'invalid collection' }, 400);

  const existing = await env.DB.prepare(`SELECT version FROM ${table} WHERE id = ?`).bind(entity.id).first();
  if (existing && existing.version >= entity.version) {
    return jsonResponse({ error: 'version_conflict', serverVersion: existing.version }, 409);
  }

  const now = new Date().toISOString();
  entity.updated_at = now;
  if (!existing) entity.created_at = entity.created_at || now;
  entity.created_by = entity.created_by || user.sub;

  if (collection === 'events') {
    await env.DB.prepare(`INSERT OR REPLACE INTO events (id, owner, owner_user_id, title, start_utc, end_utc, source_time_zone, location, notes, version, created_at, updated_at, deleted_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(entity.id, entity.owner || 'me', entity.owner_user_id || user.sub, entity.title, entity.start_utc || entity.startUtc, entity.end_utc || entity.endUtc, entity.source_time_zone || entity.sourceTimeZone, entity.location || null, entity.notes || null, entity.version, entity.created_at || entity.createdAt, entity.updated_at, entity.deleted_at || entity.deletedAt || null, entity.created_by || entity.createdBy).run();
  } else if (collection === 'courses') {
    await env.DB.prepare(`INSERT OR REPLACE INTO courses (id, owner, owner_user_id, title, weekday, start, end, time_zone, location, teacher, color, term_start, term_end, weeks, week_parity, excluded_dates, version, created_at, updated_at, deleted_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(entity.id, entity.owner || 'me', entity.owner_user_id || user.sub, entity.title, entity.weekday, entity.start, entity.end, entity.time_zone || entity.timeZone, entity.location || null, entity.teacher || null, entity.color || null, entity.term_start || entity.termStart || null, entity.term_end || entity.termEnd || null, entity.weeks ? JSON.stringify(entity.weeks) : null, entity.week_parity || entity.weekParity || 'all', entity.excluded_dates ? JSON.stringify(entity.excluded_dates || entity.excludedDates) : null, entity.version, entity.created_at || entity.createdAt, entity.updated_at, entity.deleted_at || entity.deletedAt || null, entity.created_by || entity.createdBy).run();
  } else if (collection === 'anniversaries') {
    await env.DB.prepare(`INSERT OR REPLACE INTO anniversaries (id, title, date, repeat_annually, kind, note, color, meeting_status, meeting_location, meeting_proposed_by, meeting_confirmed_by, meeting_confirmed_at, version, created_at, updated_at, deleted_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(entity.id, entity.title, entity.date, entity.repeat_annually ?? entity.repeatAnnually ? 1 : 0, entity.kind || 'custom', entity.note || null, entity.color || null, entity.meeting_status || entity.meetingStatus || null, entity.meeting_location || entity.meetingLocation || null, entity.meeting_proposed_by || entity.meetingProposedBy || null, entity.meeting_confirmed_by || entity.meetingConfirmedBy || null, entity.meeting_confirmed_at || entity.meetingConfirmedAt || null, entity.version, entity.created_at || entity.createdAt, entity.updated_at, entity.deleted_at || entity.deletedAt || null, entity.created_by || entity.createdBy).run();
  } else if (collection === 'memories') {
    await env.DB.prepare(`INSERT OR REPLACE INTO memories (id, date, title, note, mood, anniversary_id, version, created_at, updated_at, deleted_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(entity.id, entity.date, entity.title, entity.note || null, entity.mood || null, entity.anniversary_id || entity.anniversaryId || null, entity.version, entity.created_at || entity.createdAt, entity.updated_at, entity.deleted_at || entity.deletedAt || null, entity.created_by || entity.createdBy).run();
  }

  return jsonResponse({ ok: true, version: entity.version });
}

async function handleProfileGet(request, env) {
  const user = await getUserFromCookie(request, env.JWT_SECRET);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);
  const profile = await env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind('shared').first();
  return jsonResponse(profile || {});
}

async function handleProfilePost(request, env) {
  const user = await getUserFromCookie(request, env.JWT_SECRET);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);
  const data = await request.json();
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT OR REPLACE INTO profiles (id, my_name, partner_name, my_time_zone, partner_time_zone, relationship_start, pair_code, version, updated_at) VALUES ('shared', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(data.myName, data.partnerName, data.myTimeZone, data.partnerTimeZone, data.relationshipStart || null, data.pairCode || null, (data.version || 0) + 1, now).run();
  return jsonResponse({ ok: true });
}

async function handleLogout(request, env) {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'tt_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
      ...corsHeaders(),
    },
  });
}

async function handleApi(request, env, path) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (path === '/together/api/login' && request.method === 'POST') return handleLogin(request, env);
  if (path === '/together/api/logout' && request.method === 'POST') return handleLogout(request, env);
  if (path === '/together/api/sync' && request.method === 'GET') return handleSync(request, env);
  if (path === '/together/api/push' && request.method === 'POST') return handlePush(request, env);
  if (path === '/together/api/profile' && request.method === 'GET') return handleProfileGet(request, env);
  if (path === '/together/api/profile' && request.method === 'POST') return handleProfilePost(request, env);
  return jsonResponse({ error: 'not found' }, 404);
}

// --- GITHUB COMMITS PROXY (CF Cache, 5 min TTL) ---

async function handleCommits(request, env) {
  const cacheUrl = new URL('https://ysoseri.us/api/commits?v=2');
  const cache = caches.default;
  let resp = await cache.match(cacheUrl);
  if (resp) return resp;

  const headers = { 'User-Agent': 'ysoseri-homepage', 'Accept': 'application/vnd.github+json' };
  if (env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${env.GITHUB_TOKEN}`;

  const gh = await fetch('https://api.github.com/search/commits?q=author:Ysoseri1224&sort=author-date&order=desc&per_page=4', { headers });
  if (!gh.ok) {
    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  const data = await gh.json();
  const commits = (data.items || []).map(item => ({
    msg: item.commit.message.split('\n')[0],
    repo: item.repository.name,
    time: item.commit.author.date,
  }));

  resp = new Response(JSON.stringify(commits), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, s-maxage=300, max-age=300' },
  });
  await cache.put(cacheUrl, resp.clone());
  return resp;
}

// --- MAIN ROUTER ---

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/commits' && request.method === 'GET') {
      return handleCommits(request, env);
    }

    if (url.pathname.startsWith('/together/api')) {
      return handleApi(request, env, url.pathname);
    }

    if (url.pathname.startsWith('/together')) {
      const path = url.pathname.replace('/together', '') || '/';
      const targetUrl = `https://together-time.pages.dev${path}${url.search}`;
      const response = await fetch(targetUrl, { method: request.method, headers: request.headers });
      return new Response(response.body, { status: response.status, headers: response.headers });
    }

    if (url.pathname.startsWith('/cet6')) {
      const path = url.pathname.replace('/cet6', '') || '/';
      const targetUrl = `https://cet6-camp.pages.dev${path}${url.search}`;
      const response = await fetch(targetUrl, { method: request.method, headers: request.headers });
      return new Response(response.body, { status: response.status, headers: response.headers });
    }

    const targetUrl = `https://luckyrong.pages.dev${url.pathname}${url.search}`;
    const response = await fetch(targetUrl, { method: request.method, headers: request.headers });
    return new Response(response.body, { status: response.status, headers: response.headers });
  },
};
