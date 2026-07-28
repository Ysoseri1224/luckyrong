const TIMELINE_ORIGIN = 'https://luckyrong.ysoseri.us';
const EVENT_TYPES = new Set(['text', 'photo', 'video', 'milestone']);
const MEDIA_CONTENT_TYPES = new Map([
  ['image/jpeg', { type: 'image', extension: 'jpg' }],
  ['image/png', { type: 'image', extension: 'png' }],
  ['image/webp', { type: 'image', extension: 'webp' }],
  ['image/avif', { type: 'image', extension: 'avif' }],
  ['video/mp4', { type: 'video', extension: 'mp4' }],
  ['video/webm', { type: 'video', extension: 'webm' }],
]);
const MAX_JSON_BYTES = 96 * 1024;
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function timelineHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': TIMELINE_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Filename',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  };
}

function jsonResponse(data, status = 200, extra = {}) {
  return Response.json(data, {
    status,
    headers: timelineHeaders({ 'Cache-Control': 'no-store', ...extra }),
  });
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeJson(value) {
  return bytesToBase64Url(textEncoder.encode(JSON.stringify(value)));
}

function decodeJson(value) {
  return JSON.parse(textDecoder.decode(base64UrlToBytes(value)));
}

async function importHmacKey(secret, usages) {
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

async function signEditorJwt(secret) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeJson({ sub: 'timeline-editor', iat: issuedAt, exp: issuedAt + 30 * 86400 });
  const unsigned = `${header}.${payload}`;
  const key = await importHmacKey(secret, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(unsigned));
  return `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function verifyEditorJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) return null;
  try {
    const header = decodeJson(headerPart);
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
    const key = await importHmacKey(secret, ['verify']);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(signaturePart),
      textEncoder.encode(`${headerPart}.${payloadPart}`),
    );
    if (!valid) return null;
    const payload = decodeJson(payloadPart);
    const now = Math.floor(Date.now() / 1000);
    if (payload.sub !== 'timeline-editor' || !Number.isFinite(payload.exp) || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

async function timingSafeSecretEqual(provided, expected) {
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', textEncoder.encode(provided)),
    crypto.subtle.digest('SHA-256', textEncoder.encode(expected)),
  ]);
  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
  }
  const providedBytes = new Uint8Array(providedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < providedBytes.length; index += 1) {
    difference |= providedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

async function readBodyLimited(request, maximumBytes) {
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > maximumBytes) throw new HttpError(413, '请求内容过大');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new HttpError(413, '请求内容过大');
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return textDecoder.decode(combined);
}

async function readJson(request) {
  const source = await readBodyLimited(request, MAX_JSON_BYTES);
  try {
    return source ? JSON.parse(source) : {};
  } catch {
    throw new HttpError(400, 'JSON 格式无效');
  }
}

function requiredString(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${label}不能为空`);
  const result = value.trim();
  if (result.length > maximum) throw new HttpError(400, `${label}过长`);
  return result;
}

function optionalString(value, label, maximum) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, `${label}格式无效`);
  const result = value.trim();
  if (result.length > maximum) throw new HttpError(400, `${label}过长`);
  return result || null;
}

function dateString(value, label, optional = false) {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `${label}格式无效`);
  const parsed = Date.parse(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed)) throw new HttpError(400, `${label}格式无效`);
  return value;
}

function colorString(value, label, optional = false) {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new HttpError(400, `${label}必须是十六进制颜色`);
  return value.toLowerCase();
}

function nullablePositiveInteger(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0) throw new HttpError(400, `${label}格式无效`);
  return result;
}

function parseAxisIds(value) {
  if (!Array.isArray(value)) throw new HttpError(400, '事件轴格式无效');
  const ids = [...new Set(value.map(Number))];
  if (ids.length === 0 || ids.length > 12 || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new HttpError(400, '至少选择一条有效的轴');
  }
  return ids;
}

function canonicalMediaUrl(key) {
  return `/timeline/api/media/${encodeURIComponent(key)}`;
}

