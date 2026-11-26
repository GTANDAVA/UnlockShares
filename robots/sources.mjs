// Lecture du cours d'une action (Apple par défaut) dans les deux sources gratuites.
// Aucune dépendance : ce fichier se teste sans réseau (on lui passe un faux `fetch`).

export const DECIMALES = 7;
const AGE_MAX_BOURSE_S = 30 * 60; // un cours de plus de 30 min est trop vieux
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

/** Jours fériés de la bourse de New York (NYSE), 2026-2027 : bourse fermée toute la journée. À compléter chaque année. */
export const JOURS_FERIES = new Set([
  '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18',
  '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);
/** Demi-journées : la bourse ferme à 13 h (heure de New York). */
export const DEMI_JOURNEES = new Set(['2026-11-27', '2026-12-24', '2027-11-26']);

/** Séance de New York ouverte (lun-ven, 9 h 30 - 16 h, heure de New York, hors jours fériés et demi-journées) ? */
export function seanceOuverte(date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return false;
  const jour = `${p.year}-${p.month}-${p.day}`;
  if (JOURS_FERIES.has(jour)) return false;
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  const fin = DEMI_JOURNEES.has(jour) ? 13 * 60 : 16 * 60;
  return minutes >= 9 * 60 + 30 && minutes < fin;
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

/** Yahoo Finance : dernier cours de bourse (adresse publique du graphique, sans clé, non officielle). */
export async function lireYahoo(fetchFn = fetch, maintenant = new Date(), ageMaxS = AGE_MAX_BOURSE_S, titre = 'AAPL') {
  if (!/^[A-Z]{1,6}$/.test(titre)) throw new Error(`titre invalide : ${titre}`);
  const r = await fetchFn(`https://query1.finance.yahoo.com/v8/finance/chart/${titre}?interval=1m&range=1d`, {
    headers: { 'user-agent': 'Mozilla/5.0 (UnlockShares price robot)', accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
  const j = await r.json();
  const meta = j?.chart?.result?.[0]?.meta;
  if (!meta || !(meta.regularMarketPrice > 0) || !(meta.regularMarketTime > 0)) throw new Error('cours Yahoo vide');
  if (meta.symbol && meta.symbol !== titre) throw new Error(`mauvais titre : ${meta.symbol}`);
  if (meta.currency && meta.currency !== 'USD') throw new Error(`mauvaise devise : ${meta.currency}`);
  const age = Math.floor(maintenant.getTime() / 1000) - meta.regularMarketTime;
  if (age > ageMaxS) throw new Error(`cours Yahoo trop vieux (${Math.round(age / 60)} min)`);
  return { source: 'yahoo', prix: verifierBornes(versUnites(meta.regularMarketPrice.toString())), date: new Date(meta.regularMarketTime * 1000) };
}
