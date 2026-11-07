// Logos des tokens (marques Apple, BlackBerry, Stellar : tracés du paquet simple-icons, licence CC0).
// USDC est dessiné ici (cercle bleu, $ entre deux arcs) car simple-icons ne l'inclut pas.
import { siApple, siBlackberry, siStellar } from 'simple-icons'

export type TokenKind = 'usdc' | 'aapl' | 'spy' | 'bb' | 'ewy' | 'xlm'

const Brand = ({ path, title }: { path: string; title: string }) => (
  <svg viewBox="0 0 24 24" className="tok-logo" role="img" aria-label={title} fill="currentColor"><path d={path} /></svg>
)

const Usdc = () => (
  <svg viewBox="0 0 32 32" className="tok-full" role="img" aria-label="USDC">
    <circle cx="16" cy="16" r="16" fill="#2775ca" />
    <path d="M12.5 7.2a9.6 9.6 0 0 0 0 17.6M19.5 7.2a9.6 9.6 0 0 1 0 17.6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <text x="16" y="20.6" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff" fontFamily="Arial, sans-serif">$</text>
  </svg>
)

/** Logo d'un token ; null quand on n'en a pas (le ticker texte reste affiché) */
export function TokenLogo({ kind }: { kind: TokenKind }) {
  if (kind === 'usdc') return <Usdc />
  if (kind === 'aapl') return <Brand path={siApple.path} title="Apple" />
  if (kind === 'xlm') return <Brand path={siStellar.path} title="Stellar Lumens" />
  if (kind === 'bb') return <Brand path={siBlackberry.path} title="BlackBerry" />
  return null
}

/** Logo du réseau Stellar (remplace le petit « S ») */
export const StellarLogo = () => (
  <svg viewBox="0 0 24 24" className="net" role="img" aria-label="Stellar" fill="currentColor"><path d={siStellar.path} /></svg>
)
