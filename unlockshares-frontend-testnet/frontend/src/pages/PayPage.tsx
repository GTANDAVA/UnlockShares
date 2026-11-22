import { Check, LoaderCircle, Store } from 'lucide-react'
import { useState } from 'react'
import { StrKey } from '@stellar/stellar-sdk'
import { Gauge, usd, usdc, useDemoUi } from '../components/demo'
import { ConnectButtons } from '../components/Onboarding'
import { StockPicker } from '../components/StockPicker'
import { useDemo } from '../lib/useDemo'
import { actions, refresh } from '../services/app'
import { actionsConnues, estPasskey, hubV2 as h2, jetonPret, lienTx, messageErreur } from '../services/chain'
import { planGetCash } from './GetCashPage'
import { hubV2 } from '../chainConfig'
import '../styles/cashout.css'

/** Nombre de mensualités proposées pour le « payer en plusieurs fois ». */
const MENSUALITES = 3

const adresseValide = (a: string) => StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a) || StrKey.isValidMed25519PublicKey(a)

/** Échéancier indicatif : le marchand est payé tout de suite, le client rembourse en 3 fois (sans pénalité s'il paie plus tôt). */
export function echeancier(montant: number, depuis = new Date()): { date: Date; montant: number }[] {
  const part = Math.floor((montant / MENSUALITES) * 100) / 100
  return Array.from({ length: MENSUALITES }, (_, i) => {
    const date = new Date(depuis)
    date.setMonth(date.getMonth() + i + 1)
    return { date, montant: i === MENSUALITES - 1 ? Math.round((montant - part * (MENSUALITES - 1)) * 100) / 100 : part }
  })
}

/** « Pay » (hub v2) : payer un commerçant avec un prêt garanti par ses actions, puis rembourser en 3 fois.
 *  Analogie : la banque paie le magasin à ta place, et tu la rembourses en 3 mois. Tes actions restent à toi. */
