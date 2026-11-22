import { Check, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { demarrerRetrait, lireRetrait, lireToml, payerAnchor, type Sep24Tx } from '../services/anchor'
import { estPasskey, lienTx, lireCompte, messageErreur } from '../services/chain'
import { usdcBalance } from '../services/moneygram'
import { tagTx } from '../services/movements'
import { AnchorInlineForm } from './AnchorInlineForm'

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

// Retrait en cours mémorisé dans le navigateur : sur téléphone, la page est souvent rechargée en revenant
// du formulaire de l'anchor ; on reprend alors le même retrait au lieu de tout perdre.
const KEY = 'unlockshares.anchorWithdraw'
const lireEnCours = (address: string): string => {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { address: string; id: string } | null; return v?.address === address ? v.id : '' } catch { return '' }
}
const ecrireEnCours = (address: string, id: string) => {
  try { if (id) localStorage.setItem(KEY, JSON.stringify({ address, id })); else localStorage.removeItem(KEY) } catch { /* stockage indisponible */ }
}

/** `montant` : montant proposé au départ (par ex. ce qui vient d'être emprunté dans « Get cash ») ; 5 par défaut. */
export function AnchorWithdrawCard({ address, montant }: { address: string; montant?: number }) {
  const passkey = estPasskey(address)
  const [usdc, setUsdc] = useState<number | null | undefined>(undefined)
  const [amount, setAmount] = useState(montant && montant > 0 ? String(montant) : '5')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [tx, setTx] = useState<Sep24Tx | null>(null)
  const [formUrl, setFormUrl] = useState('')
  const [paid, setPaid] = useState('')
  const id = useRef('')

  // Reprise d'un retrait commencé avant un rechargement de la page. La reconnexion à l'anchor peut redemander
  // la passkey : on attend donc un clic (« Resume ») plutôt que de l'ouvrir toute seule.
  const [reprise, setReprise] = useState(() => lireEnCours(address))
  const reprendre = async () => {
    setBusy(true); setErr('')
    try {
      const t = await lireRetrait(address, reprise)
      id.current = reprise
      setReprise('')
      if (FINAL.includes(t.status) && t.status !== 'completed') ecrireEnCours(address, '')
      setTx(t)
    } catch (e) {
      setErr(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }
  const oublier = () => { ecrireEnCours(address, ''); setReprise('') }

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
        if (FINAL.includes(next.status)) ecrireEnCours(address, '')
        if (next.status === 'completed') refresh()
      } catch (e) { setErr(messageErreur(e)) }
    }, 5000)
    return () => window.clearTimeout(t)
  }, [tx, address, refresh])

  // Retour sur l'onglet (après le formulaire de l'anchor) : on relit le statut tout de suite
  useEffect(() => {
    const relire = () => {
      if (document.visibilityState !== 'visible' || !id.current) return
      lireRetrait(address, id.current).then((t) => setTx((old) => (old && FINAL.includes(old.status) ? old : t)), () => {})
    }
    document.addEventListener('visibilitychange', relire)
    return () => document.removeEventListener('visibilitychange', relire)
  }, [address])

  // Formulaire envoyé : on relit le statut tout de suite (le suivi toutes les 5 s prend le relais)
  const relireMaintenant = () => {
    if (!id.current) return
    lireRetrait(address, id.current).then(setTx, (e) => setErr(messageErreur(e)))
  }

  const a = Number(amount.replace(',', '.')) || 0
  const amountOk = a >= 1 && a <= (usdc ?? 0)

  const start = async () => {
    setBusy(true); setErr(''); setTx(null); setFormUrl(''); setPaid('')
    try {
      const r = await demarrerRetrait(address, 'USDC')
      id.current = r.id
      ecrireEnCours(address, r.id)
      setFormUrl(r.url)
      setTx({ id: r.id, status: 'incomplete' })
    } catch (e) {
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
      {reprise && !tx && (
        <div className="chips">
          <button className="btn primary" onClick={() => void reprendre()} disabled={busy}>{busy ? <LoaderCircle className="i spin" /> : null}Resume your cash out</button>
          <button className="btn" onClick={oublier} disabled={busy}>Start a new one</button>
        </div>
      )}
      <span className="muted">The Stellar test anchor takes your testnet USDC and simulates the bank transfer. No real money moves.</span>
      <label className="co-label" htmlFor="wd-amount">Amount to cash out</label>
      <div className="co-amount">
        <input id="wd-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!amountOk} />
        <span>USDC</span>
      </div>
      <small className="muted">{usdc === undefined ? 'Reading your balance…' : `Your balance: ${usdc ?? 0} USDC`}</small>
      <div className="chips">
        <button className="btn primary" onClick={() => void start()} disabled={busy || !amountOk || (!!tx && !FINAL.includes(tx.status))}>
          {busy && !tx ? <LoaderCircle className="i spin" /> : null}Cash out with the anchor
        </button>
      </div>
      {formUrl && tx?.status === 'incomplete' && (
        <AnchorInlineForm url={formUrl} kind="withdrawal" amount={String(a)} onDone={relireMaintenant} />
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
