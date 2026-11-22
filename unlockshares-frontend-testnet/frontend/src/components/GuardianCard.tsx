import { LoaderCircle, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { chain, hubV2 } from '../chainConfig'
import { estPasskey, hubV2 as h2, jetonPret, lienTx, messageErreur } from '../services/chain'
import { activerGardien, desactiverGardien, lireGardien, type EtatGardien } from '../services/passkey'
import { ALERTE_GARDIEN, CIBLE_GARDIEN, fixerGardienActif } from './gardienEtat'

// Gardien (option, désactivée par défaut). Hub v1 : comptes passkey seulement (règle du compte + contrat gardien).
// Hub v2 : tous les comptes (passkey et Varial), par un mandat stocké dans le hub.
// Analogie : on confie au voisin une clé qui n'ouvre QUE la boîte aux lettres du prêteur : il peut y déposer un
// remboursement pendant qu'on dort, mais il ne peut rien sortir de la maison.
// Les limites sont vérifiées sur Stellar par le contrat gardien (contracts/gardien), pas par ce site.

const PLAFOND_PAR_DEFAUT = 20

/** État du gardien : mandat dans le hub (v2) ou règle du compte passkey (v1). */
async function lireEtat(address: string | null): Promise<EtatGardien> {
  if (hubV2) return { actif: !!(address && (await h2.lireMandat(address))?.robot === chain.gardienRobot) }
  return lireGardien(chain.gardien)
}

export function GuardianCard({ address, debt }: { address: string | null; debt: number }) {
  const dispo = hubV2 ? !!chain.gardienRobot && !!address : !!chain.gardien && !!chain.gardienRobot && estPasskey(address)
  const [etat, setEtat] = useState<EtatGardien | null>(null)
  const [plafond, setPlafond] = useState(String(PLAFOND_PAR_DEFAUT))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [hash, setHash] = useState('')

  useEffect(() => {
    if (!dispo) return
    let fini = false
    lireEtat(address)
      .then((e) => { if (!fini) setEtat(e) })
      .catch(() => { if (!fini) setEtat({ actif: false }) })
    return () => { fini = true }
  }, [dispo, address])

  useEffect(() => { fixerGardienActif(!!etat?.actif) }, [etat])
  // Même lecture que la jauge : la dette en % du collatéral.
  const pc = (x: number) => Math.round(x * 100)

  // Proposé après le premier emprunt, ou tant qu'il est actif (pour pouvoir l'arrêter).
  if (!dispo || !etat || (!debt && !etat.actif)) return null

  const agir = async (activer: boolean) => {
    setBusy(true); setErr(''); setHash('')
    try {
      const cap = Number(plafond.replace(',', '.'))
      const h = hubV2
        ? activer ? await h2.fixerMandat(address!, chain.gardienRobot, cap, () => undefined) : await h2.retirerMandat(address!)
        : activer ? await activerGardien(chain.gardien, chain.gardienRobot, cap) : await desactiverGardien(etat.regle!)
      setHash(h)
      setEtat(await lireEtat(address))
    } catch (e) {
      setErr(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pos onboard guardian">
      <div className="head">
        <h3><ShieldCheck className="i" aria-hidden />Guardian</h3>
        <span className="tag">{etat.actif ? 'On' : 'Off'} · optional</span>
      </div>
      <span className="muted">
        While you sleep, if your debt reaches {pc(ALERTE_GARDIEN)} % of your collateral (the danger zone),
        the guardian pays part of it back for you with the {jetonPret()} already in your wallet, down to {pc(CIBLE_GARDIEN)} %. It can <b>only pay back</b>: it cannot borrow, take your shares
        back or send your money anywhere else. You can turn it off at any time.
      </span>
      {etat.actif ? (
        <div className="chips">
          <button className="btn" onClick={() => agir(false)} disabled={busy}>
            {busy ? <LoaderCircle className="i spin" aria-hidden /> : null}Turn off
          </button>
        </div>
      ) : (
        <div className="chips">
          <label className="muted">
            Daily limit{' '}
            <input inputMode="decimal" value={plafond} onChange={(e) => setPlafond(e.target.value)} style={{ width: '5em' }} aria-label={`Daily limit in ${jetonPret()}`} />{' '}
            {jetonPret()}
          </label>
          <button className="btn primary" onClick={() => agir(true)} disabled={busy}>
            {busy ? <LoaderCircle className="i spin" aria-hidden /> : <ShieldCheck className="i" aria-hidden />}Turn on {estPasskey(address) ? 'with passkey' : 'in Varial'}
          </button>
        </div>
      )}
      <small className="muted">Testnet preview. {estPasskey(address) ? 'Network fees are paid by UnlockShares.' : hubV2 ? 'Two signatures in Varial: allow the pool to take up to your limit, then give the mandate.' : ''}</small>
      {hash && <small><a href={lienTx(hash)} target="_blank" rel="noreferrer">See the transaction</a></small>}
      {err && <small className="co-err">{err}</small>}
    </div>
  )
}
