// Tests du relais de frais /api/relais (node --test). Aucun appel réseau : RPC et OpenZeppelin sont simulés.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Account, Address, BASE_FEE, Contract, Keypair, Networks, TransactionBuilder, nativeToScVal, xdr } from '@stellar/stellar-sdk'
import { CIBLES, DEPLOYEUR, WALLET_WASM, soumettre, traiter, verifier } from '../api/_relais.js'

const PRET = Object.keys(CIBLES)[0]
const COMPTE = 'CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F' // une adresse C… quelconque
const AUTRE_CONTRAT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const env = { OZ_CHANNELS_KEY: 'cle-test' }
const ORIGIN = 'https://unlockshares.vercel.app'
const bonWasm = async () => WALLET_WASM

const appel = (contrat, fn, qui = COMPTE) =>
  new TransactionBuilder(new Account(DEPLOYEUR, '0'), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(contrat).call(fn, new Address(qui).toScVal(), nativeToScVal(10n, { type: 'i128' })))
    .setTimeout(30).build().operations[0].func
const b64 = (o) => o.toXDR('base64')

function autorisation(qui, contrat = PRET, fn = 'emprunter') {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
      address: new Address(qui).toScAddress(), nonce: 1n, signatureExpirationLedger: 100, signature: xdr.ScVal.scvVoid(),
    })),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({
        contractAddress: new Address(contrat).toScAddress(), functionName: fn, args: [],
      })),
      subInvocations: [],
    }),
  })
}

function deploiement(deployeur = DEPLOYEUR, wasm = WALLET_WASM) {
  return xdr.HostFunction.hostFunctionTypeCreateContractV2(new xdr.CreateContractArgsV2({
    contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(new xdr.ContractIdPreimageFromAddress({
      address: new Address(deployeur).toScAddress(), salt: Buffer.alloc(32, 7),
    })),
    executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(wasm, 'hex')),
    constructorArgs: [],
  }))
}

test('a passkey account calling our loan contract is accepted', async () => {
  const funcHost = appel(PRET, 'emprunter')
  const v = await verifier({ func: b64(funcHost), auth: [b64(autorisation(COMPTE))] }, bonWasm)
  assert.deepEqual(v, { creation: false, compte: COMPTE })
})

test('another contract or an admin function is refused', async () => {
  let v = await verifier({ func: b64(appel(AUTRE_CONTRAT, 'transfer')), auth: [b64(autorisation(COMPTE))] }, bonWasm)
  assert.equal(v.status, 403)
  v = await verifier({ func: b64(appel(PRET, 'retirer_reserve')), auth: [b64(autorisation(COMPTE))] }, bonWasm)
  assert.equal(v.status, 403)
})

test('a classic account (G…) or an unknown wallet code is not sponsored', async () => {
  const g = Keypair.random().publicKey()
  let v = await verifier({ func: b64(appel(PRET, 'emprunter', g)), auth: [b64(autorisation(g))] }, bonWasm)
  assert.equal(v.status, 403)
  v = await verifier({ func: b64(appel(PRET, 'emprunter')), auth: [b64(autorisation(COMPTE))] }, async () => 'ab'.repeat(32))
  assert.equal(v.status, 403)
})

test('a source-account authorization is refused (it would engage the fee payer)', async () => {
  const e = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: autorisation(COMPTE).rootInvocation,
  })
  const v = await verifier({ func: b64(appel(PRET, 'emprunter')), auth: [b64(e)] }, bonWasm)
  assert.equal(v.status, 403)
})

test('creating the official passkey account is accepted, any other code is refused', async () => {
  const ok = await verifier({ func: b64(deploiement()), auth: [b64(autorisation(DEPLOYEUR))] }, bonWasm)
  assert.deepEqual(ok, { creation: true })
  const autreCode = await verifier({ func: b64(deploiement(DEPLOYEUR, 'cd'.repeat(32))), auth: [b64(autorisation(DEPLOYEUR))] }, bonWasm)
  assert.equal(autreCode.status, 403)
  const autreDeployeur = Keypair.random().publicKey()
  const v = await verifier({ func: b64(deploiement(autreDeployeur)), auth: [b64(autorisation(autreDeployeur))] }, bonWasm)
  assert.equal(v.status, 403)
})

test('the V2 address authorization format is accepted too', async () => {
  const v1 = autorisation(COMPTE)
  const e = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(v1.credentials.address),
    rootInvocation: v1.rootInvocation,
  })
  const v = await verifier({ func: b64(appel(PRET, 'emprunter')), auth: [b64(e)] }, bonWasm)
  assert.deepEqual(v, { creation: false, compte: COMPTE })
})

