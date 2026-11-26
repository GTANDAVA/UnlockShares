// Robot rapporteur : lit le cours d'une action (TITRE, Apple par défaut) et l'envoie à SON contrat oracle-prix.
// Par défaut il est en LECTURE SEULE : il affiche le prix et n'envoie rien.
// Il n'envoie que si ENVOYER=oui ET que les secrets sont présents.
//
//   node rapporteur.mjs hyperliquid      (24 h/24)
//   node rapporteur.mjs yahoo            (pendant la séance de New York seulement)
//
// Variables : TITRE (AAPL, NVDA, TSLA… ; défaut AAPL), ENVOYER, ORACLE_ID (l'oracle de ce titre), RAPPORTEUR_CLE (secret),
//             FORCER_LECTURE=oui (lecture seule : lit Yahoo même séance fermée, pour tester),
//             RPC_URL (défaut testnet), RESEAU (défaut testnet).
import { lireYahoo, lireYahooSiOuvert, lireHyperliquid, seanceOuverte, versDollars } from './sources.mjs';

const source = process.argv[2];
const titre = (process.env.TITRE || 'AAPL').trim().toUpperCase();
const envoyer = process.env.ENVOYER === 'oui';

async function lire() {
  if (source === 'hyperliquid') return lireHyperliquid(fetch, process.env.MARCHE_HL || `xyz:${titre}`);
  if (source === 'yahoo') {
    // Le test forcé n'existe qu'en lecture seule : un vieux cours n'est jamais envoyé.
    if (process.env.FORCER_LECTURE === 'oui' && !envoyer) return lireYahoo(fetch, new Date(), Infinity, titre);
    if (!seanceOuverte()) return null;
    // Jour férié ou séance écourtée : cours trop vieux = bourse fermée, rien à faire (pas d'erreur).
    return lireYahooSiOuvert(fetch, new Date(), titre);
  }
  throw new Error('source inconnue : hyperliquid ou yahoo');
}

async function soumettre(prix) {
  const sdk = await import('@stellar/stellar-sdk');
  const { Keypair, rpc, TransactionBuilder, Operation, Address, nativeToScVal, scValToNative, Networks, BASE_FEE } = sdk;
  // Les valeurs collées dans GitHub gardent parfois un espace ou un retour à la ligne : on les retire.
  const ORACLE_ID = (process.env.ORACLE_ID || '').trim();
  const RAPPORTEUR_CLE = (process.env.RAPPORTEUR_CLE || '').trim();
  if (!ORACLE_ID || !RAPPORTEUR_CLE) throw new Error('ORACLE_ID ou RAPPORTEUR_CLE manquant');
  const moi = Keypair.fromSecret(RAPPORTEUR_CLE);
  const serveur = new rpc.Server(process.env.RPC_URL || 'https://soroban-testnet.stellar.org');
  const reseau = process.env.RESEAU === 'public' ? Networks.PUBLIC : Networks.TESTNET;
  // Les 2 robots votent souvent dans la même seconde. Celui qui passe en second a simulé AVANT le vote de l'autre :
  // son vote déclenche alors le calcul du prix accepté, plus coûteux que prévu, et Stellar le refuse
  // (INVOKE_HOST_FUNCTION_RESOURCE_LIMIT_EXCEEDED). Parade : nouvel essai avec une simulation à jour (jusqu'à 3 essais).
  let derniere;
  for (let essai = 1; essai <= 3; essai++) {
    try {
      return await unEssai();
    } catch (e) {
      derniere = e;
      console.log(`[${source}] essai ${essai} refusé (${e.message}) : nouvelle simulation dans quelques secondes`);
      await new Promise((ok) => setTimeout(ok, 3000 + Math.floor(Math.random() * 5000)));
    }
  }
  throw derniere;

  async function unEssai() {
  const compte = await serveur.getAccount(moi.publicKey());
  let tx = new TransactionBuilder(compte, { fee: BASE_FEE, networkPassphrase: reseau })
    .addOperation(Operation.invokeContractFunction({
      contract: ORACLE_ID,
      function: 'soumettre',
      args: [new Address(moi.publicKey()).toScVal(), nativeToScVal(prix, { type: 'i128' })],
    }))
    .setTimeout(60)
    .build();
  tx = await serveur.prepareTransaction(tx);
  tx.sign(moi);
  const envoi = await serveur.sendTransaction(tx);
  if (envoi.status === 'ERROR') throw new Error(`envoi refusé : ${JSON.stringify(envoi.errorResult)}`);
  for (let i = 0; i < 30; i++) {
    const r = await serveur.getTransaction(envoi.hash);
    if (r.status === 'SUCCESS') return { hash: envoi.hash, resultat: scValToNative(r.returnValue) };
    if (r.status === 'FAILED') throw new Error(`transaction échouée ${envoi.hash}`);
    await new Promise((ok) => setTimeout(ok, 2000));
  }
  throw new Error(`pas de confirmation pour ${envoi.hash}`);
  }
}

try {
  const lu = await lire();
  if (!lu) {
    console.log(`[${source}] séance de New York fermée : rien à faire.`);
    process.exit(0);
  }
  console.log(`[${source}] ${titre} = ${versDollars(lu.prix)} $ (unités : ${lu.prix}, cours du ${lu.date.toISOString()})`);
  if (!envoyer) {
    console.log(`[${source}] lecture seule : rien n'est envoyé (ENVOYER=oui pour envoyer).`);
    process.exit(0);
  }
  const { hash, resultat } = await soumettre(lu.prix);
  console.log(`[${source}] envoyé, résultat du contrat : ${JSON.stringify(resultat, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`);
  console.log(`[${source}] preuve : https://stellar.expert/explorer/${process.env.RESEAU === 'public' ? 'public' : 'testnet'}/tx/${hash}`);
} catch (e) {
  console.error(`[${source}] ERREUR : ${e.message}`);
  process.exit(1);
}
