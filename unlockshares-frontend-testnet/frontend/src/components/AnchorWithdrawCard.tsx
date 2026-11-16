import { Check, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { demarrerRetrait, lireRetrait, payerAnchor, type Sep24Tx } from '../services/anchor'
import { lienTx, messageErreur } from '../services/chain'
import { USDC, usdcBalance } from '../services/moneygram'
import { tagTx } from '../services/movements'

// Retrait RÉEL sur testnet via l'anchor de référence de Stellar (SEP-10 + SEP-24) : USDC de Circle → « virement bancaire » de test.
// Analogie : le bureau de change agréé. SEP-10 = montrer sa pièce d'identité (signature Varial), SEP-24 = remplir le bordereau
// sur son site, puis on lui remet les USDC (2e signature Varial) et il fait le virement (fictif : c'est l'anchor de TEST).

const FINAL = ['completed', 'refunded', 'expired', 'error', 'no_market', 'too_small', 'too_large']
const LABEL: Record<string, string> = {
  incomplete: 'Fill in the anchor’s form (amount, bank details)',
  pending_user_transfer_start: 'Ready: send the USDC to the anchor',
  pending_user_transfer_complete: 'USDC received by the anchor',
  pending_anchor: 'Anchor is processing',
  pending_stellar: 'Anchor is processing',
  pending_external: 'Bank transfer on its way',
  completed: 'Bank transfer sent (test anchor)',
  refunded: 'Refunded by the anchor',
  expired: 'Expired: start again',
  error: 'The anchor reported an error',
}

export function AnchorWithdrawCard({ address }: { address: string }) {
  const [usdc, setUsdc] = useState<number | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [tx, setTx] = useState<Sep24Tx | null>(null)
  const [hash, setHash] = useState('')
  const id = useRef('')

  const refresh = useCallback(() => { usdcBalance(address).then(setUsdc, () => setUsdc(null)) }, [address])
  useEffect(refresh, [refresh])

  // Suivi du retrait toutes les 5 s jusqu'à un état final
  useEffect(() => {
    if (!tx || FINAL.includes(tx.status)) return
    const t = window.setTimeout(async () => {
      try {
        setTx(await lireRetrait(address, id.current))
      } catch (e) { setErr(messageErreur(e)) }
    }, 5000)
    return () => window.clearTimeout(t)
  }, [tx, address])

  const start = async () => {
    // Fenêtre ouverte tout de suite (pendant le clic), sinon le navigateur bloque la popup.
    const win = window.open('', 'anchor', 'width=480,height=720')
    setBusy(true); setErr(''); setTx(null); setHash('')
    try {
      const r = await demarrerRetrait(address, 'USDC')
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

  // Le formulaire rempli, l'anchor attend les USDC : on les lui envoie avec le mémo qui identifie ce retrait.
  const pay = async () => {
    if (!tx) return
    setBusy(true); setErr('')
    try {
      const h = await payerAnchor(address, tx, USDC)
      setHash(h)
      tagTx(h, { kind: 'anchor-out' })
      refresh()
      setTx({ ...tx, status: 'pending_user_transfer_complete' })
    } catch (e) {
      setErr(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  const done = tx?.status === 'completed'
  const toPay = tx?.status === 'pending_user_transfer_start' && !hash && !!tx.withdraw_anchor_account && !!tx.amount_in

  return (
    <div className="co-card">
      <span className="muted">The Stellar test anchor takes your USDC and sends a test bank transfer. 1 to 10 USDC per withdrawal. Real testnet transactions; no real money moves.</span>
      {usdc === null ? (
        <p className="muted">This account has no USDC yet: borrow first, or use “Add money”.</p>
      ) : (
        <div className="chips">
          <button className="btn primary" onClick={() => void start()} disabled={busy || !usdc || (!!tx && !FINAL.includes(tx.status))}>
            {busy && !toPay ? <LoaderCircle className="i spin" /> : null}Withdraw to my bank
          </button>
          {toPay && (
            <button className="btn primary" onClick={() => void pay()} disabled={busy}>
              {busy ? <LoaderCircle className="i spin" /> : null}Send {Number(tx.amount_in)} USDC to the anchor
            </button>
          )}
        </div>
      )}
      {tx && (
        <p className={done ? 'co-ok' : 'muted'}>
          {done ? <Check className="v-ic" /> : FINAL.includes(tx.status) ? <TriangleAlert className="v-ic" /> : <LoaderCircle className="v-ic spin" />}
          {LABEL[tx.status] ?? tx.status}
          {tx.amount_out && <> · you receive {tx.amount_out}</>}
          {tx.amount_fee && Number(tx.amount_fee) > 0 && <> · anchor fee {tx.amount_fee}</>}
        </p>
      )}
      {hash && <small className="muted">USDC sent to the anchor · <a href={lienTx(hash)} target="_blank" rel="noreferrer">see the transaction</a></small>}
      {tx?.more_info_url && <small className="muted"><a href={tx.more_info_url} target="_blank" rel="noreferrer">Anchor’s receipt</a></small>}
      {err && <p className="co-err"><TriangleAlert className="v-ic" />{err}</p>}
    </div>
  )
}