export function PayPage() {
  const s = useDemo()
  const { toast } = useDemoUi()
  const J = jetonPret()
  const [marchand, setMarchand] = useState('')
  const [saisie, setSaisie] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [progres, setProgres] = useState('')
  const [preuves, setPreuves] = useState<{ label: string; hash?: string }[] | null>(null)
  const montant = Math.max(0, Number(saisie.replace(',', '.')) || 0)
  const plan = planGetCash(s, montant)
  const adresseOk = adresseValide(marchand.trim())
  const ok = adresseOk && montant > 0 && montant <= plan.max && plan.aDeposer <= s.walletShares + 1e-9
  const signe = estPasskey(s.address) ? 'confirm with your passkey' : 'sign in Varial'

  if (!hubV2) {
    return (
      <div className="empty"><b>Pay a merchant</b><span className="muted">Coming with the next version of the pool.</span></div>
    )
  }
  if (!s.address) {
    return <div className="empty"><b>Create your account</b><span className="muted">Face ID or fingerprint, or the Varial wallet. Stellar testnet.</span><ConnectButtons /></div>
  }

  async function payer() {
    setEnvoi(true)
    const faits: { label: string; hash?: string }[] = []
    try {
      if (plan.aDeposer > 0) {
        setProgres(`1/2 · Locking ${plan.aDeposer} shares as a guarantee: ${signe}…`)
        const d = await actions.run('deposit', plan.aDeposer)
        faits.push({ label: `${plan.aDeposer} shares locked as a guarantee`, hash: d.hash })
      }
      setProgres(`${plan.aDeposer > 0 ? '2/2' : '1/1'} · Paying the merchant ${usdc(montant)}: ${signe}…`)
      const hash = await h2.emprunterVers(s.address!, s.stock.jeton, montant, marchand.trim())
      faits.push({ label: `${usdc(montant)} paid to the merchant`, hash })
      await refresh()
      setPreuves(faits)
    } catch (e) {
      toast(messageErreur(e))
    } finally {
      setEnvoi(false)
      setProgres('')
    }
  }

  if (preuves) {
    return (
      <section className="home-hero cash-done" aria-label="Payment done">
        <div className="balance">
          <div><small className="muted">Paid to the merchant</small><div className="big">{usdc(montant)}</div></div>
          <div className="divider" />
          <div className="line"><span><Check className="i" aria-hidden /> <b>Done.</b> Pay back in {MENSUALITES} times, or whenever you want.</span></div>
          {echeancier(montant).map((e, i) => (
            <div className="line" key={i}><span className="muted">Payment {i + 1} · {e.date.toLocaleDateString()}</span><span>{usd(e.montant)}</span></div>
          ))}
          {preuves.map((p) => (
            <small key={p.label} className="muted">✓ {p.label}{p.hash && <> · <a href={lienTx(p.hash)} target="_blank" rel="noreferrer">proof on Stellar</a></>}</small>
          ))}
          <div className="chips">
            <a className="btn" href="#accueil">See my loan</a>
            <button className="btn" onClick={() => { setPreuves(null); setSaisie(''); setMarchand('') }}>Pay again</button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Pay</h1>
          <p className="muted">Pay a merchant now with a loan backed by your shares, then pay back in {MENSUALITES} times. You keep your shares.</p>
        </div>
      </div>
      <section className="home home-hero" aria-label="Pay a merchant">
        <div className="balance">
          {s.stocks.length > 1 && (
            <div>
              <small className="muted">Which shares do you borrow against?</small>
              <StockPicker label="Shares used as a guarantee" filter={(x) => x.active && x.shares + x.walletShares > 0} />
            </div>
          )}
          <div>
            <small className="muted"><Store className="i" aria-hidden /> Merchant’s Stellar address</small>
            <input value={marchand} onChange={(e) => setMarchand(e.target.value)} placeholder="G… or C…" disabled={envoi} aria-label="Merchant address"
              style={{ font: 'inherit', width: '100%', minWidth: 0, padding: '6px 0', border: 0, borderBottom: '2px solid var(--line)', background: 'transparent', color: 'var(--ink)', outline: 'none' }} />
            {marchand && !adresseOk && <small className="co-err">This is not a valid Stellar address.</small>}
          </div>
          <div>
            <small className="muted">Amount</small>
            <div className="big" style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span>$</span>
              <input type="number" min={0} step={1} value={saisie} placeholder="0" onChange={(e) => setSaisie(e.target.value)} disabled={envoi} aria-label={`Amount in ${J}`}
                style={{ font: 'inherit', width: '100%', minWidth: 0, padding: 0, border: 0, borderBottom: '2px solid var(--line)', background: 'transparent', color: 'var(--ink)', outline: 'none' }} />
            </div>
            <small className="muted">up to {usd(plan.max)}</small>
          </div>
          <div className="divider" />
          {montant > 0 && echeancier(montant).map((e, i) => (
            <div className="line" key={i}><span className="muted">Payment {i + 1} · {e.date.toLocaleDateString()}</span><span>{usd(e.montant)}</span></div>
          ))}
          <div className="line"><span className="muted">Shares locked as a guarantee</span><span>{plan.aDeposer > 0 ? `+${plan.aDeposer} ${s.stock.ticker}` : 'none, already enough'}</span></div>
          {montant > plan.max && <p className="co-err">Above your maximum ({usd(plan.max)}), set by the {plan.limite}.</p>}
          {plan.aDeposer > s.walletShares + 1e-9 && <p className="co-err">You need {plan.aDeposer} shares in your wallet, you have {s.walletShares}.</p>}
          <button className="btn primary" disabled={!ok || envoi} onClick={() => void payer()} style={{ alignSelf: 'flex-start' }}>
            {envoi ? <LoaderCircle className="i spin" /> : null}Pay {usd(montant)}
          </button>
          {progres && <small className="muted">{progres}</small>}
          <small className="muted">The merchant is paid in full now. Each payment is a reminder: pay back early at no extra cost.</small>
        </div>
        <div className="chart jarbox">
          <small className="muted">Your loan after</small>
          <Gauge ltv={plan.ltvApres} />
        </div>
      </section>
      <RepayForCard address={s.address} />
    </>
  )
}

/** Rembourser pour quelqu'un (hub v2) : un proche paie une partie de la dette d'un autre avec son propre USDC.
 *  Seul le payeur signe ; il n'obtient aucun droit sur les actions de l'emprunteur. */
function RepayForCard({ address }: { address: string }) {
  const J = jetonPret()
  const titres = actionsConnues()
  const [qui, setQui] = useState('')
  const [jeton, setJeton] = useState(titres[0]?.jeton ?? '')
  const [saisie, setSaisie] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [hash, setHash] = useState('')
  const montant = Math.max(0, Number(saisie.replace(',', '.')) || 0)
  const ok = adresseValide(qui.trim()) && qui.trim() !== address && !!jeton && montant > 0

  async function payer() {
    setBusy(true); setErr(''); setHash('')
    try {
      setHash(await h2.rembourserPour(address, qui.trim(), jeton, montant))
      await refresh()
    } catch (e) {
      setErr(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pos onboard">
      <div className="head"><h3>Pay back for someone</h3></div>
      <span className="muted">Help a relative: pay part of their loan with your own {J}. Only you sign. Their shares stay theirs.</span>
      <div className="chips">
        <input value={qui} onChange={(e) => setQui(e.target.value)} placeholder="Their address (G… or C…)" aria-label="Borrower address" style={{ minWidth: '16em' }} />
        <select value={jeton} onChange={(e) => setJeton(e.target.value)} aria-label="Shares of the loan">
          {titres.map((t) => <option key={t.jeton} value={t.jeton}>{t.ticker}</option>)}
        </select>
        <input inputMode="decimal" value={saisie} onChange={(e) => setSaisie(e.target.value)} placeholder={`Amount (${J})`} aria-label={`Amount in ${J}`} style={{ width: '8em' }} />
        <button className="btn primary" disabled={!ok || busy} onClick={() => void payer()}>
          {busy ? <LoaderCircle className="i spin" aria-hidden /> : null}Pay back
        </button>
      </div>
      {hash && <small><a href={lienTx(hash)} target="_blank" rel="noreferrer">See the transaction</a></small>}
      {err && <small className="co-err">{err}</small>}
    </div>
  )
}
