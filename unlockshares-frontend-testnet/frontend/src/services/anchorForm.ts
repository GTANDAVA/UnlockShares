// Formulaire de l'anchor de TEST (testanchor.stellar.org) rempli dans l'appli, sans quitter la page.
// Sa page web n'est qu'un écran devant un petit serveur (/start puis /submit) ouvert à tous les sites (CORS) :
// on envoie les mêmes champs que cette page. Raccourci de testnet seulement : un vrai anchor garde toujours sa propre page
// (vérification d'identité). Si ce serveur ne répond pas, l'appli propose la page de l'anchor en secours.

const SERVEUR_FORMULAIRE = 'https://anchor-reference-server-testanchor.stellar.org'

export type ChampsDepot = { amount: string; name: string; surname: string; email: string }
export type ChampsRetrait = ChampsDepot & { bank: string; account: string }

/** Vrai si l'adresse du formulaire est celle de l'anchor de test (seul cas où l'on sait remplir le formulaire ici) */
export const formulaireIntegrable = (url: string) => {
  try { return new URL(url).host.endsWith('testanchor.stellar.org') && !!new URL(url).searchParams.get('token') } catch { return false }
}

export async function envoyerFormulaire(url: string, champs: ChampsDepot | ChampsRetrait): Promise<void> {
  const jeton = new URL(url).searchParams.get('token')
  if (!jeton) throw new Error('The anchor form link is incomplete.')
  const s = await fetch(`${SERVEUR_FORMULAIRE}/start`, { method: 'POST', headers: { Authorization: `Bearer ${jeton}` } })
  const { sessionId, error } = (await s.json().catch(() => ({}))) as { sessionId?: string; error?: string }
  if (!s.ok || !sessionId) throw new Error(error ?? `The anchor form did not open (${s.status}).`)
  const r = await fetch(`${SERVEUR_FORMULAIRE}/submit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionId}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(champs),
  })
  const j = (await r.json().catch(() => ({}))) as { error?: string }
  if (!r.ok || j.error) throw new Error(j.error ?? `The anchor refused the form (${r.status}).`)
}
