// Tests de la vérification du défi SEP-45 (node --test). Aucun réseau : on utilise l'exemple officiel de la spécification.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { encoderReponse, verifierDefi } from '../src/services/sep45Defi.ts'

const EXEMPLE = readFileSync(new URL('./fixtures/sep45-challenge.b64', import.meta.url), 'utf8').trim()
const OK = {
  account: 'CCLHBURYO4B2JFU4YBZUQZKJQ2Z3723DPXTWU6YDPXN4TZ3KHVQ7NOUL',
  homeDomain: 'localhost:8080',
  webAuthDomain: 'localhost:8080',
  contrat: 'CCPPXWEQGRRIZK4PVVJBNRU3OPJ4UM276KDJO7IGKEOZKTODLVC5OK6A',
  cleServeur: 'GCHLHDBOKG2JWMJQBTLSL5XG6NO7ESXI2TAQKZXCXWXB5WI2X6W233PR',
}

test('official SEP-45 example challenge is accepted', () => {
  const d = verifierDefi(EXEMPLE, OK)
  assert.equal(d.indexClient, 0)
  assert.equal(d.expiration, 1658461)
})

test('challenge for another account is refused', () => {
  assert.throws(() => verifierDefi(EXEMPLE, { ...OK, account: 'CAMRQX2Y5QZ6OUVYL7H4SL5N2W3XKBDZJ7EYOSHBDJLMYJNWJSU4UDVQ' }), /not for this account/)
})

test('wrong home domain, contract or anchor key is refused', () => {
  assert.throws(() => verifierDefi(EXEMPLE, { ...OK, homeDomain: 'evil.example' }), /home domain/)
  assert.throws(() => verifierDefi(EXEMPLE, { ...OK, contrat: 'CD3LA6RKF5D2FN2R2L57MWXLBRSEWWENE74YBEFZSSGNJRJGICFGQXMX' }), /auth contract/)
  assert.throws(() => verifierDefi(EXEMPLE, { ...OK, cleServeur: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' }), /anchor key/)
})

test('anchor signature checked against the network', () => {
  assert.throws(() => verifierDefi(EXEMPLE, { ...OK, passphrase: 'Public Global Stellar Network ; September 2015' }), /invalid anchor signature/)
})

test('re-encoding without changes gives back the same entries', () => {
  const d = verifierDefi(EXEMPLE, OK)
  assert.equal(encoderReponse(d, d.entrees[0].toXdr('base64')), EXEMPLE)
})
