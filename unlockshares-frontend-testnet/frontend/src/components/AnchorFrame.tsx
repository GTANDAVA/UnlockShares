import { ExternalLink, Lock, X } from 'lucide-react'
import { useEffect } from 'react'

// Formulaire de l'anchor (SEP-24) affiché DANS l'appli, par-dessus la page : sur téléphone, un nouvel onglet
// fait perdre le chemin du retour. La SEP-24 prévoit ce mode (iframe) ; l'anchor peut prévenir par postMessage
// quand le formulaire est rempli. Lien « nouvel onglet » gardé en secours si l'anchor refuse d'être intégré.
export function AnchorFrame({ url, onClose, onMessage }: { url: string; onClose: () => void; onMessage?: () => void }) {
  const origine = new URL(url).origin

  useEffect(() => {
    const ecouter = (e: MessageEvent) => { if (e.origin === origine) onMessage?.() }
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('message', ecouter)
    window.addEventListener('keydown', echap)
    return () => { window.removeEventListener('message', ecouter); window.removeEventListener('keydown', echap) }
  }, [origine, onClose, onMessage])

  return (
    <div className="co-frame" role="dialog" aria-modal="true" aria-label="Anchor form">
      <div className="co-frame-bar">
        <Lock className="v-ic" aria-hidden />
        <span>{new URL(url).host}</span>
        <a className="btn" href={url} target="_blank" rel="noreferrer" aria-label="Open in a new tab"><ExternalLink className="i" /></a>
        <button className="btn primary" onClick={onClose}><X className="i" />Close</button>
      </div>
      <iframe src={url} title="Anchor form" allow="clipboard-write" />
    </div>
  )
}
