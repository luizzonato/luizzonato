import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { verifyFirebaseToken } from '../src/worker.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' };
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const PID = 'edila-test';
const NOW = 1_800_000_000;

function sign(claims, header = { alg: 'RS256', kid: 'k1' }) {
  const body = `${b64(header)}.${b64(claims)}`;
  const sig = createSign('RSA-SHA256').update(body).sign(privateKey).toString('base64url');
  return `${body}.${sig}`;
}
const good = { aud: PID, iss: `https://securetoken.google.com/${PID}`, sub: 'u1', iat: NOW - 10, exp: NOW + 3000, email: 'a@b.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } };

test('aceita token válido', async () => {
  const c = await verifyFirebaseToken(sign(good), PID, NOW, [jwk]);
  assert.equal(c.email, 'a@b.com');
});
for (const [nome, mud] of [
  ['projeto errado', { aud: 'outro' }], ['expirado', { exp: NOW - 1 }],
  ['e-mail não verificado', { email_verified: false }], ['provedor diferente', { firebase: { sign_in_provider: 'password' } }],
]) {
  test(`rejeita ${nome}`, async () => {
    await assert.rejects(verifyFirebaseToken(sign({ ...good, ...mud }), PID, NOW, [jwk]));
  });
}
test('rejeita assinatura adulterada', async () => {
  const t = sign(good).split('.'); t[1] = b64({ ...good, email: 'x@y.com' });
  await assert.rejects(verifyFirebaseToken(t.join('.'), PID, NOW, [jwk]));
});
test('rejeita alg none', async () => {
  await assert.rejects(verifyFirebaseToken(`${b64({ alg: 'none', kid: 'k1' })}.${b64(good)}.`, PID, NOW, [jwk]));
});