function parseMedia(value) {
  if (!Array.isArray(value) || value.length > 30) throw new HttpError(400, '媒体清单格式无效');
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new HttpError(400, '媒体条目格式无效');
    const key = requiredString(item.key, '媒体 key', 260);
    if (!key.startsWith('timeline/') || key.includes('..')) throw new HttpError(400, '媒体 key 无效');
    if (item.type !== 'image' && item.type !== 'video') throw new HttpError(400, '媒体类型无效');
    return {
      key,
      url: canonicalMediaUrl(key),
      type: item.type,
      caption: optionalString(item.caption, '媒体说明', 180) || '',
      name: optionalString(item.name, '媒体名称', 180) || '',
    };
  });
}

function parseStoredMedia(source) {
  try {
    return parseMedia(JSON.parse(source || '[]'));
  } catch {
    return [];
  }
}

function axisDraft(body) {
  const sortOrder = Number(body.sort_order ?? 0);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 99) throw new HttpError(400, '排列顺序无效');
  const startDate = dateString(body.start_date, '出现日期', true);
  const endDate = dateString(body.end_date, '结束日期', true);
  if (startDate && endDate && startDate > endDate) throw new HttpError(400, '结束日期不能早于出现日期');
  return {
    name: requiredString(body.name, '轴名称', 40),
    color: colorString(body.color, '轴颜色'),
    sortOrder,
    parentAxisId: nullablePositiveInteger(body.parent_axis_id, '父轴'),
    startDate,
    endDate,
    mergeAxisId: nullablePositiveInteger(body.merge_axis_id, '合流轴'),
  };
}

function eventDraft(body) {
  if (!EVENT_TYPES.has(body.type)) throw new HttpError(400, '事件类型无效');
  return {
    type: body.type,
    title: requiredString(body.title, '标题', 120),
    subtitle: optionalString(body.subtitle, '副标题', 180),
    description: optionalString(body.description, '正文', 8000),
    eventDate: dateString(body.event_date, '事件日期'),
    color: colorString(body.color, '节点颜色', true),
    media: parseMedia(body.media ?? []),
    axisIds: parseAxisIds(body.axis_ids),
  };
}

async function requireEditor(request, env) {
  if (!env.TIMELINE_JWT_SECRET) throw new HttpError(503, 'Timeline 认证尚未配置');
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpError(401, '请先验证编辑密码');
  const payload = await verifyEditorJwt(match[1], env.TIMELINE_JWT_SECRET);
  if (!payload) throw new HttpError(401, '编辑状态已失效，请重新验证');
  return payload;
}

async function ensureAxesExist(env, axisIds) {
  const placeholders = axisIds.map(() => '?').join(', ');
  const result = await env.TIMELINE_DB.prepare(`SELECT id FROM timeline_axes WHERE id IN (${placeholders})`)
    .bind(...axisIds)
    .all();
  if ((result.results || []).length !== axisIds.length) throw new HttpError(400, '包含不存在的事件轴');
}

async function ensureAxisReferences(env, draft, currentId = null) {
  const ids = [...new Set([draft.parentAxisId, draft.mergeAxisId].filter(Boolean))];
  if (currentId && ids.includes(currentId)) throw new HttpError(400, '轴不能引用自己');
  if (ids.length > 0) await ensureAxesExist(env, ids);
}

function serializeEvent(row, axisIds) {
  return {
    ...row,
    media: parseStoredMedia(row.media),
    axis_ids: axisIds,
  };
}

async function loadEvent(env, eventId) {
  const row = await env.TIMELINE_DB.prepare('SELECT * FROM timeline_events WHERE id = ?').bind(eventId).first();
  if (!row) return null;
  const axesResult = await env.TIMELINE_DB.prepare('SELECT axis_id FROM timeline_event_axes WHERE event_id = ? ORDER BY axis_id')
    .bind(eventId)
    .all();
  return serializeEvent(row, (axesResult.results || []).map((item) => item.axis_id));
}

async function getAxes(env) {
  const result = await env.TIMELINE_DB.prepare('SELECT * FROM timeline_axes ORDER BY sort_order, id').all();
  return jsonResponse({ axes: result.results || [] });
}