test('garbage, empty auth or too many entries are refused', async () => {
  assert.equal((await verifier({ func: 'pas-du-xdr', auth: ['x'] }, bonWasm)).status, 400)
  assert.equal((await verifier({ func: b64(appel(PRET, 'emprunter')), auth: [] }, bonWasm)).status, 400)
  const a = b64(autorisation(COMPTE))
  assert.equal((await verifier({ func: b64(appel(PRET, 'emprunter')), auth: [a, a, a, a] }, bonWasm)).status, 400)
})

test('wrong origin or missing key: nothing is sent', async () => {
  let envoye = false
  const fetchFn = async () => { envoye = true }
  const body = { func: b64(appel(PRET, 'emprunter')), auth: [b64(autorisation(COMPTE))] }
  assert.equal((await traiter({ origin: 'https://evil.example', ip: '1', body, env, wasmDe: bonWasm, fetchFn })).status, 403)
  assert.equal((await traiter({ origin: ORIGIN, ip: '2', body, env: {}, wasmDe: bonWasm, fetchFn })).status, 503)
  assert.equal(envoye, false)
})

test('accepted call is forwarded to OpenZeppelin Channels with the key, and the hash comes back', async () => {
  let recu
  const fetchFn = async (url, init) => {
    recu = { url, init }
    return { ok: true, status: 200, json: async () => ({ success: true, data: { transactionId: 't1', hash: 'h1', status: 'confirmed' } }) }
  }
  const body = { func: b64(appel(PRET, 'emprunter')), auth: [b64(autorisation(COMPTE))] }
  const out = await traiter({ origin: ORIGIN, ip: '3', body, env, wasmDe: bonWasm, fetchFn })
  assert.equal(out.status, 200)
  assert.deepEqual(out.body, { success: true, data: { transactionId: 't1', hash: 'h1', status: 'confirmed' } })
  assert.equal(recu.url, 'https://channels.openzeppelin.com/testnet/')
  assert.equal(recu.init.headers.Authorization, 'Bearer cle-test')
  assert.deepEqual(JSON.parse(recu.init.body), { params: body })
})

test('relay failure gives a clean error', async () => {
  const fetchFn = async () => ({ ok: false, status: 400, json: async () => ({ success: false, error: 'SIMULATION_FAILED' }) })
  const out = await soumettre('f', ['a'], 'k', fetchFn)
  assert.equal(out.status, 502)
  assert.equal(out.body.error, 'SIMULATION_FAILED')
})

// Retrait vers un anchor (compte passkey → adresse M… de l'anchor, en USDC)
import { MAX_RETRAIT_ANCHOR, USDC_SAC } from '../api/_relais.js'
import { MuxedAccount } from '@stellar/stellar-sdk'
const ANCHOR_M = new MuxedAccount(new Account(Keypair.random().publicKey(), '0'), '146903468709584972').accountId()
const transfert = (contrat, de, vers, montant) =>
  new TransactionBuilder(new Account(DEPLOYEUR, '0'), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(contrat).call('transfer', new Address(de).toScVal(), new Address(vers).toScVal(), nativeToScVal(montant, { type: 'i128' })))
    .setTimeout(30).build().operations[0].func

test('a passkey USDC transfer to an anchor (M… address) is accepted', async () => {
  const v = await verifier({ func: b64(transfert(USDC_SAC, COMPTE, ANCHOR_M, 20_000_000n)), auth: [b64(autorisation(COMPTE, USDC_SAC, 'transfer'))] }, bonWasm)
  assert.deepEqual(v, { creation: false, compte: COMPTE })
})

test('USDC transfer to a plain address, above the cap, from someone else or of another token is refused', async () => {
  const g = Keypair.random().publicKey()
  const cas = [
    transfert(USDC_SAC, COMPTE, g, 20_000_000n),
    transfert(USDC_SAC, COMPTE, ANCHOR_M, MAX_RETRAIT_ANCHOR + 1n),
    transfert(USDC_SAC, AUTRE_CONTRAT, ANCHOR_M, 20_000_000n),
    transfert(AUTRE_CONTRAT, COMPTE, ANCHOR_M, 20_000_000n),
  ]
  for (const f of cas) {
    const v = await verifier({ func: b64(f), auth: [b64(autorisation(COMPTE, USDC_SAC, 'transfer'))] }, bonWasm)
    assert.equal(v.status, 403)
  }
})
