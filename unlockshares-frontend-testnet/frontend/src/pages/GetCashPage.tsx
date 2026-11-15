import { Check, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { usd, usdc, useDemoUi } from '../components/demo'
import { MarketHoursNote } from '../components/MarketHoursNote'
import { MoneyGramCard } from '../components/MoneyGramCard'
import { ConnectButtons } from '../components/Onboarding'
import { useDemo } from '../lib/useDemo'
import { actions, type AppState } from '../services/app'
import { estPasskey, jetonPret, lienTx } from '../services/chain'
import { DEMO } from '../services/mockDemo'

/** Marge de sécurité : la dette grandit de quelques unités entre la lecture et la signature. */
const MARGE = 1.01

/** Ce qu'il faut faire pour recevoir `montant` : actions à déposer, état du prêt après, limites. */
export function planGetCash(s: AppState, montant: number) {
  const prix = s.price
  const actionsTotal = s.shares + s.walletShares
  const plafondAdresse = s.market.capPerAddress === undefined ? Infinity : s.market.capPerAddress - s.debt
  const plafondCaisse = s.market.capCashShare === undefined ? s.market.cash : s.market.cash * s.market.capCashShare
  const parGarantie = (actionsTotal * prix * DEMO.ltvMax) / MARGE - s.debt
  const max = Math.max(0, Math.floor(Math.min(plafondAdresse, plafondCaisse, parGarantie, s.market.cash) * 100) / 100)
  const besoin = prix > 0 ? ((s.debt + montant) * MARGE) / (prix * DEMO.ltvMax) - s.shares : Infinity
  const aDeposer = Math.max(0, Math.ceil(besoin * 100) / 100)
  const garantie = s.shares + aDeposer
  const dette = s.debt + montant
  return {
    max,
    aDeposer,
    ltvApres: garantie * prix > 0 ? dette / (garantie * prix) : 0,
    prixLiquidation: garantie > 0 ? dette / (DEMO.liquidation * garantie) : 0,
    limite: max === plafondAdresse ? 'per-address limit' : max === plafondCaisse ? 'share of the pool cash' : 'value of your shares',
  }
}

type Etape = 'saisie' | 'envoi' | 'fait'

/** Parcours unique « Get cash » : un montant → dépôt des actions nécessaires + emprunt → espèces avec MoneyGram. */
export function GetCashPage() {
  const s = useDemo()
  const { toast } = useDemoUi()
  const demo = s.mode === 'demo'
  const J = jetonPret()
  const [saisie, setSaisie] = useState('')
  const [etape, setEtape] = useState<Etape>('saisie')
  const [progres, setProgres] = useState('')
  const [preuves, setPreuves] = useState<{ label: string; hash?: string }[]>([])
  const montant = Math.max(0, Number(saisie.replace(',', '.')) || 0)
  const plan = planGetCash(s, montant)
  const ok = montant > 0 && montant <= plan.max && plan.aDeposer <= s.walletShares + 1e-9
  const pret = !demo && !s.address
  const pk = estPasskey(s.address)
  const signe = pk ? 'confirm with your passkey' : 'sign in Varial'

  async function lancer() {
    setEtape('envoi')
    const faits: { label: string; hash?: string }[] = []
    try {
      if (plan.aDeposer > 0) {
        setProgres(`1/2 · Locking ${plan.aDeposer} shares as a guarantee: ${signe}…`)
        const d = await actions.run('deposit', plan.aDeposer)
        faits.push({ label: `${plan.aDeposer} shares locked as a guarantee`, hash: d.hash })
      }
      setProgres(`${plan.aDeposer > 0 ? '2/2' : '1/1'} · Receiving ${usdc(montant)}: ${signe}…`)
      const e = await actions.run('borrow', montant)
      faits.push({ label: `${usdc(montant)} received in your wallet`, hash: e.hash })
      setPreuves(faits)
      setEtape('fait')
    } catch (err) {
      setPreuves(faits)
      setEtape('saisie')
      toast(err instanceof Error ? err.message : String(err))
    } finally {
      setProgres('')
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Get cash</h1>
          <p className="muted">Choose an amount. UnlockShares locks just the shares needed as a guarantee, sends you the {J}, and MoneyGram turns it into cash.</p>
        </div>
      </div>

      {pret ? (
        <div className="empty"><b>Create your account</b><span className="muted">Face ID or fingerprint, or the Varial wallet. Stellar testnet.</span><ConnectButtons /></div>
      ) : etape !== 'fait' ? (
        <div className="pos home-hero">
          <div className="line"><span className="muted">How much do you need?</span><span className="muted">up to {usd(plan.max)}</span></div>
          <div className="chips" style={{ alignItems: 'center' }}>
            <input
              type="number" min={0} step={1} value={saisie} onChange={(e) => setSaisie(e.target.value)} disabled={etape === 'envoi'}
              aria-label={`Amount in ${J}`} style={{ font: '600 28px var(--font)', width: 180, padding: '8px 14px', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface)', color: 'var(--ink)' }}
            />
            <span>{J}</span>
            {plan.max > 0 && <button className="btn" disabled={etape === 'envoi'} onClick={() => setSaisie(String(plan.max))}>Max</button>}
          </div>

          <div className="divider" />
          <div className="line"><span className="muted">Shares to lock as a guarantee</span><span>{plan.aDeposer > 0 ? `${plan.aDeposer} AAPL` : 'none, already enough'}</span></div>
          <div className="line"><span className="muted">You receive</span><span><b>{usdc(montant)}</b></span></div>
          <div className="line"><span className="muted">Your loan after</span><span>{Math.round(plan.ltvApres * 100)} % of your shares’ value (max 50 %)</span></div>
          <div className="line"><span className="muted">Protection sale if Apple falls below</span><span>{usd(plan.prixLiquidation)}</span></div>
          <small className="muted">You keep your shares. Pay back whenever you want to unlock them.</small>

          {montant > plan.max && <p className="co-err">Above your maximum ({usd(plan.max)}), set by the {plan.limite}.</p>}
          {plan.aDeposer > s.walletShares + 1e-9 && <p className="co-err">You need {plan.aDeposer} shares in your wallet, you have {s.walletShares}. Use “Get test tokens” first.</p>}

          <button className="btn primary" disabled={!ok || etape === 'envoi'} onClick={() => void lancer()} style={{ alignSelf: 'flex-start' }}>
            {etape === 'envoi' ? <LoaderCircle className="i spin" /> : null}Get {usd(montant)}
          </button>
          {progres && <small className="muted">{progres}</small>}
          {!demo && <small className="muted">{plan.aDeposer > 0 ? 'Two confirmations' : 'One confirmation'} {pk ? 'with your passkey, fees paid by UnlockShares' : 'in Varial'}, on Stellar testnet.</small>}
        </div>
      ) : (
        <div className="pos home-hero">
          <div className="line"><span><Check className="i" aria-hidden /> <b>Done.</b> {usdc(montant)} are in your wallet.</span></div>
          {preuves.map((p) => (
            <small key={p.label} className="muted">✓ {p.label}{p.hash && <> · <a href={lienTx(p.hash)} target="_blank" rel="noreferrer">proof on Stellar</a></>}</small>
          ))}
          <div className="divider" />
          {!demo && s.address && J === 'USDC' ? (
            <>
              <b>Turn it into cash</b>
              <MoneyGramCard address={s.address} />
            </>
          ) : (
            <small className="muted">{demo ? 'In the live app, MoneyGram turns the USDC into cash at a shop near you.' : `MoneyGram only accepts Circle USDC: on this test pool the ${J} stay in your wallet.`}</small>
          )}
          <div className="chips">
            <a className="btn" href="#accueil">See my loan</a>
            <button className="btn" onClick={() => { setEtape('saisie'); setPreuves([]) }}>Get more</button>
          </div>
        </div>
      )}
      {!pret && etape !== 'fait' && <MarketHoursNote />}
    </>
  )
}
