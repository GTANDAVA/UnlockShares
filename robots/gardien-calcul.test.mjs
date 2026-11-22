import assert from 'node:assert/strict'
import { test } from 'node:test'
import { choisirRemboursement, restePlafond } from './gardien-calcul.mjs'

const U = 10_000_000n
const pos = (ltv, dette, valeur, jeton = 'A') => ({ jeton, dette: BigInt(dette) * U, valeur: BigInt(valeur) * U, ltv_bps: BigInt(ltv) })

test('a safe loan is left alone', () => {
  assert.equal(choisirRemboursement([pos(5000, 50, 100)], 20n * U, 100n * U), null)
})

test('a loan at 75 % is brought back to 60 %', () => {
  const r = choisirRemboursement([pos(7500, 75, 100)], 50n * U, 100n * U)
  assert.equal(r.montant, 15n * U)
})

test('the daily limit and the wallet balance cap the repayment', () => {
  assert.equal(choisirRemboursement([pos(7500, 75, 100)], 10n * U, 100n * U).montant, 10n * U)
  assert.equal(choisirRemboursement([pos(7500, 75, 100)], 50n * U, 4n * U).montant, 4n * U)
  const r = choisirRemboursement([pos(7500, 75, 100)], 0n, 100n * U)
  assert.equal(r.montant, 0n)
  assert.match(r.raison, /plafond/)
})

test('the riskiest loan goes first', () => {
  assert.equal(choisirRemboursement([pos(7200, 72, 100, 'A'), pos(7900, 79, 100, 'B')], 50n * U, 100n * U).jeton, 'B')
})

test('the daily limit resets after one period', () => {
  const etat = { plafond: 20n * U, debut: 1000, depense: 15n * U }
  assert.equal(restePlafond(etat, 17280, 2000), 5n * U)
  assert.equal(restePlafond(etat, 17280, 18280), 20n * U)
  assert.equal(restePlafond(null, 17280, 2000), 0n)
})