async function createAxis(request, env) {
  await requireEditor(request, env);
  const draft = axisDraft(await readJson(request));
  await ensureAxisReferences(env, draft);
  try {
    const result = await env.TIMELINE_DB.prepare(`
      INSERT INTO timeline_axes (name, color, sort_order, parent_axis_id, start_date, end_date, merge_axis_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(draft.name, draft.color, draft.sortOrder, draft.parentAxisId, draft.startDate, draft.endDate, draft.mergeAxisId).run();
    const axis = await env.TIMELINE_DB.prepare('SELECT * FROM timeline_axes WHERE id = ?').bind(result.meta.last_row_id).first();
    return jsonResponse({ axis }, 201);
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new HttpError(409, '已经有同名的轴');
    throw error;
  }
}

async function updateAxis(request, env, axisId) {
  await requireEditor(request, env);
  const existing = await env.TIMELINE_DB.prepare('SELECT id FROM timeline_axes WHERE id = ?').bind(axisId).first();
  if (!existing) throw new HttpError(404, '事件轴不存在');
  const draft = axisDraft(await readJson(request));
  await ensureAxisReferences(env, draft, axisId);
  try {
    await env.TIMELINE_DB.prepare(`
      UPDATE timeline_axes
      SET name = ?, color = ?, sort_order = ?, parent_axis_id = ?, start_date = ?, end_date = ?, merge_axis_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(draft.name, draft.color, draft.sortOrder, draft.parentAxisId, draft.startDate, draft.endDate, draft.mergeAxisId, axisId).run();
    const axis = await env.TIMELINE_DB.prepare('SELECT * FROM timeline_axes WHERE id = ?').bind(axisId).first();
    return jsonResponse({ axis });
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new HttpError(409, '已经有同名的轴');
    throw error;
  }
}

async function removeAxis(request, env, axisId) {
  await requireEditor(request, env);
  const relationCount = await env.TIMELINE_DB.prepare('SELECT COUNT(*) AS count FROM timeline_event_axes WHERE axis_id = ?')
    .bind(axisId)
    .first('count');
  if (Number(relationCount) > 0) throw new HttpError(409, '这条轴仍挂着事件，请先移动或删除这些事件');
  const result = await env.TIMELINE_DB.batch([
    env.TIMELINE_DB.prepare('UPDATE timeline_axes SET parent_axis_id = NULL WHERE parent_axis_id = ?').bind(axisId),
    env.TIMELINE_DB.prepare('UPDATE timeline_axes SET merge_axis_id = NULL WHERE merge_axis_id = ?').bind(axisId),
    env.TIMELINE_DB.prepare('DELETE FROM timeline_axes WHERE id = ?').bind(axisId),
  ]);
  const deleted = Number(result[2]?.meta?.changes || 0);
  if (!deleted) throw new HttpError(404, '事件轴不存在');
  return jsonResponse({ ok: true });
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const cursor = decodeJson(value);
    if (typeof cursor.date !== 'string' || !Number.isInteger(cursor.id)) throw new Error('invalid');
    return cursor;
  } catch {
    throw new HttpError(400, '分页游标无效');
  }
}

async function getEvents(request, env) {
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '100', 10) || 100));
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const statement = cursor
    ? env.TIMELINE_DB.prepare(`
        SELECT * FROM timeline_events
        WHERE event_date < ? OR (event_date = ? AND id < ?)
        ORDER BY event_date DESC, id DESC
        LIMIT ?
      `).bind(cursor.date, cursor.date, cursor.id, limit)
    : env.TIMELINE_DB.prepare('SELECT * FROM timeline_events ORDER BY event_date DESC, id DESC LIMIT ?').bind(limit);
  const result = await statement.all();
  const rows = result.results || [];
  const axisMap = new Map();
  if (rows.length > 0) {
    const placeholders = rows.map(() => '?').join(', ');
    const relations = await env.TIMELINE_DB.prepare(`
      SELECT event_id, axis_id FROM timeline_event_axes
      WHERE event_id IN (${placeholders})
      ORDER BY event_id, axis_id
    `).bind(...rows.map((row) => row.id)).all();
    for (const relation of relations.results || []) {
      const list = axisMap.get(relation.event_id) || [];
      list.push(relation.axis_id);
      axisMap.set(relation.event_id, list);
    }
  }
  const events = rows.map((row) => serializeEvent(row, axisMap.get(row.id) || []));
  const last = rows[rows.length - 1];
  const nextCursor = rows.length === limit && last ? encodeJson({ date: last.event_date, id: last.id }) : null;
  return jsonResponse({ events, next_cursor: nextCursor });
}

