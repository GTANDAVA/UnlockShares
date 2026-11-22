import { LoaderCircle, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { chain } from '../chainConfig'
import { estPasskey, jetonPret, lienTx, messageErreur } from '../services/chain'
import { activerGardien, desactiverGardien, lireGardien, type EtatGardien } from '../services/passkey'

// Gardien (option, désactivée par défaut, comptes passkey seulement).
// Analogie : on confie au voisin une clé qui n'ouvre QUE la boîte aux lettres du prêteur : il peut y déposer un
// remboursement pendant qu'on dort, mais il ne peut rien sortir de la maison.
// Les limites sont vérifiées sur Stellar par le contrat gardien (contracts/gardien), pas par ce site.

const PLAFOND_PAR_DEFAUT = 20

export function GuardianCard({ address, debt }: { address: string | null; debt: number }) {
  const dispo = !!chain.gardien && !!chain.gardienRobot && estPasskey(address)
  const [etat, setEtat] = useState<EtatGardien | null>(null)
  const [plafond, setPlafond] = useState(String(PLAFOND_PAR_DEFAUT))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [hash, setHash] = useState('')

  useEffect(() => {
    if (!dispo) return
    let fini = false
    lireGardien(chain.gardien)
      .then((e) => { if (!fini) setEtat(e) })
      .catch(() => { if (!fini) setEtat({ actif: false }) })
    return () => { fini = true }
  }, [dispo, address])

  // Proposé après le premier emprunt, ou tant qu'il est actif (pour pouvoir l'arrêter).
  if (!dispo || !etat || (!debt && !etat.actif)) return null

  const agir = async (activer: boolean) => {
    setBusy(true); setErr(''); setHash('')
    try {
      const h = activer
        ? await activerGardien(chain.gardien, chain.gardienRobot, Number(plafond.replace(',', '.')))
        : await desactiverGardien(etat.regle!)
      setHash(h)
      setEtat(await lireGardien(chain.gardien))
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
        While you sleep, if your loan gets close to the danger zone, the guardian pays part of it back for you with
        the {jetonPret()} already in your wallet. It can <b>only pay back</b>: it cannot borrow, take your shares
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
            {busy ? <LoaderCircle className="i spin" aria-hidden /> : <ShieldCheck className="i" aria-hidden />}Turn on with passkey
          </button>
        </div>
      )}
      <small className="muted">Testnet preview. Network fees are paid by UnlockShares.</small>
      {hash && <small><a href={lienTx(hash)} target="_blank" rel="noreferrer">See the transaction</a></small>}
      {err && <small className="co-err">{err}</small>}
    </div>
  )
}
