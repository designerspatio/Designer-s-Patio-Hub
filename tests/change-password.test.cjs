const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = stripTypeScriptTypes(fs.readFileSync('src/app/changePassword.ts', 'utf8'), { mode: 'transform' }).replace('export async function', 'async function');
const context = {};
vm.runInNewContext(source, context);
const change = context.changeOwnPassword;
function fixture({ signedIn = true, failure = null, confirmed = true } = {}) {
  const calls = [];
  return { calls, auth: {
    getUser: async () => ({ data: { user: signedIn ? { id: 'current-user' } : null }, error: null }),
    updateUser: async data => { calls.push(data); return { data: { user: confirmed ? { id: 'current-user' } : null }, error: failure }; },
  } };
}
test('rejects short and mismatched passwords without changing authentication', async () => {
  const client = fixture();
  await assert.rejects(change(client, 'short', 'short'), /at least 8/);
  await assert.rejects(change(client, 'password-one', 'password-two'), /do not match/);
  assert.equal(client.calls.length, 0);
});
test('expired sessions cannot submit password updates', async () => {
  const client = fixture({ signedIn: false });
  await assert.rejects(change(client, 'test-password', 'test-password'), /session has expired/);
  assert.equal(client.calls.length, 0);
});
test('updates the signed-in user with only the chosen password', async () => {
  const client = fixture();
  await change(client, 'test-password', 'test-password');
  assert.equal(JSON.stringify(client.calls), JSON.stringify([{ password: 'test-password' }]));
});
test('provider rejection and unconfirmed updates never report success', async () => {
  await assert.rejects(change(fixture({ failure: { message: 'Password is too weak' } }), 'test-password', 'test-password'), /too weak/);
  await assert.rejects(change(fixture({ confirmed: false }), 'test-password', 'test-password'), /not confirmed/);
});