async function createEvent(request, env) {
  await requireEditor(request, env);
  const draft = eventDraft(await readJson(request));
  await ensureAxesExist(env, draft.axisIds);
  const result = await env.TIMELINE_DB.prepare(`
    INSERT INTO timeline_events (type, title, subtitle, description, event_date, color, media, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(draft.type, draft.title, draft.subtitle, draft.description, draft.eventDate, draft.color, JSON.stringify(draft.media)).run();
  const eventId = Number(result.meta.last_row_id);
  await env.TIMELINE_DB.batch(
    draft.axisIds.map((axisId) => env.TIMELINE_DB.prepare('INSERT INTO timeline_event_axes (event_id, axis_id) VALUES (?, ?)').bind(eventId, axisId)),
  );
  return jsonResponse({ event: await loadEvent(env, eventId) }, 201);
}

async function updateEvent(request, env, eventId) {
  await requireEditor(request, env);
  const existing = await loadEvent(env, eventId);
  if (!existing) throw new HttpError(404, '事件不存在');
  const draft = eventDraft(await readJson(request));
  await ensureAxesExist(env, draft.axisIds);
  const statements = [
    env.TIMELINE_DB.prepare(`
      UPDATE timeline_events
      SET type = ?, title = ?, subtitle = ?, description = ?, event_date = ?, color = ?, media = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(draft.type, draft.title, draft.subtitle, draft.description, draft.eventDate, draft.color, JSON.stringify(draft.media), eventId),
    env.TIMELINE_DB.prepare('DELETE FROM timeline_event_axes WHERE event_id = ?').bind(eventId),
    ...draft.axisIds.map((axisId) => env.TIMELINE_DB.prepare('INSERT INTO timeline_event_axes (event_id, axis_id) VALUES (?, ?)').bind(eventId, axisId)),
  ];
  await env.TIMELINE_DB.batch(statements);

  const retainedKeys = new Set(draft.media.map((item) => item.key));
  const removedKeys = existing.media.map((item) => item.key).filter((key) => !retainedKeys.has(key));
  if (removedKeys.length > 0) await env.TIMELINE_MEDIA.delete(removedKeys);
  return jsonResponse({ event: await loadEvent(env, eventId) });
}

async function removeEvent(request, env, eventId) {
  await requireEditor(request, env);
  const existing = await loadEvent(env, eventId);
  if (!existing) throw new HttpError(404, '事件不存在');
  await env.TIMELINE_DB.batch([
    env.TIMELINE_DB.prepare('DELETE FROM timeline_event_axes WHERE event_id = ?').bind(eventId),
    env.TIMELINE_DB.prepare('DELETE FROM timeline_events WHERE id = ?').bind(eventId),
  ]);
  const keys = existing.media.map((item) => item.key);
  if (keys.length > 0) await env.TIMELINE_MEDIA.delete(keys);
  return jsonResponse({ ok: true });
}

async function login(request, env) {
  if (!env.TIMELINE_PASSWORD || !env.TIMELINE_JWT_SECRET) throw new HttpError(503, 'Timeline 认证尚未配置');
  const body = await readJson(request);
  const password = requiredString(body.password, '密码', 256);
  const valid = await timingSafeSecretEqual(password, env.TIMELINE_PASSWORD);
  if (!valid) throw new HttpError(401, '密码不正确');
  return jsonResponse({ token: await signEditorJwt(env.TIMELINE_JWT_SECRET), expires_in: 30 * 86400 });
}

async function verifySession(request, env) {
  await requireEditor(request, env);
  return jsonResponse({ ok: true });
}

function safeFilename(headerValue) {
  try {
    return decodeURIComponent(headerValue || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180) || 'media';
  } catch {
    return 'media';
  }
}

async function uploadMedia(request, env) {
  await requireEditor(request, env);
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (!Number.isFinite(declaredLength) || declaredLength <= 0) throw new HttpError(411, '缺少有效的文件长度');
  if (declaredLength > MAX_MEDIA_BYTES) throw new HttpError(413, '单个媒体文件不能超过 100MB');
  if (!request.body) throw new HttpError(400, '文件内容为空');
  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].toLowerCase();
  const mediaType = MEDIA_CONTENT_TYPES.get(contentType);
  if (!mediaType) throw new HttpError(415, '仅支持 JPG、PNG、WebP、AVIF、MP4 或 WebM');
  const originalName = safeFilename(request.headers.get('X-Filename'));
  const now = new Date();
  const key = `timeline/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${mediaType.extension}`;
  await env.TIMELINE_MEDIA.put(key, request.body, {
    httpMetadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
      contentDisposition: 'inline',
    },
    customMetadata: { originalName: encodeURIComponent(originalName) },
  });
  return jsonResponse({
    media: {
      key,
      url: canonicalMediaUrl(key),
      type: mediaType.type,
      caption: '',
      name: originalName,
    },
  }, 201);
}

