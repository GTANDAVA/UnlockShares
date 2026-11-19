import { Check, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { demarrerRetrait, lireRetrait, lireToml, payerAnchor, type Sep24Tx } from '../services/anchor'
import { estPasskey, lienTx, lireCompte, messageErreur } from '../services/chain'
import { usdcBalance } from '../services/moneygram'
import { tagTx } from '../services/movements'

// Retrait réel sur testnet via l'anchor de test de Stellar (SEP-10 ou SEP-45, puis SEP-24) : USDC de Circle → « virement bancaire » de test.
// Analogie : au bureau de change, on remplit le bordereau (formulaire de l'anchor), puis on dépose les billets au guichet (paiement USDC).
// Varial paie avec un mémo ; un compte passkey paie l'adresse M… de l'anchor (adresse + numéro du retrait).

const FINAL = ['completed', 'refunded', 'expired', 'error', 'no_market', 'too_small', 'too_large']
const LABEL: Record<string, string> = {
  incomplete: 'Fill in the anchor’s form',
  pending_user_transfer_start: 'Send your USDC to the anchor',
  pending_user_transfer_complete: 'USDC received by the anchor',
  pending_anchor: 'Anchor is processing',
  pending_stellar: 'Anchor is processing',
  pending_external: 'Bank transfer on its way',
  completed: 'Bank transfer sent (testnet)',
  refunded: 'Refunded',
}

export function AnchorWithdrawCard({ address }: { address: string }) {
  const passkey = estPasskey(address)
  const [usdc, setUsdc] = useState<number | null | undefined>(undefined)
  const [amount, setAmount] = useState('5')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [tx, setTx] = useState<Sep24Tx | null>(null)
  const [formUrl, setFormUrl] = useState('')
  const [paid, setPaid] = useState('')
  const id = useRef('')

  const refresh = useCallback(() => {
    const lire = passkey ? lireCompte(address).then((c) => c.usdc) : usdcBalance(address)
    lire.then(setUsdc, () => setUsdc(null))
  }, [address, passkey])
  useEffect(refresh, [refresh])

  // Suivi du statut toutes les 5 s jusqu'à un état final
  useEffect(() => {
    if (!tx || FINAL.includes(tx.status)) return
    const t = window.setTimeout(async () => {
      try {
        const next = await lireRetrait(address, id.current)
        setTx(next)
        if (next.status === 'completed') refresh()
      } catch (e) { setErr(messageErreur(e)) }
    }, 5000)
    return () => window.clearTimeout(t)
  }, [tx, address, refresh])

  const a = Number(amount.replace(',', '.')) || 0
  const amountOk = a >= 1 && a <= (usdc ?? 0)

  const start = async () => {
    // Varial : fenêtre ouverte pendant le clic (sinon bloquée). Passkey : après la signature, avec un bouton.
    const win = passkey ? null : window.open('', 'anchor', 'width=480,height=720')
    setBusy(true); setErr(''); setTx(null); setFormUrl(''); setPaid('')
    try {
      const r = await demarrerRetrait(address, 'USDC')
      id.current = r.id
      if (win) win.location.href = r.url
      else if (passkey) setFormUrl(r.url)
      else window.open(r.url, '_blank')
      setTx({ id: r.id, status: 'incomplete' })
    } catch (e) {
      win?.close()
      setErr(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  // Le montant final est celui saisi dans le formulaire de l'anchor (amount_in), on l'affiche avant de payer.
  const pay = async () => {
    if (!tx) return
    setBusy(true); setErr('')
    try {
      const usdcAsset = (await lireToml()).assets.find((x) => x.code === 'USDC')?.asset
      if (!usdcAsset) throw new Error('The anchor does not list USDC.')
      const hash = await payerAnchor(address, tx, usdcAsset)
      setPaid(hash)
      tagTx(hash, { kind: 'anchor-out', ref: tx.id })
      setTx({ ...tx, status: 'pending_user_transfer_complete' })
      refresh()
    } catch (e) {
      setErr(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  const done = tx?.status === 'completed'
  const toPay = tx?.status === 'pending_user_transfer_start' && !paid

  return (
    <div className="co-card">
      <span className="muted">The Stellar test anchor takes your testnet USDC and simulates the bank transfer. No real money moves.</span>
      <label className="co-label" htmlFor="wd-amount">Amount you plan to cash out</label>
      <div className="co-amount">
        <input id="wd-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!amountOk} />
        <span>USDC</span>
      </div>
      <small className="muted">{usdc === undefined ? 'Reading your balance…' : `Your balance: ${usdc ?? 0} USDC · you confirm the exact amount in the anchor’s form.`}</small>
      <div className="chips">
        <button className="btn primary" onClick={() => void start()} disabled={busy || !amountOk || (!!tx && !FINAL.includes(tx.status))}>
          {busy && !tx ? <LoaderCircle className="i spin" /> : null}Cash out with the anchor
        </button>
      </div>
      {formUrl && tx?.status === 'incomplete' && (
        <div className="chips"><a className="btn primary" href={formUrl} target="_blank" rel="noreferrer">Open the anchor’s form</a></div>
      )}
      {toPay && (
        <div className="co-kv">
          <span>Send to the anchor</span><b>{tx.amount_in} USDC</b>
          {tx.amount_fee && <><span>Anchor fee</span><b>{tx.amount_fee}</b></>}
          {tx.amount_out && <><span>Bank receives</span><b>{tx.amount_out}</b></>}
        </div>
      )}
      {toPay && (
        <div className="chips">
          <button className="btn primary" onClick={() => void pay()} disabled={busy}>
            {busy ? <LoaderCircle className="i spin" /> : null}Send {tx.amount_in} USDC to the anchor
          </button>
        </div>
      )}
      {tx && (
        <p className={done ? 'co-ok' : 'muted'}>
          {done ? <Check className="v-ic" /> : FINAL.includes(tx.status) ? <TriangleAlert className="v-ic" /> : <LoaderCircle className="v-ic spin" />}
          {LABEL[tx.status] ?? tx.status}
        </p>
      )}
      {paid && <small className="muted"><a href={lienTx(paid)} target="_blank" rel="noreferrer">See your USDC payment</a></small>}
      {tx?.more_info_url && <small className="muted"><a href={tx.more_info_url} target="_blank" rel="noreferrer">Anchor’s receipt</a></small>}
      {err && <p className="co-err"><TriangleAlert className="v-ic" />{err}</p>}
    </div>
  )
}
