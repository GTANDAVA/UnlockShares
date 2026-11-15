// Tests de /api/prix (node --test). Aucun appel réseau : Yahoo est simulé.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lirePrix } from '../api/_prix.js'

const yahoo = (meta, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: async () => ({ chart: { result: [{ meta }] } }) })

test('BlackBerry price is read from Yahoo', async () => {
  const out = await lirePrix('BB', yahoo({ symbol: 'BB', currency: 'USD', regularMarketPrice: 4.12, regularMarketTime: 1763150400 }))
  assert.deepEqual(out, { status: 200, body: { symbol: 'BB', price: 4.12, time: 1763150400 } })
})

test('unknown symbol is refused without calling Yahoo', async () => {
  let appele = false
  const out = await lirePrix('TSLA', async () => { appele = true })
  assert.equal(out.status, 400)
  assert.equal(appele, false)
})

test('wrong ticker, wrong currency or empty price is refused', async () => {
  assert.equal((await lirePrix('BB', yahoo({ symbol: 'BBRY', currency: 'USD', regularMarketPrice: 4 }))).status, 502)
  assert.equal((await lirePrix('BB', yahoo({ symbol: 'BB', currency: 'CAD', regularMarketPrice: 4 }))).status, 502)
  assert.equal((await lirePrix('BB', yahoo({ symbol: 'BB', currency: 'USD', regularMarketPrice: 0 }))).status, 502)
})

test('Yahoo down gives a clean error', async () => {
  assert.equal((await lirePrix('BB', yahoo({}, false))).status, 502)
  assert.equal((await lirePrix('BB', async () => { throw new Error('réseau') })).status, 502)
})
