// Logique serveur partagée (Vercel + serveur de dev Vite) pour MoneyGram Ramps.
// La clé SECRÈTE reste ici. Analogie : le guichetier garde la clé du coffre ; il ne donne un ticket (session)
// qu'à la personne qui prouve, par sa signature, qu'elle possède bien le wallet.
// Le préfixe "_" empêche Vercel d'en faire une route publique.
//
// Protections (toutes côté serveur) :
//  1. Preuve de possession du wallet : défi signé par le serveur (HMAC, 5 min) puis signé par le wallet (ed25519).
//  2. Liste blanche des origines (site de prod, previews Vercel du projet, localhost en dev).
//  3. Limite de débit par adresse et par IP (meilleur effort : mémoire de l'instance).
//  4. Garde-fou sandbox : refus de toute clé qui n'est pas une clé sandbox ; URL de base imposée.
//  5. Réponses minimales, aucun secret dans les logs.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { Keypair, StrKey } from '@stellar/stellar-sdk'

const SANDBOX_API = 'https://playground.xramps.moneygram.com/api'
const CHALLENGE_TTL_MS = 5 * 60 * 1000
const MAX_PER_ADDRESS = 5 // sessions par adresse et par heure
const MAX_PER_IP = 20 // requêtes par IP et par heure
const WINDOW_MS = 60 * 60 * 1000

const fail = (status, error) => ({ status, body: { error } })

/** Origines autorisées : prod + previews de ce projet (variables système Vercel) + liste optionnelle + dev */
export function originAllowed(origin, env, dev = false) {
  if (!origin) return false
  const allowed = new Set(['https://unlockshares.vercel.app'])
  for (const v of [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) if (v) allowed.add(`https://${v}`)
  for (const v of String(env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) allowed.add(v)
  if (dev) { allowed.add('http://localhost:5173'); allowed.add('http://127.0.0.1:5173') }
  return allowed.has(origin)
}

// ---------- limite de débit (meilleur effort : une mémoire par instance serverless) ----------
const hits = new Map()
function tooMany(key, max) {
  const now = Date.now()
  const list = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (list.length >= max) { hits.set(key, list); return true }
  list.push(now)
  hits.set(key, list)
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k)
  return false
}

// ---------- défi signé ----------
const b64url = (b) => Buffer.from(b).toString('base64url')
const mac = (secret, payload) => createHmac('sha256', secret).update(payload).digest()

export function challengeMessage(address, nonce, exp) {
  return `UnlockShares wants to open a MoneyGram session for ${address}.\nNonce: ${nonce}\nExpires: ${new Date(exp).toISOString()}\nSigning this message does not move any funds.`
}

/** Crée un défi pour `address` : le navigateur fera signer `message` par le wallet, puis renverra `token` + la signature. */
export function createChallenge(address, secret, now = Date.now()) {
  if (!secret) return fail(500, 'Server is not configured.')
  if (typeof address !== 'string' || !StrKey.isValidEd25519PublicKey(address)) return fail(400, 'Invalid Stellar address (G...).')
  const nonce = b64url(randomBytes(16))
  const exp = now + CHALLENGE_TTL_MS
  const payload = `${address}.${exp}.${nonce}`
  return { status: 200, body: { token: `${payload}.${b64url(mac(secret, payload))}`, message: challengeMessage(address, nonce, exp) } }
}

/** Vérifie le jeton (HMAC + expiration) et la signature du wallet sur le message du défi. */
export function verifyChallenge(address, token, signature, secret, now = Date.now()) {
  if (!secret) return 'Server is not configured.'
  if (typeof token !== 'string' || typeof signature !== 'string') return 'Missing wallet signature.'
  const parts = token.split('.')
  if (parts.length !== 4) return 'Invalid challenge.'
  const [addr, expStr, nonce, sig] = parts
  if (addr !== address) return 'Challenge does not match this address.'
  const expected = mac(secret, `${addr}.${expStr}.${nonce}`)
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'Invalid challenge.'
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || now > exp) return 'Challenge expired: try again.'
  // Signature du wallet : base64 (Freighter / Varial) ou hex. On accepte le hachage SEP-53 et les variantes anciennes.
  let sigBytes
  try { sigBytes = /^[0-9a-f]{128}$/i.test(signature) ? Buffer.from(signature, 'hex') : Buffer.from(signature, 'base64') } catch { return 'Invalid wallet signature.' }
  if (sigBytes.length !== 64) return 'Invalid wallet signature.'
  const message = challengeMessage(addr, nonce, exp)
  const candidates = [
    createHash('sha256').update(Buffer.concat([Buffer.from('Stellar Signed Message:\n'), Buffer.from(message)])).digest(), // SEP-53
    createHash('sha256').update(message).digest(),
    Buffer.from(message),
  ]
  const kp = Keypair.fromPublicKey(addr)
  return candidates.some((c) => { try { return kp.verify(c, sigBytes) } catch { return false } }) ? null : 'Invalid wallet signature.'
}

/** Point d'entrée commun : contrôle origine + débit + défi, puis ouvre la session MoneyGram. */
export async function handleSession({ origin, ip, body, env, dev = false }) {
  if (!originAllowed(origin, env, dev)) return fail(403, 'Origin not allowed.')
  if (ip && tooMany(`ip:${ip}`, MAX_PER_IP)) return fail(429, 'Too many requests: try again later.')
  const { walletAddress, token, signature } = body ?? {}
  const bad = verifyChallenge(walletAddress, token, signature, env.RAMPS_CHALLENGE_SECRET)
  if (bad) return fail(401, bad)
  if (tooMany(`addr:${walletAddress}`, MAX_PER_ADDRESS)) return fail(429, 'Too many MoneyGram sessions for this wallet: try again in an hour.')
  return openMoneyGramSession(walletAddress, env.MONEYGRAM_SK)
}

export function handleChallenge({ origin, ip, address, env, dev = false }) {
  if (!originAllowed(origin, env, dev)) return fail(403, 'Origin not allowed.')
  if (ip && tooMany(`ip:${ip}`, MAX_PER_IP)) return fail(429, 'Too many requests: try again later.')
  return createChallenge(address, env.RAMPS_CHALLENGE_SECRET)
}

/** Ouvre la session MoneyGram (sandbox uniquement). N'est appelée qu'après handleSession. */
export async function openMoneyGramSession(walletAddress, secretKey) {
  if (!secretKey) return fail(500, 'Server is not configured.')
  if (!secretKey.startsWith('ramps_sk_sbox_')) return fail(500, 'Server is not configured.') // jamais de clé de production sur ce déploiement testnet
  if (typeof walletAddress !== 'string' || !StrKey.isValidEd25519PublicKey(walletAddress)) return fail(400, 'Invalid Stellar address (G...).')
  let r
  try {
    r = await fetch(`${SANDBOX_API}/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': secretKey },
      body: JSON.stringify({ walletAddress, chain: 'stellar' }),
    })
  } catch {
    return fail(502, 'MoneyGram is unreachable.')
  }
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.sessionToken || !j.widgetUrl) return fail(502, 'MoneyGram refused the session.')
  // Strict nécessaire pour le navigateur.
  return { status: 200, body: { sessionToken: j.sessionToken, sessionId: j.sessionId, widgetUrl: j.widgetUrl } }
}
