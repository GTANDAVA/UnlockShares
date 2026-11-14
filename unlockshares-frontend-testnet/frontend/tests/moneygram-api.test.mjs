// Tests de sécurité de l'API MoneyGram (node --test). Aucun appel réseau : la clé est absente ou factice.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { Keypair } from '@stellar/stellar-sdk'
import { createChallenge, handleChallenge, handleSession, openMoneyGramSession, originAllowed, verifyChallenge } from '../api/_moneygram.js'

const SECRET = 'test-secret'
const env = { RAMPS_CHALLENGE_SECRET: SECRET, MONEYGRAM_SK: '' }
const sep53 = (m) => createHash('sha256').update(Buffer.concat([Buffer.from('Stellar Signed Message:\n'), Buffer.from(m)])).digest()
const signed = (kp, now) => {
  const c = createChallenge(kp.publicKey(), SECRET, now).body
  return { token: c.token, signature: Buffer.from(kp.sign(sep53(c.message))).toString('base64') }
}

test('valid wallet signature (SEP-53) is accepted', () => {
  const kp = Keypair.random()
  const { token, signature } = signed(kp)
  assert.equal(verifyChallenge(kp.publicKey(), token, signature, SECRET), null)
})

test('signature from another wallet is refused', () => {
  const kp = Keypair.random(), other = Keypair.random()
  const c = createChallenge(kp.publicKey(), SECRET).body
  const sig = Buffer.from(other.sign(sep53(c.message))).toString('base64')
  assert.equal(verifyChallenge(kp.publicKey(), c.token, sig, SECRET), 'Invalid wallet signature.')
})

test('challenge issued for another address is refused', () => {
  const kp = Keypair.random(), other = Keypair.random()
  const { token, signature } = signed(other)
  assert.equal(verifyChallenge(kp.publicKey(), token, signature, SECRET), 'Challenge does not match this address.')
})

test('forged or tampered token is refused', () => {
  const kp = Keypair.random()
  const { token, signature } = signed(kp)
  const parts = token.split('.')
  parts[1] = String(Number(parts[1]) + 3_600_000) // prolonge l'expiration sans connaître le secret
  assert.equal(verifyChallenge(kp.publicKey(), parts.join('.'), signature, SECRET), 'Invalid challenge.')
  assert.equal(verifyChallenge(kp.publicKey(), token, signature, 'other-secret'), 'Invalid challenge.')
})

test('expired challenge is refused', () => {
  const kp = Keypair.random()
  const { token, signature } = signed(kp, Date.now() - 10 * 60 * 1000)
  assert.equal(verifyChallenge(kp.publicKey(), token, signature, SECRET), 'Challenge expired: try again.')
})

test('missing secret or signature is refused', () => {
  const kp = Keypair.random()
  assert.equal(createChallenge(kp.publicKey(), '').status, 500)
  assert.equal(verifyChallenge(kp.publicKey(), undefined, undefined, SECRET), 'Missing wallet signature.')
})

test('origin allowlist', () => {
  assert.equal(originAllowed('https://unlockshares.vercel.app', {}), true)
  assert.equal(originAllowed('https://evil.example', {}), false)
  assert.equal(originAllowed(undefined, {}), false)
  assert.equal(originAllowed('http://localhost:5173', {}), false)
  assert.equal(originAllowed('http://localhost:5173', {}, true), true)
  assert.equal(originAllowed('https://unlockshares-git-x.vercel.app', { VERCEL_BRANCH_URL: 'unlockshares-git-x.vercel.app' }), true)
})

test('session endpoint: unknown origin → 403, no signature → 401', async () => {
  const kp = Keypair.random()
  assert.equal((await handleSession({ origin: 'https://evil.example', body: { walletAddress: kp.publicKey() }, env })).status, 403)
  assert.equal((await handleSession({ origin: 'https://unlockshares.vercel.app', body: { walletAddress: kp.publicKey() }, env })).status, 401)
  assert.equal(handleChallenge({ origin: 'https://evil.example', address: kp.publicKey(), env }).status, 403)
})

test('rate limit per wallet after 5 sessions', async () => {
  const kp = Keypair.random()
  let last
  for (let i = 0; i < 6; i++) last = await handleSession({ origin: 'https://unlockshares.vercel.app', body: { walletAddress: kp.publicKey(), ...signed(kp) }, env })
  assert.equal(last.status, 429)
})

test('non-sandbox key is never used', async () => {
  const kp = Keypair.random()
  assert.equal((await openMoneyGramSession(kp.publicKey(), 'ramps_sk_prod_xxx')).status, 500)
  assert.equal((await openMoneyGramSession(kp.publicKey(), '')).status, 500)
})
