import assert from 'node:assert/strict';

const base = process.env.TABLEPEACE_TEST_URL || 'http://localhost:8787';
const people = [{cookie: ''}, {cookie: ''}, {cookie: ''}, {cookie: ''}, {cookie: ''}];
async function call(person, path, method = 'GET', data) {
  const response = await fetch(base + path, {
    method,
    headers: {...(data === undefined ? {} : {'Content-Type': 'application/json'}), ...(person.cookie ? {Cookie: person.cookie} : {})},
    body: data === undefined ? undefined : JSON.stringify(data),
    redirect: 'manual'
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) person.cookie = setCookie.split(';')[0];
  return {status: response.status, data: await response.json()};
}
const owner = people[0];
const [a, b, c, outsider] = people.slice(1);
const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
const at = clock => `${date}T${clock}`;
const options = [
  {title: '咖啡馆', venueLabel: '咖啡馆', startLocal: at('16:00'), durationMinutes: 60, costUnits: 35, noise: 'lively'},
  {title: '图书馆', venueLabel: '图书馆', startLocal: at('16:00'), durationMinutes: 60, costUnits: 0, noise: 'quiet'},
  {title: '创客空间', venueLabel: '创客空间', startLocal: at('18:00'), durationMinutes: 60, costUnits: 20, noise: 'moderate'}
];
const created = await call(owner, '/api/rooms', 'POST', {title: '多人流程测试', description: '', expectedCount: 3, timezone: 'Asia/Shanghai', currency: 'CNY', options});
assert.equal(created.status, 201, JSON.stringify(created.data));
const roomId = created.data.roomId;
const path = `/api/rooms/${roomId}`;
const room = (await call(owner, path)).data;
assert.equal(room.isOrganizer, true);
assert.equal((await call(outsider, `${path}/results`)).status, 403);
for (const [person, name] of [[a, '甲'], [b, '乙'], [c, '丙']]) {
  assert.equal((await call(person, `${path}/join`, 'POST', {nickname: name})).status, 201);
}
assert.equal((await call(outsider, `${path}/join`, 'POST', {nickname: '丁'})).status, 409);
const memberData = [
  {availability: [{startLocal: at('18:00'), endLocal: at('20:00')}], maxBudgetUnits: 20, needsQuiet: true, note: '私人备注甲'},
  {availability: [{startLocal: at('16:00'), endLocal: at('20:00')}], maxBudgetUnits: 20, needsQuiet: false, note: '私人备注乙'},
  {availability: [{startLocal: at('16:00'), endLocal: at('20:00')}], maxBudgetUnits: 50, needsQuiet: true, note: '私人备注丙'}
];
for (let i = 0; i < 3; i++) {
  const response = await call([a, b, c][i], `${path}/me`, 'PUT', {expectedRevision: 0, ...memberData[i], favoriteOptionId: null});
  assert.equal(response.status, 200, JSON.stringify(response.data));
}
assert.equal((await call(a, `${path}/me`, 'PUT', {expectedRevision: 0, ...memberData[0]})).status, 409);
const results = (await call(owner, `${path}/results`)).data;
assert.deepEqual(results.options.map(o => o.blockedMemberCount), [3, 1, 2]);
assert.equal(JSON.stringify(results).includes('私人备注'), false);
assert.equal(JSON.stringify(await call(b, `${path}/me`)).includes('私人备注甲'), false);
const ids = room.options.map(o => o.id);
const request = {baseOptionId: ids[1], venueFromOptionId: ids[1], timeFromOptionId: ids[2]};
const simulation = await call(owner, `${path}/simulate`, 'POST', request);
assert.equal(simulation.status, 200);
assert.equal(simulation.data.after.groupStatus, 'compatible');
assert.equal(simulation.data.after.blockedMemberCount, 0);
const rescued = await call(owner, `${path}/rescue`, 'POST', {...request, expectedRoomRevision: results.roomRevision});
assert.equal(rescued.status, 201, JSON.stringify(rescued.data));
assert.equal((await call(owner, `${path}/rescue`, 'POST', {...request, expectedRoomRevision: results.roomRevision})).status, 409);
const after = (await call(owner, path)).data;
assert.equal(after.options.length, 4);
const venue = await call(owner, `${path}/options/${rescued.data.optionId}/verify-venue`, 'POST', {verified: true, verificationNote: '电话核实 14:00'});
assert.equal(venue.status, 200);
const proposed = await call(owner, `${path}/proposals`, 'POST', {optionId: rescued.data.optionId, expectedRoomRevision: after.revision});
assert.equal(proposed.status, 201, JSON.stringify(proposed.data));
assert.equal((await call(outsider, `${path}/proposals/current`)).status, 403);
for (const [i, person] of [a, b, c].entries()) {
  const response = await call(person, `${path}/proposals/${proposed.data.proposalId}/respond`, 'POST', {decision: 'accept'});
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.status, i === 2 ? 'confirmed' : 'open');
}
const current = (await call(owner, `${path}/proposals/current`)).data;
assert.equal(current.progress.accepted, 3);
assert.equal(current.proposal.option.verified, true);
assert.equal((await call(owner, `${path}/me`)).status, 403);
const changed = await call(a, `${path}/me`, 'PUT', {expectedRevision: 1, ...memberData[0], favoriteOptionId: null});
assert.equal(changed.status, 200);
assert.equal((await call(owner, `${path}/proposals/current`)).data.proposal.status, 'stale');
assert.equal((await call(owner, path, 'DELETE', {})).status, 200);
assert.equal((await call(a, path)).status, 404);
console.log('通过：建房、跨会话加入、隐私、3/1/2 冲突、0 冲突重组、逐人确认、版本失效、删除。');