async function serveMedia(request, env, encodedKey) {
  let key;
  try {
    key = decodeURIComponent(encodedKey);
  } catch {
    throw new HttpError(400, '媒体路径无效');
  }
  if (!key.startsWith('timeline/') || key.includes('..')) throw new HttpError(400, '媒体路径无效');
  const object = await env.TIMELINE_MEDIA.get(key, { range: request.headers });
  if (!object) throw new HttpError(404, '媒体不存在');
  const headers = new Headers(timelineHeaders({
    'Cache-Control': object.httpMetadata?.cacheControl || 'public, max-age=86400',
    ETag: object.httpEtag,
    'Accept-Ranges': 'bytes',
  }));
  object.writeHttpMetadata(headers);
  let status = 200;
  if (object.range) {
    let offset = null;
    let length = null;
    if ('offset' in object.range && object.range.length !== undefined) {
      offset = object.range.offset;
      length = object.range.length;
    } else if ('suffix' in object.range) {
      length = Math.min(object.range.suffix, object.size);
      offset = object.size - length;
    }
    if (offset !== null && length !== null && length > 0) {
      status = 206;
      headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
      headers.set('Content-Length', String(length));
    }
  }
  if (status === 200) {
    headers.set('Content-Length', String(object.size));
  }
  return new Response(request.method === 'HEAD' ? null : object.body, { status, headers });
}

function methodNotAllowed() {
  return jsonResponse({ error: '请求方法不支持' }, 405);
}

async function routeTimelineApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: timelineHeaders() });

  if (path === '/timeline/api/login') return request.method === 'POST' ? login(request, env) : methodNotAllowed();
  if (path === '/timeline/api/session') return request.method === 'GET' ? verifySession(request, env) : methodNotAllowed();
  if (path === '/timeline/api/upload') return request.method === 'POST' ? uploadMedia(request, env) : methodNotAllowed();
  if (path.startsWith('/timeline/api/media/')) {
    return request.method === 'GET' || request.method === 'HEAD'
      ? serveMedia(request, env, path.slice('/timeline/api/media/'.length))
      : methodNotAllowed();
  }

  if (path === '/timeline/api/axes') {
    if (request.method === 'GET') return getAxes(env);
    if (request.method === 'POST') return createAxis(request, env);
    return methodNotAllowed();
  }
  const axisMatch = path.match(/^\/timeline\/api\/axes\/(\d+)$/);
  if (axisMatch) {
    const axisId = Number(axisMatch[1]);
    if (request.method === 'PUT') return updateAxis(request, env, axisId);
    if (request.method === 'DELETE') return removeAxis(request, env, axisId);
    return methodNotAllowed();
  }

  if (path === '/timeline/api/events') {
    if (request.method === 'GET') return getEvents(request, env);
    if (request.method === 'POST') return createEvent(request, env);
    return methodNotAllowed();
  }
  const eventMatch = path.match(/^\/timeline\/api\/events\/(\d+)$/);
  if (eventMatch) {
    const eventId = Number(eventMatch[1]);
    if (request.method === 'PUT') return updateEvent(request, env, eventId);
    if (request.method === 'DELETE') return removeEvent(request, env, eventId);
    return methodNotAllowed();
  }

  throw new HttpError(404, 'Timeline API 路由不存在');
}

export async function handleTimelineApi(request, env) {
  try {
    return await routeTimelineApi(request, env);
  } catch (error) {
    if (error instanceof HttpError) return jsonResponse({ error: error.message }, error.status);
    console.error(JSON.stringify({
      message: 'timeline api request failed',
      path: new URL(request.url).pathname,
      error: error instanceof Error ? error.message : String(error),
    }));
    return jsonResponse({ error: '服务器暂时无法处理这个请求' }, 500);
  }
}
