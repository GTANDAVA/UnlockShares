import { ExternalLink, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { envoyerFormulaire, formulaireIntegrable } from '../services/anchorForm'
import { messageErreur } from '../services/chain'

// Le formulaire de l'anchor de test, affiché dans l'appli (aucun onglet à ouvrir ni à fermer).
// Valeurs de test pré-remplies : l'anchor de test ne vérifie rien et aucun argent réel ne bouge.
export function AnchorInlineForm({ url, kind, amount, onDone }: { url: string; kind: 'deposit' | 'withdrawal'; amount: string; onDone: () => void }) {
  const [name, setName] = useState('Lea')
  const [surname, setSurname] = useState('Martin')
  const [email, setEmail] = useState('lea.martin@example.com')
  const [bank, setBank] = useState('Test Bank')
  const [account, setAccount] = useState('0001234567')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (!formulaireIntegrable(url)) {
    return <div className="chips"><a className="btn primary" href={url} target="_blank" rel="noreferrer">Open the anchor’s form</a></div>
  }

  const send = async () => {
    setBusy(true); setErr('')
    try {
      await envoyerFormulaire(url, kind === 'deposit' ? { amount, name, surname, email } : { amount, name, surname, email, bank, account })
      onDone()
    } catch (e) {
      setErr(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  const champ = (label: string, v: string, set: (x: string) => void, type = 'text') => (
    <label className="co-field co-field-dark">
      <span>{label}</span>
      <input type={type} value={v} onChange={(e) => set(e.target.value)} autoComplete="off" />
    </label>
  )

  return (
    <div className="co-inline">
      <b>Test anchor form <span className="tag">Testnet</span></b>
      <small className="muted">Test values are fine: the test anchor checks nothing and no real money moves.</small>
      {champ('First name', name, setName)}
      {champ('Last name', surname, setSurname)}
      {champ('Email', email, setEmail, 'email')}
      {kind === 'withdrawal' && champ('Bank', bank, setBank)}
      {kind === 'withdrawal' && champ('Account number', account, setAccount)}
      <div className="chips">
        <button className="btn primary" onClick={() => void send()} disabled={busy || !name.trim() || !surname.trim() || !email.includes('@')}>
          {busy ? <LoaderCircle className="i spin" /> : null}Confirm {kind === 'deposit' ? 'deposit' : 'cash out'} of {amount} USDC
        </button>
        <a className="btn" href={url} target="_blank" rel="noreferrer"><ExternalLink className="i" />Anchor’s page</a>
      </div>
      {err && <p className="co-err">{err} You can use the anchor’s page instead.</p>}
    </div>
  )
}
