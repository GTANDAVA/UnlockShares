import { Building2, Check, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ANCHOR_DOMAIN, demarrerDepot, lireRetrait, type Sep24Tx } from '../services/anchor'
import { lienTx, messageErreur } from '../services/chain'
import { addUsdcTrustline, usdcBalance } from '../services/moneygram'
import { tagTx } from '../services/movements'

// Dépôt réel sur testnet via un anchor Stellar (SEP-10 + SEP-24) : « virement bancaire » simulé → USDC de Circle dans le wallet.
// Analogie : on passe au guichet d'un bureau de change agréé ; il vérifie ton identité (SEP-10), tu remplis son formulaire (SEP-24), il t'envoie les USDC.

const FINAL = ['completed', 'refunded', 'expired', 'error', 'no_market', 'too_small', 'too_large']
const LABEL: Record<string, string> = {
  incomplete: 'Fill in the anchor’s form',
  pending_user_transfer_start: 'Waiting for your bank transfer',
  pending_anchor: 'Anchor is processing',
  pending_stellar: 'Sending USDC on Stellar',
  pending_external: 'Waiting for the bank',
  pending_trust: 'Add the USDC trustline',
  completed: 'USDC received in your wallet',
}

export function AnchorDepositCard({ address }: { address: string }) {
  const [usdc, setUsdc] = useState<number | null | undefined>(undefined)
  const [amount, setAmount] = useState('5')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [tx, setTx] = useState<Sep24Tx | null>(null)
  const id = useRef('')

  const refresh = useCallback(() => { usdcBalance(address).then(setUsdc, () => setUsdc(null)) }, [address])
  useEffect(refresh, [refresh])

  // Suivi du statut toutes les 5 s jusqu'à un état final
  useEffect(() => {
    if (!tx || FINAL.includes(tx.status)) return
    const t = window.setTimeout(async () => {
      try {
        const next = await lireRetrait(address, id.current)
        setTx(next)
        if (next.stellar_transaction_id) tagTx(next.stellar_transaction_id, { kind: 'anchor-in' })
        if (next.status === 'completed') refresh()
      } catch (e) { setErr(messageErreur(e)) }
    }, 5000)
    return () => window.clearTimeout(t)
  }, [tx, address, refresh])

  const a = Number(amount.replace(',', '.')) || 0
  const amountOk = a >= 1 && a <= 10

  const trust = async () => {
    setBusy(true); setErr('')
    try { await addUsdcTrustline(address); refresh() } catch (e) { setErr(messageErreur(e)) } finally { setBusy(false) }
  }

  const start = async () => {
    // Fenêtre ouverte tout de suite (pendant le clic), sinon le navigateur bloque la popup.
    const win = window.open('', 'anchor', 'width=480,height=720')
    setBusy(true); setErr(''); setTx(null)
    try {
      const r = await demarrerDepot(address, 'USDC', String(a))
      id.current = r.id
      if (win) win.location.href = r.url
      else window.open(r.url, '_blank')
      setTx({ id: r.id, status: 'incomplete' })
    } catch (e) {
      win?.close()
      setErr(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  const done = tx?.status === 'completed'

  return (
    <div className="co-card">
      <b><Building2 className="v-ic" /> Deposit from your bank with a Stellar anchor <span className="tag">SEP-24 · testnet</span></b>
      <span className="muted">Uses the Stellar standard for on-ramps: one integration works with any licensed anchor. Here: the SDF test anchor ({ANCHOR_DOMAIN}), which sends real Circle testnet USDC. No real money moves.</span>
      <div className="co-kv">
        <span>USDC (Circle) in wallet</span>
        <b>{usdc === undefined ? '…' : usdc === null ? 'No USDC trustline yet' : usdc.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b>
      </div>
      {usdc === null ? (
        <div className="chips"><button className="btn primary" onClick={() => void trust()} disabled={busy}>{busy ? <LoaderCircle className="i spin" /> : null}Add USDC trustline</button></div>
      ) : (
        <>
          <label className="co-label" htmlFor="dep-amount">Amount to deposit (1 to 10 USDC on the test anchor)</label>
          <div className="co-amount">
            <input id="dep-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!amountOk} />
            <span>USDC</span>
          </div>
          <div className="chips">
            <button className="btn primary" onClick={() => void start()} disabled={busy || !amountOk || (!!tx && !FINAL.includes(tx.status))}>
              {busy ? <LoaderCircle className="i spin" /> : null}Deposit with the anchor
            </button>
          </div>
          <small className="muted">Varial asks you to sign a login challenge (SEP-10: no money moves), then the anchor’s form opens in a new window.</small>
        </>
      )}
      {tx && (
        <p className={done ? 'co-ok' : 'muted'}>
          {done ? <Check className="v-ic" /> : FINAL.includes(tx.status) ? <TriangleAlert className="v-ic" /> : <LoaderCircle className="v-ic spin" />}
          {LABEL[tx.status] ?? tx.status} <code>{tx.status}</code>
          {tx.amount_out && <> · {tx.amount_out} USDC</>}
        </p>
      )}
      {tx?.stellar_transaction_id && <small className="muted"><a href={lienTx(tx.stellar_transaction_id)} target="_blank" rel="noreferrer">See the USDC transaction</a></small>}
      {tx?.more_info_url && <small className="muted"><a href={tx.more_info_url} target="_blank" rel="noreferrer">Anchor’s receipt</a></small>}
      {err && <p className="co-err"><TriangleAlert className="v-ic" />{err}</p>}
    </div>
  )
}
