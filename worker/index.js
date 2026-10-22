const COOKIE = 'tp_sid';
const DAY = 86400;
const REASONS = ['TIME_CONFLICT', 'OVER_BUDGET', 'NOT_QUIET', 'TIME_UNSPECIFIED', 'BUDGET_UNSPECIFIED', 'QUIET_REQUIREMENT_UNSPECIFIED', 'VENUE_NOISE_UNVERIFIED'];

class ApiError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) { throw new ApiError(code, message, status); }
function now() { return new Date().toISOString(); }
function id() { return crypto.randomUUID().replaceAll('-', '').slice(0, 16); }
function trim(value) { return String(value ?? '').trim(); }
function required(value, label, limit) {
  const s = trim(value);
  if (!s || s.length > limit) fail('VALIDATION_ERROR', `${label}不能为空，最多 ${limit} 字。`);
  return s;
}
function optional(value, label, limit) {
  const s = trim(value);
  if (s.length > limit) fail('VALIDATION_ERROR', `${label}最多 ${limit} 字。`);
  return s;
}
function integer(value, label, min = 0, max = 100000) {
  const s = String(value);
  const n = Number(value);
  if (!Number.isInteger(n) || s !== String(n) || n < min || n > max || typeof value === 'boolean')
    fail('VALIDATION_ERROR', `${label}须为 ${min}–${max} 的整数。`);
  return n;
}
function local(value, zone) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))
    fail('VALIDATION_ERROR', '请选择有效的本地日期和时间。');
  const [y, m, d, h, minute] = value.match(/\d+/g).map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, h, minute));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || date.getUTCHours() !== h || date.getUTCMinutes() !== minute)
    fail('VALIDATION_ERROR', '请选择有效的本地日期和时间。');
  // Detect skipped wall-clock times in IANA zones. Ambiguous repeated times use the first occurrence.
  const formatter = new Intl.DateTimeFormat('sv-SE', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
  let found = false;
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    if (formatter.format(new Date(date.getTime() - offset * 60000)).replace(' ', 'T') === value) { found = true; break; }
  }
  if (!found) fail('VALIDATION_ERROR', '该时区不存在这个本地时间。');
  return date;
}
function addMinutes(value, minutes) {
  return new Date(Date.parse(`${value}:00Z`) + minutes * 60000).toISOString().slice(0, 16);
}
function optionInput(item, zone) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) fail('VALIDATION_ERROR', '方案格式无效。');
  const title = required(item.title, '方案名称', 60);
  const venue = required(item.venueLabel, '地点或活动', 80);
  const startLocal = trim(item.startLocal);
  local(startLocal, zone);
  const duration = integer(item.durationMinutes, '时长', 30, 120);
  if (![30, 60, 90, 120].includes(duration)) fail('VALIDATION_ERROR', '时长须为 30、60、90 或 120 分钟。');
  if (addMinutes(startLocal, duration).slice(0, 10) !== startLocal.slice(0, 10)) fail('VALIDATION_ERROR', '方案须在当天结束。');
  const cost = integer(item.costUnits, '人均费用');
  if (!['quiet', 'moderate', 'lively', 'unknown'].includes(item.noise)) fail('VALIDATION_ERROR', '请选择环境类型。');
  return {id: id(), title, venue, startLocal, duration, cost, noise: item.noise, source: 'initial', verified: false, verificationNote: ''};
}
function optionPublic(o) {
  return {id: o.id, title: o.title, venueLabel: o.venue, startLocal: o.startLocal, durationMinutes: o.duration, costUnits: o.cost, noise: o.noise, source: o.source, verified: o.verified, verificationNote: o.verificationNote};
}
function memberPublic(m) {
  return {id: m.id, nickname: m.nickname, availability: m.availability, maxBudgetUnits: m.maxBudget, needsQuiet: m.needsQuiet, favoriteOptionId: m.favoriteId, note: m.note, revision: m.revision, submittedAt: m.submittedAt};
}
function evaluate(o, m) {
  if (!m || !m.submittedAt) return {status: 'pending', reasons: []};
  const reasons = [], unknown = [];
  const end = addMinutes(o.startLocal, o.duration);
  if (!m.availability.length) unknown.push('TIME_UNSPECIFIED');
  else if (!m.availability.some(w => w.startLocal <= o.startLocal && end <= w.endLocal)) reasons.push('TIME_CONFLICT');
  if (o.cost > 0 && m.maxBudget === null) unknown.push('BUDGET_UNSPECIFIED');
  else if (m.maxBudget !== null && o.cost > m.maxBudget) reasons.push('OVER_BUDGET');
  if (m.needsQuiet === null) unknown.push('QUIET_REQUIREMENT_UNSPECIFIED');
  else if (m.needsQuiet && o.noise === 'unknown') unknown.push('VENUE_NOISE_UNVERIFIED');
  else if (m.needsQuiet && o.noise !== 'quiet') reasons.push('NOT_QUIET');
  return {status: reasons.length ? 'blocked' : unknown.length ? 'needs_info' : 'compatible', reasons: [...reasons, ...unknown]};
}
function aggregate(o, r) {
  const assessments = r.members.map(m => evaluate(o, m));
  const submitted = r.members.filter(m => m.submittedAt).length;
  const blocked = assessments.filter(a => a.status === 'blocked').length;
  const unknown = assessments.filter(a => a.status === 'needs_info').length;
  const pending = r.expectedCount - submitted;
  return {optionId: o.id, groupStatus: blocked ? 'blocked' : pending ? 'pending' : unknown ? 'needs_info' : 'compatible', blockedMemberCount: blocked, unknownMemberCount: unknown, pendingMemberCount: pending, checkedParticipantCount: submitted, requiredParticipantCount: r.expectedCount, favoriteCount: r.members.filter(m => m.submittedAt && m.favoriteId === o.id).length, reasonCounts: Object.fromEntries(REASONS.map(code => [code, assessments.filter(a => a.reasons.includes(code)).length]))};
}
function requireAccess(member, owner) { if (!member && !owner) fail('NOT_AUTHORIZED', '加入房间后才能查看汇总。', 403); }
function requireOwner(owner) { if (!owner) fail('NOT_ORGANIZER', '只有组织者可以操作。', 403); }
function requireMember(member) { if (!member) fail('NOT_A_MEMBER', '请先加入房间。', 403); }
function requireOpen(r) { if (r.closed) fail('ROOM_CLOSED', '房间已关闭。', 409); }
function invalidate(r) { r.revision++; if (r.proposal && ['open', 'confirmed', 'declined'].includes(r.proposal.status)) r.proposal.status = 'stale'; }
function currentProposal(r, member) {
  const p = r.proposal;
  if (!p) return {proposal: null};
  const responses = p.responses || {};
  const values = Object.values(responses);
  const accepted = values.filter(v => v === 'accept').length;
  const declined = values.filter(v => v === 'decline').length;
  return {proposal: {id: p.id, option: optionPublic(r.options.find(o => o.id === p.optionId)), status: p.roomRevision === r.revision ? p.status : 'stale', roomRevision: p.roomRevision, createdAt: p.createdAt}, progress: {accepted, declined, pending: Math.max(0, r.expectedCount - accepted - declined), required: r.expectedCount}, myDecision: member ? responses[member.id] || null : null};
}
function simulate(r, data) {
  const base = r.options.find(o => o.id === data.baseOptionId);
  const venue = r.options.find(o => o.id === data.venueFromOptionId);
  const when = r.options.find(o => o.id === data.timeFromOptionId);
  if (!base || !venue || !when) fail('VALIDATION_ERROR', '请选择有效的基准、地点和时间。');
  if (base.startLocal.slice(0, 10) !== when.startLocal.slice(0, 10)) fail('VALIDATION_ERROR', '请选择同一天的时间。');
  const candidate = {id: 'simulation', title: `${venue.venue} · ${when.startLocal.slice(11)}`, venue: venue.venue, startLocal: when.startLocal, duration: base.duration, cost: venue.cost, noise: venue.noise, source: 'rescue', verified: false, verificationNote: ''};
  const signature = o => [o.venue, o.startLocal, o.duration, o.cost, o.noise].join('\u0000');
  if (signature(candidate) === signature(base)) fail('NO_CHANGE', '请选择不同的地点或时间。', 422);
  if (r.options.some(o => signature(candidate) === signature(o))) fail('DUPLICATE_OPTION', '该方案已存在。', 422);
  local(candidate.startLocal, r.timezone);
  if (addMinutes(candidate.startLocal, candidate.duration).slice(0, 10) !== candidate.startLocal.slice(0, 10)) fail('VALIDATION_ERROR', '该方案会跨到次日。');
  return {candidate, before: aggregate(base, r), after: aggregate(candidate, r)};
}
function json(data, status = 200, cookie) {
  const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};
  if (cookie) headers['Set-Cookie'] = `${COOKIE}=${cookie}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * DAY}`;
  return new Response(JSON.stringify(data), {status, headers});
}
async function hash(token) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function body(request) {
  if (request.headers.get('Origin') && request.headers.get('Origin') !== new URL(request.url).origin) fail('FORBIDDEN_ORIGIN', '不允许跨站修改。', 403);
  if ((request.headers.get('Content-Type') || '').split(';')[0] !== 'application/json') fail('VALIDATION_ERROR', '请发送 JSON。', 415);
  const raw = await request.text();
  if (raw.length > 32768) fail('VALIDATION_ERROR', '请求内容过大。', 413);
  let data;
  try { data = JSON.parse(raw); } catch { fail('VALIDATION_ERROR', 'JSON 格式无效。'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('VALIDATION_ERROR', 'JSON 格式无效。');
  return data;
}
async function load(db, roomId) {
  const row = await db.prepare('SELECT data, version FROM rooms WHERE id = ?').bind(roomId).first();
  if (!row) fail('ROOM_NOT_FOUND', '找不到这个房间。', 404);
  return {r: JSON.parse(row.data), version: row.version};
}
async function save(db, r, version) {
  const result = await db.prepare('UPDATE rooms SET data = ?, version = version + 1 WHERE id = ? AND version = ?').bind(JSON.stringify(r), r.id, version).run();
  if (!result.meta.changes) fail('STALE_REVISION', '房间已有新变化，请刷新后再试。', 409);
}
function findMember(r, sessionHash) { return r.members.find(m => m.sessionHash === sessionHash); }

async function api(request, env, path) {
  const method = request.method;
  const parts = path.split('/').filter(Boolean);
  if (method === 'GET' && path === '/api/health') return json({ok: true});
  const writing = ['POST', 'PUT', 'DELETE'].includes(method);
  const data = writing ? await body(request) : {};
  const cookieToken = (request.headers.get('Cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  let token = cookieToken && /^[A-Za-z0-9_-]{32,100}$/.test(cookieToken) ? cookieToken : null;
  let newCookie = null;
  if (!token && writing) { token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''); newCookie = token; }
  const sessionHash = token ? await hash(token) : null;
  if (method === 'POST' && path === '/api/rooms') {
    const title = required(data.title, '决策名称', 80);
    const description = optional(data.description, '描述', 280);
    const timezone = required(data.timezone, '时区', 64);
    try { new Intl.DateTimeFormat('en', {timeZone: timezone}); } catch { fail('VALIDATION_ERROR', '请选择有效时区。'); }
    if (!['CNY', 'USD'].includes(data.currency)) fail('VALIDATION_ERROR', '请选择 CNY 或 USD。');
    const expectedCount = integer(data.expectedCount, '参与人数', 3, 8);
    if (!Array.isArray(data.options) || data.options.length < 2 || data.options.length > 4) fail('VALIDATION_ERROR', '请添加 2–4 个方案。');
    const options = data.options.map(o => optionInput(o, timezone));
    if (new Set(options.map(o => o.startLocal.slice(0, 10))).size !== 1) fail('VALIDATION_ERROR', '所有方案须在同一天。');
    const roomId = id();
    const r = {id: roomId, title, description, timezone, currency: data.currency, expectedCount, ownerHash: sessionHash, revision: 0, closed: false, createdAt: now(), options, members: [], proposal: null};
    await env.DB.prepare('INSERT INTO rooms (id, data, created_at) VALUES (?, ?, ?)').bind(roomId, JSON.stringify(r), r.createdAt).run();
    return json({roomId, inviteUrl: `/r/${roomId}`}, 201, newCookie);
  }
  if (parts.length < 3 || parts[0] !== 'api' || parts[1] !== 'rooms') fail('NOT_FOUND', '找不到此接口。', 404);
  const roomId = parts[2];
  const {r, version} = await load(env.DB, roomId);
  const member = findMember(r, sessionHash);
  const owner = Boolean(sessionHash && r.ownerHash === sessionHash);
  const tail = parts.slice(3);
  const result = (value, status = 200) => json(value, status, newCookie);
  if (!tail.length && method === 'GET') return result({id: r.id, title: r.title, description: r.description, timezone: r.timezone, currency: r.currency, expectedCount: r.expectedCount, closed: r.closed, revision: r.revision, isOrganizer: owner, isMember: Boolean(member), myMemberId: member?.id || null, myNickname: member?.nickname || null, joinedCount: owner || member ? r.members.length : null, submittedCount: owner || member ? r.members.filter(m => m.submittedAt).length : null, options: r.options.map(optionPublic)});
  if (tail.join('/') === 'join' && method === 'POST') {
    if (member) return result({participantId: member.id, nextUrl: `/r/${roomId}/me`});
    requireOpen(r);
    const nickname = required(data.nickname, '昵称', 32);
    if (r.members.length >= r.expectedCount) fail('ROOM_FULL', '房间人数已满。', 409);
    const idValue = id();
    r.members.push({id: idValue, sessionHash, nickname, availability: [], maxBudget: null, needsQuiet: null, favoriteId: null, note: '', revision: 0, submittedAt: null});
    await save(env.DB, r, version);
    return result({participantId: idValue, nextUrl: `/r/${roomId}/me`}, 201);
  }
  if (tail.join('/') === 'me' && method === 'GET') { requireMember(member); return result(memberPublic(member)); }
  if (tail.join('/') === 'me' && method === 'PUT') {
    requireMember(member); requireOpen(r);
    if (integer(data.expectedRevision, '版本') !== member.revision) fail('STALE_REVISION', '你的要求已在别处变更，请刷新。', 409);
    const windows = data.availability ?? [];
    if (!Array.isArray(windows) || windows.length > 8) fail('VALIDATION_ERROR', '最多添加 8 个时间段。');
    const roomDate = r.options[0].startLocal.slice(0, 10);
    const clean = windows.map(w => {
      if (!w || typeof w !== 'object' || Array.isArray(w)) fail('VALIDATION_ERROR', '时间段无效。');
      const startLocal = trim(w.startLocal), endLocal = trim(w.endLocal);
      local(startLocal, r.timezone); local(endLocal, r.timezone);
      if (startLocal >= endLocal || startLocal.slice(0, 10) !== roomDate || endLocal.slice(0, 10) !== roomDate) fail('BAD_TIME_WINDOW', '时间段须在房间日期内。', 422);
      return {startLocal, endLocal};
    });
    const maxBudget = data.maxBudgetUnits == null || data.maxBudgetUnits === '' ? null : integer(data.maxBudgetUnits, '预算');
    const needsQuiet = data.needsQuiet;
    if (needsQuiet !== null && typeof needsQuiet !== 'boolean') fail('VALIDATION_ERROR', '请选择环境要求。');
    const favoriteId = data.favoriteOptionId || null;
    if (favoriteId && !r.options.some(o => o.id === favoriteId)) fail('VALIDATION_ERROR', '请选择有效的偏好方案。');
    member.availability = clean; member.maxBudget = maxBudget; member.needsQuiet = needsQuiet; member.favoriteId = favoriteId; member.note = optional(data.note, '备注', 300); member.revision++; member.submittedAt = now();
    invalidate(r); await save(env.DB, r, version);
    return result({revision: member.revision, submittedAt: member.submittedAt});
  }
  if (tail.join('/') === 'results' && method === 'GET') {
    requireAccess(member, owner);
    return result({expectedCount: r.expectedCount, joinedCount: r.members.length, submittedCount: r.members.filter(m => m.submittedAt).length, roomRevision: r.revision, options: r.options.map(o => aggregate(o, r))});
  }
  if (tail.join('/') === 'simulate' && method === 'POST') {
    requireAccess(member, owner);
    const {candidate, before, after} = simulate(r, data);
    return result({option: optionPublic(candidate), before, after, venueVerified: false});
  }
  if (tail.join('/') === 'rescue' && method === 'POST') {
    requireOwner(owner); requireOpen(r);
    if (integer(data.expectedRoomRevision, '版本') !== r.revision) fail('STALE_REVISION', '房间已有新变化，请刷新。', 409);
    if (r.options.length >= 8) fail('VALIDATION_ERROR', '房间最多 8 个方案。');
    const {candidate} = simulate(r, data);
    candidate.id = id(); r.options.push(candidate); invalidate(r); await save(env.DB, r, version);
    return result({optionId: candidate.id}, 201);
  }
  if (tail.join('/') === 'proposals' && method === 'POST') {
    requireOwner(owner); requireOpen(r);
    if (integer(data.expectedRoomRevision, '版本') !== r.revision) fail('STALE_REVISION', '房间已有新变化，请刷新。', 409);
    const option = r.options.find(o => o.id === data.optionId);
    if (!option) fail('VALIDATION_ERROR', '请选择已保存方案。');
    const a = aggregate(option, r);
    if (a.pendingMemberCount) fail('WAITING_FOR_MEMBERS', '等待全部参与者提交要求。', 422);
    if (a.groupStatus !== 'compatible') fail('NOT_FEASIBLE', '该方案不满足全部已记录要求。', 422);
    const proposalId = id();
    r.proposal = {id: proposalId, optionId: option.id, roomRevision: r.revision, status: 'open', createdAt: now(), responses: {}};
    await save(env.DB, r, version);
    return result({proposalId}, 201);
  }
  if (tail.join('/') === 'proposals/current' && method === 'GET') { requireAccess(member, owner); return result(currentProposal(r, member)); }
  if (tail.length === 3 && tail[0] === 'proposals' && tail[2] === 'respond' && method === 'POST') {
    requireMember(member); requireOpen(r);
    const p = r.proposal;
    if (!p || p.id !== tail[1] || !['open', 'declined'].includes(p.status) || p.roomRevision !== r.revision) fail('STALE_PROPOSAL', '方案已变更，请查看最新提议。', 409);
    if (!['accept', 'decline'].includes(data.decision)) fail('VALIDATION_ERROR', '请选择同意或拒绝。');
    p.responses[member.id] = data.decision;
    const progress = currentProposal(r, member).progress;
    const a = aggregate(r.options.find(o => o.id === p.optionId), r);
    p.status = progress.accepted === r.expectedCount && a.groupStatus === 'compatible' ? 'confirmed' : progress.declined ? 'declined' : 'open';
    await save(env.DB, r, version);
    return result({status: p.status, progress});
  }
  if (tail.length === 3 && tail[0] === 'options' && tail[2] === 'verify-venue' && method === 'POST') {
    requireOwner(owner);
    const option = r.options.find(o => o.id === tail[1]);
    if (!option) fail('VALIDATION_ERROR', '请选择已保存方案。');
    if (typeof data.verified !== 'boolean') fail('VALIDATION_ERROR', '请选择核验状态。');
    const note = optional(data.verificationNote, '核验备注', 200);
    if (data.verified && !note) fail('VALIDATION_ERROR', '请记录核验方式和时间。');
    option.verified = data.verified; option.verificationNote = note;
    await save(env.DB, r, version);
    return result({verified: option.verified, verificationNote: note});
  }
  if (tail.join('/') === 'close' && method === 'POST') {
    requireOwner(owner);
    if (typeof data.closed !== 'boolean') fail('VALIDATION_ERROR', '请选择房间状态。');
    r.closed = data.closed; await save(env.DB, r, version);
    return result({closed: r.closed});
  }
  if (!tail.length && method === 'DELETE') {
    requireOwner(owner);
    const removed = await env.DB.prepare('DELETE FROM rooms WHERE id = ? AND version = ?').bind(roomId, version).run();
    if (!removed.meta.changes) fail('STALE_REVISION', '房间已有新变化，请刷新。', 409);
    return result({deleted: true});
  }
  fail('NOT_FOUND', '找不到此接口。', 404);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    try { return await api(request, env, path); }
    catch (error) {
      if (error instanceof ApiError) return json({error: {code: error.code, message: error.message, fieldErrors: {}}}, error.status);
      console.error(error);
      return json({error: {code: 'SERVER_ERROR', message: '服务暂时出错，请稍后再试。', fieldErrors: {}}}, 500);
    }
  }
};
