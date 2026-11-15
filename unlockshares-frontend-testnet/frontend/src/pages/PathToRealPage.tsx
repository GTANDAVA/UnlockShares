import { ExternalLink } from 'lucide-react'

/** Statut vérifié dans github.com/stellar/stellar-protocol (ecosystem/) le 15/11/2026. */
const SEP = (n: string) => `https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-${n}.md`

const Lien = ({ href, children }: { href: string; children: string }) => (
  <a href={href} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>{children}<ExternalLink className="i" aria-hidden style={{ width: 12, height: 12, marginLeft: 2 }} /></a>
)

type Ligne = { quoi: string; aujourdhui: string; reel: string; standards: { nom: string; statut: string; href: string }[] }

const LIGNES: Ligne[] = [
  {
    quoi: 'The share',
    aujourdhui: 'tAAPL, a test token with no value. Like a regulated registrar, its issuer must approve every holder and can freeze or take back tokens.',
    reel: 'Shares issued on Stellar by a licensed issuer, with the same holder approval and compliance rules.',
    standards: [
      { nom: 'SEP-8 Regulated Assets', statut: 'Active', href: SEP('0008') },
      { nom: 'SEP-57 T-REX regulated tokens', statut: 'Draft', href: SEP('0057') },
    ],
  },
  {
    quoi: 'The price',
    aujourdhui: 'Two robots report the Apple price to an on-chain oracle: a price is accepted when both agree within 1 %; outside market hours one robot can move it by at most 10 %. New loans stop if the price is more than 4 days old.',
    reel: 'A professional price oracle with the same interface (for example Reflector), monitored 24/7.',
    standards: [{ nom: 'SEP-40 Oracle Consumer Interface', statut: 'Draft', href: SEP('0040') }],
  },
  {
    quoi: 'The dollars',
    aujourdhui: 'Circle USDC on Stellar testnet (free from the faucet).',
    reel: 'Circle USDC on Stellar mainnet: the same token, real money.',
    standards: [],
  },
  {
    quoi: 'Cash in and out',
    aujourdhui: 'MoneyGram Ramps sandbox and a Stellar test anchor. The bank transfer is simulated.',
    reel: 'Production MoneyGram access and anchors, with identity checks (KYC) for every user.',
    standards: [
      { nom: 'SEP-24 Hosted deposit and withdrawal', statut: 'Active', href: SEP('0024') },
      { nom: 'SEP-12 KYC API', statut: 'Active', href: SEP('0012') },
    ],
  },
  {
    quoi: 'The contracts',
    aujourdhui: 'Open source, covered by unit tests and a public CI, tested on testnet. Not audited.',
    reel: 'An independent security audit before any real money, and a written upgrade plan.',
    standards: [],
  },
  {
    quoi: 'The rules',
    aujourdhui: 'A demo: tokens have no value, nobody is checked.',
    reel: 'Lending against securities is regulated: licences and legal review in each country where the service is offered.',
    standards: [],
  },
]

/** « Chemin vers le réel » : ce qui est simulé aujourd'hui et ce qu'il faudrait pour un vrai service. Faits vérifiés uniquement. */
export function PathToRealPage() {
  return (
    <>
      <div className="head">
        <div>
          <h1>Path to real</h1>
          <p className="muted">What runs today on Stellar testnet, and what a real service would need. No partner is claimed: these are the steps, not promises.</p>
        </div>
      </div>
      <div className="tbl"><table>
        <thead><tr><th>Piece</th><th>Today (testnet)</th><th>To go live</th><th>Stellar standards</th></tr></thead>
        <tbody>
          {LIGNES.map((l) => (
            <tr key={l.quoi}>
              <td><b>{l.quoi}</b></td>
              <td>{l.aujourdhui}</td>
              <td>{l.reel}</td>
              <td>
                {l.standards.length ? l.standards.map((s) => (
                  <div key={s.nom}><Lien href={s.href}>{s.nom}</Lien><small>{s.statut === 'Draft' ? 'draft standard' : 'active standard'}</small></div>
                )) : '–'}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p className="small muted">Standard statuses checked on github.com/stellar/stellar-protocol in November 2026. “Draft” means the standard is still being discussed and may change.</p>
    </>
  )
}
