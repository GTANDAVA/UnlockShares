import { Check, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { demarrerDepot, lireRetrait, type Sep24Tx } from '../services/anchor'
import { estPasskey, lienTx, lireCompte, messageErreur } from '../services/chain'
import { addUsdcTrustline, usdcBalance } from '../services/moneygram'
import { tagTx } from '../services/movements'
import { AnchorFrame } from './AnchorFrame'

// Dépôt réel sur testnet via un anchor Stellar (SEP-10 ou SEP-45 pour les passkeys, + SEP-24) : « virement bancaire » simulé → USDC de Circle dans le wallet.
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
  const [formUrl, setFormUrl] = useState('')
  const [frameOpen, setFrameOpen] = useState(false)
  const id = useRef('')

  // Compte passkey (C…) : pas de trustline, le solde USDC se lit dans le contrat du jeton.
  const refresh = useCallback(() => {
    const lire = estPasskey(address) ? lireCompte(address).then((c) => c.usdc) : usdcBalance(address)
    lire.then(setUsdc, () => setUsdc(null))
  }, [address])
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

  // L'anchor signale la fin du formulaire : on relit le statut tout de suite (le suivi ferme la feuille)
  const relireMaintenant = useCallback(() => {
    if (!id.current) return
    lireRetrait(address, id.current).then((t) => { setTx(t); if (t.status !== 'incomplete') setFrameOpen(false) }, () => {})
  }, [address])

  const a = Number(amount.replace(',', '.')) || 0
  const amountOk = a >= 1 && a <= 10

  const trust = async () => {
    setBusy(true); setErr('')
    try { await addUsdcTrustline(address); refresh() } catch (e) { setErr(messageErreur(e)) } finally { setBusy(false) }
  }

  const start = async () => {
    // Varial : fenêtre ouverte tout de suite (pendant le clic), sinon le navigateur bloque la popup.
    // Passkey : pas de fenêtre avant la signature (Face ID / empreinte exige que la page reste au premier plan) ;
    // le formulaire s'ouvre ensuite avec un bouton.
    const passkey = estPasskey(address)
    const win = passkey ? null : window.open('', 'anchor', 'width=480,height=720')
    setBusy(true); setErr(''); setTx(null); setFormUrl('')
    try {
      const r = await demarrerDepot(address, 'USDC', String(a))
      id.current = r.id
      if (win) win.location.href = r.url
      else if (passkey) { setFormUrl(r.url); setFrameOpen(true) }
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
      <span className="muted">The Stellar test anchor sends you real testnet USDC (1 to 10 per deposit).</span>
      {usdc === null ? (
        <div className="chips"><button className="btn primary" onClick={() => void trust()} disabled={busy}>{busy ? <LoaderCircle className="i spin" /> : null}Add USDC trustline</button></div>
      ) : (
        <>
          <label className="co-label" htmlFor="dep-amount">Amount</label>
          <div className="co-amount">
            <input id="dep-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!amountOk} />
            <span>USDC</span>
          </div>
          <div className="chips">
            <button className="btn primary" onClick={() => void start()} disabled={busy || !amountOk || (!!tx && !FINAL.includes(tx.status))}>
              {busy ? <LoaderCircle className="i spin" /> : null}Deposit with the anchor
            </button>
          </div>
        </>
      )}
      {formUrl && tx?.status === 'incomplete' && (
        frameOpen
          ? <AnchorFrame url={formUrl} onClose={() => setFrameOpen(false)} onMessage={relireMaintenant} />
          : <div className="chips"><button className="btn primary" onClick={() => setFrameOpen(true)}>Open the anchor’s form</button></div>
      )}
      {tx && (
        <p className={done ? 'co-ok' : 'muted'}>
          {done ? <Check className="v-ic" /> : FINAL.includes(tx.status) ? <TriangleAlert className="v-ic" /> : <LoaderCircle className="v-ic spin" />}
          {LABEL[tx.status] ?? tx.status}
          {tx.amount_out && <> · {tx.amount_out} USDC</>}
        </p>
      )}
      {tx?.stellar_transaction_id && <small className="muted"><a href={lienTx(tx.stellar_transaction_id)} target="_blank" rel="noreferrer">See the USDC transaction</a></small>}
      {tx?.more_info_url && <small className="muted"><a href={tx.more_info_url} target="_blank" rel="noreferrer">Anchor’s receipt</a></small>}
      {err && <p className="co-err"><TriangleAlert className="v-ic" />{err}</p>}
    </div>
  )
}
