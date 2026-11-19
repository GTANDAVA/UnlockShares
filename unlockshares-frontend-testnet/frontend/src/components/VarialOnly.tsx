// Dépôt / retrait : les anchors (MoneyGram, banque) ne marchent pour l'instant qu'avec Varial,
// une extension de navigateur d'ordinateur. Sur téléphone on le dit clairement au lieu d'un bouton sans issue.
const tactile = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches

export function VarialOnly({ connect, passkey = false, note }: { connect: () => void; passkey?: boolean; note?: string }) {
  if (tactile()) {
    return (
      <div className="empty">
        <b>On a computer for now</b>
        <span className="muted">Deposits and cash-outs use the Varial wallet, a computer browser extension. Fingerprint accounts on phone are coming soon.</span>
      </div>
    )
  }
  if (passkey) {
    return (
      <div className="empty">
        <b>Needs the Varial wallet for now</b>
        <span className="muted">MoneyGram and bank anchors work with a classic Stellar account. Passkey accounts are coming to this page later.</span>
      </div>
    )
  }
  return (
    <div className="empty">
      <b>Connect your wallet</b>
      {note && <span className="muted">{note}</span>}
      <button className="btn primary" onClick={() => void connect()}>Connect Varial</button>
    </div>
  )
}
