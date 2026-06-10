// End-to-end functional test for izLearn against the running backend (:4000).
// Idempotent: handles already-changed admin password and pre-existing data.
const BASE = 'http://localhost:4000/api';
let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra = '') { (cond ? pass++ : fail++); results.push(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ' :: ' + extra : ''}`); }

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const ADMIN = 'admin';
const OLD = 'ChangeMe@123';
const NEW = 'NewPass@123';
const SIG = 'Sign@1234';

async function login(pw, terminateExisting = false) {
  return api('POST', '/auth/login', { body: { windowsUsername: ADMIN, password: pw, deviceInfo: 'e2e-runner', terminateExisting } });
}

const run = async () => {
  // Determine the current valid admin password (OLD on first run, NEW afterwards)
  // by logging in with terminateExisting to clear any prior session.
  let r = await login(OLD, true);
  let token, mustChange = false, CUR = OLD;
  if (r.json?.success) { token = r.json.data.accessToken; mustChange = r.json.data.mustChangePassword; }
  if (!token) { r = await login(NEW, true); CUR = NEW; token = r.json?.data?.accessToken; mustChange = r.json?.data?.mustChangePassword; }
  ok('UR-75/83 login after terminating previous session', !!token, 'HTTP ' + r.status);
  if (!token) { console.log(results.join('\n')); return; }

  // Single-session enforcement (UR-81/UR-82): a second login while the session
  // just established is active must be rejected with 409 unless terminateExisting.
  const second = await login(CUR);
  const sessionConflict = second.status === 409 || /SESSION_EXISTS/i.test(JSON.stringify(second.json || ''));
  ok('UR-81/82 single-session conflict detected (409)', sessionConflict, 'HTTP ' + second.status);
  // Re-establish our working token (the conflicting attempt did not replace it).

  // invalid password denied (UR-79) + invalid user denied (UR-78)
  const badPw = await login('wrong-Pass!9');
  ok('UR-79 invalid password denied', badPw.status === 401 || badPw.json?.success === false, 'HTTP ' + badPw.status);
  const badUser = await api('POST', '/auth/login', { body: { windowsUsername: 'nobody_x', password: 'whatever1!' } });
  ok('UR-78 invalid user denied', badUser.json?.success === false, 'HTTP ' + badUser.status);

  if (mustChange) {
    const cp = await api('POST', '/auth/change-password', { token, body: { currentPassword: OLD, newPassword: NEW, confirmPassword: NEW } });
    ok('UR-92 change password (policy enforced)', cp.json?.success === true, 'HTTP ' + cp.status);
    token = (await login(NEW, true)).json?.data?.accessToken;
  }

  // weak password rejected by policy
  const weak = await api('POST', '/auth/change-password', { token, body: { currentPassword: NEW, newPassword: 'weak', confirmPassword: 'weak' } });
  ok('UR-92 weak password rejected', weak.json?.success === false, 'HTTP ' + weak.status);

  // 2. Signature password (UR-66 two-component esign prerequisite)
  const sp = await api('POST', '/auth/set-signature-password', { token, body: { loginPassword: NEW, signaturePassword: SIG, confirmSignaturePassword: SIG } });
  ok('UR-66 set signature password', sp.json?.success === true || sp.status === 200, 'HTTP ' + sp.status);
  const sig = { windowsUsername: ADMIN, signaturePassword: SIG, meaning: 'Approved' };

  // 3. Master data (UR-95, UR-102, UR-103)
  const locs = await api('GET', '/locations?page=1&pageSize=50', { token });
  let locationId = locs.json?.data?.[0]?.id;
  ok('UR-103 list locations', !!locationId, 'HTTP ' + locs.status);
  const newLoc = await api('POST', '/locations', { token, body: { name: 'E2E Site ' + Date.now(), description: 'test' } });
  ok('UR-95 create location', newLoc.json?.success === true, 'HTTP ' + newLoc.status);

  const depts = await api('GET', '/departments?page=1&pageSize=50', { token });
  let departmentId = depts.json?.data?.[0]?.id;
  ok('UR-102 list departments', !!departmentId, 'HTTP ' + depts.status);

  const roles = await api('GET', '/roles?page=1&pageSize=50', { token });
  const traineeRole = roles.json?.data?.find(r => r.roleName === 'TRAINEE') || roles.json?.data?.[0];
  ok('UR-48 list roles', !!traineeRole, 'HTTP ' + roles.status);

  // 4. Training topic — locked topicCode (UR-9, UR-104, UR-17)
  const topic = await api('POST', '/topics', { token, body: { title: 'E2E Topic ' + Date.now(), description: 'd', trainingType: 'CLASSROOM', durationMinutes: 30, passingScorePercent: 50, maxAttempts: 3 } });
  const topicId = topic.json?.data?.id;
  const topicCode = topic.json?.data?.topicCode;
  ok('UR-9 create training topic', !!topicId, 'HTTP ' + topic.status);
  ok('UR-104 topicCode auto-generated & locked', !!topicCode, 'code=' + topicCode);
  // attempt to modify topicCode via update — field is ignored/locked
  const upd = await api('PATCH', '/topics/' + topicId, { token, body: { topicCode: 'HACK-0001', durationMinutes: 45, reasonForChange: 'extend duration' } });
  const after = await api('GET', '/topics/' + topicId, { token });
  ok('UR-104 topicCode immutable after update', after.json?.data?.topicCode === topicCode, 'still ' + after.json?.data?.topicCode);
  ok('UR-17 modify course duration', after.json?.data?.durationMinutes === 45, 'dur=' + after.json?.data?.durationMinutes);

  // 5. Question bank (UR-27, UR-28, UR-31)
  const q = await api('POST', '/questions', { token, body: { topicId, questionText: '2+2=?', questionType: 'MULTIPLE_CHOICE_SINGLE', options: [{ id: 'a', text: '3' }, { id: 'b', text: '4' }], correctAnswer: ['b'], isMandatory: true, explanation: 'basic math' } });
  ok('UR-27/28/31 create mandatory MCQ question', q.json?.success === true, 'HTTP ' + q.status);

  // 6. Create a second user via request + approve (UR-101, UR-88, esign, UR-90)
  const ts = Date.now();
  const ureq = await api('POST', '/users/requests', { token, body: { userType: 'INTERNAL', fullName: 'Trainee E2E', employeeId: 'E2E-' + ts, windowsUsername: 'trainee' + ts, email: 'trainee' + ts + '@example.com', departmentId, locationId, roleIds: [traineeRole.id], remarks: 'e2e' } });
  const requestId = ureq.json?.data?.id;
  ok('UR-101 user creation request (electronic form)', !!requestId, 'HTTP ' + ureq.status);
  // approve requires esign
  const noSig = await api('POST', `/users/requests/${requestId}/decision`, { token, body: { decision: 'APPROVE' } });
  ok('UR-93 approve without esign rejected', noSig.json?.success === false, 'HTTP ' + noSig.status);
  const approve = await api('POST', `/users/requests/${requestId}/decision`, { token, body: { decision: 'APPROVE', signature: sig } });
  ok('UR-88 approve user with esign', approve.json?.success === true, 'HTTP ' + approve.status);
  // find the created user
  const users = await api('GET', '/users?page=1&pageSize=100&includeInactive=true', { token });
  const trainee = users.json?.data?.find(u => u.windowsUsername === 'trainee' + ts);
  const traineeId = trainee?.id;
  ok('UR-77 created user listed', !!traineeId, 'found=' + !!traineeId);

  // 7. Scheduling — trainer/trainee conflict (UR-19, UR-23)
  const meId = (await api('GET', '/auth/me', { token })).json?.data?.id;
  const conflict = await api('POST', '/schedules', { token, body: { topicId, scheduledDate: new Date(Date.now() + 86400000).toISOString(), trainerId: traineeId, trainingType: 'CLASSROOM', traineeIds: [traineeId] } });
  ok('UR-23 trainer-as-trainee conflict rejected (400)', conflict.status === 400 || conflict.json?.success === false, 'HTTP ' + conflict.status);
  const schedule = await api('POST', '/schedules', { token, body: { topicId, scheduledDate: new Date(Date.now() + 86400000).toISOString(), trainerId: meId, trainingType: 'CLASSROOM', venue: 'Room A', traineeIds: [traineeId] } });
  const scheduleId = schedule.json?.data?.id;
  ok('UR-19 create valid schedule (trainer != trainee)', !!scheduleId, 'HTTP ' + schedule.status);

  // 8. Attendance manual (UR-25)
  if (scheduleId) {
    const att = await api('POST', '/attendance', { token, body: { scheduleId, entries: [{ userId: traineeId, status: 'PRESENT' }] } });
    ok('UR-25 mark attendance (manual)', att.json?.success === true, 'HTTP ' + att.status);
  }

  // 9. No future dates (UR-54) — OJT with future date rejected
  const futureOjt = await api('POST', '/schedules/ojt', { token, body: { topicId, userId: traineeId, evaluatorId: meId, evaluationDate: new Date(Date.now() + 86400000).toISOString(), evaluationScore: 80 } });
  ok('UR-54 future date on form rejected', futureOjt.json?.success === false, 'HTTP ' + futureOjt.status);

  // 10. Assessment — start + submit immediate results (UR-26, UR-32, UR-34)
  const start = await api('POST', '/assessments/start', { token, body: { topicId } });
  const attemptId = start.json?.data?.attemptId;
  const questions = start.json?.data?.questions || [];
  ok('UR-26 start assessment (randomized snapshot)', !!attemptId && questions.length > 0, 'qs=' + questions.length);
  if (attemptId) {
    const answers = {}; for (const qq of questions) answers[qq.id] = ['b'];
    const submit = await api('POST', '/assessments/submit', { token, body: { attemptId, answers } });
    const d = submit.json?.data;
    ok('UR-32 immediate results returned', !!d && typeof d.score === 'number', 'score=' + d?.score);
    ok('UR-34 result summary fields present', d && 'correctCount' in d && 'incorrectCount' in d && 'attempted' in d, JSON.stringify({ s: d?.score, c: d?.correctCount }));
  }

  // 11. Audit trail query (UR-137, UR-148, UR-149) + immutability already verified at boot
  const audit = await api('GET', '/audit-trail?page=1&pageSize=10', { token });
  ok('UR-148/149 audit trail searchable', Array.isArray(audit.json?.data) && audit.json.data.length > 0, 'rows=' + (audit.json?.data?.length));

  // 12. Reports export pdf/csv/xls (UR-69, UR-72)
  for (const fmt of ['csv', 'xls', 'pdf']) {
    const rep = await fetch(BASE + '/reports/department-wise-status/export', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ format: fmt, signature: sig }) });
    ok('UR-72 export report ' + fmt, rep.status === 200, 'HTTP ' + rep.status + ' ' + (rep.headers.get('content-type') || ''));
  }

  // 13. Integration stub (UR-170)
  const integ = await api('POST', '/integrations/dms/sync', { token, body: {} });
  ok('UR-170 integration stub returns 501', integ.status === 501, 'HTTP ' + integ.status);

  // 14. Health (UR-165) + audit trigger present (UR-144/160)
  const health = await api('GET', '/health');
  ok('UR-144/160 audit immutability trigger present', health.json?.checks?.auditImmutabilityTrigger === true, JSON.stringify(health.json?.checks));

  console.log('\n================ E2E RESULTS ================');
  console.log(results.join('\n'));
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
};

run().catch(e => { console.error('RUNNER ERROR', e); process.exit(1); });
