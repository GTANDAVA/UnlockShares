// Lecture du cours d'Apple dans les deux sources gratuites.
// Aucune dépendance : ce fichier se teste sans réseau (on lui passe un faux `fetch`).

export const DECIMALES = 7;
const AGE_MAX_FINNHUB_S = 30 * 60; // un cours de plus de 30 min est trop vieux
const BORNES = { min: 1, max: 10_000 }; // en dollars, garde-fou local avant l'envoi

/** "187.405" -> 1874050000n (7 décimales), sans passer par les nombres à virgule. */
export function versUnites(texte) {
  const s = String(texte).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`prix illisible : ${s}`);
  const [ent, frac = ''] = s.split('.');
  const f = (frac + '0'.repeat(DECIMALES)).slice(0, DECIMALES);
  return BigInt(ent) * 10n ** BigInt(DECIMALES) + BigInt(f);
}

export function versDollars(unites) {
  const u = BigInt(unites);
  const d = 10n ** BigInt(DECIMALES);
  return `${u / d}.${(u % d).toString().padStart(DECIMALES, '0').slice(0, 4)}`;
}

function verifierBornes(unites) {
  const d = 10n ** BigInt(DECIMALES);
  if (unites < BigInt(BORNES.min) * d || unites > BigInt(BORNES.max) * d) {
    throw new Error(`prix hors bornes : ${versDollars(unites)} $`);
  }
  return unites;
}

/** Séance de New York ouverte (lun-ven, 9 h 30 - 16 h, heure de New York) ? Jours fériés non gérés : Finnhub renvoie alors un vieux cours, refusé par l'âge. */
export function seanceOuverte(date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return false;
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

/** Hyperliquid : prix ORACLE (pas le prix d'échange) du marché xyz:AAPL, disponible 24 h/24. */
export async function lireHyperliquid(fetchFn = fetch, marche = 'xyz:AAPL') {
  const dex = marche.includes(':') ? marche.split(':')[0] : '';
  const r = await fetchFn('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs', dex }),
  });
  if (!r.ok) throw new Error(`Hyperliquid HTTP ${r.status}`);
  const [meta, ctxs] = await r.json();
  const court = marche.split(':').pop();
  const i = meta.universe.findIndex((a) => a.name === marche || a.name === court);
  if (i < 0) throw new Error(`marché ${marche} introuvable chez Hyperliquid`);
  const ctx = ctxs[i];
  if (!ctx || ctx.oraclePx == null) throw new Error('prix oracle absent');
  return { source: 'hyperliquid', prix: verifierBornes(versUnites(ctx.oraclePx)), date: new Date() };
}

/** Finnhub : dernier cours de bourse (offre gratuite, clé personnelle). */
export async function lireFinnhub(fetchFn = fetch, cle, maintenant = new Date()) {
  if (!cle) throw new Error('clé Finnhub manquante (secret FINNHUB_CLE)');
  const r = await fetchFn(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${encodeURIComponent(cle)}`);
  if (!r.ok) throw new Error(`Finnhub HTTP ${r.status}`);
  const q = await r.json();
  if (!(q.c > 0) || !(q.t > 0)) throw new Error('cours Finnhub vide');
  const age = Math.floor(maintenant.getTime() / 1000) - q.t;
  if (age > AGE_MAX_FINNHUB_S) throw new Error(`cours Finnhub trop vieux (${Math.round(age / 60)} min)`);
  return { source: 'finnhub', prix: verifierBornes(versUnites(q.c.toString())), date: new Date(q.t * 1000) };
}
