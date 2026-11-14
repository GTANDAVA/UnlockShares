#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger}, token::{StellarAssetClient, TokenClient}, Address, Env};

const U: i128 = UNITE;

struct Decor<'a> {
    env: Env,
    pret: UnlockSharesClient<'a>,
    aapl: TokenClient<'a>,
    usdc: TokenClient<'a>,
    admin: Address,
    lea: Address,
    preteur: Address,
    liquidateur: Address,
}

/// Prix 100 tUSDC. Léa a 10 tAAPL, le prêteur 1 000 tUSDC (déjà fournis),
/// le liquidateur 1 000 tUSDC. Plafonds très larges : les tests historiques gardent leur sens.
fn decor(demo_perso: bool) -> Decor<'static> {
    decor_plafonds(demo_perso, 1_000_000 * U, 10_000)
}

fn decor_plafonds(demo_perso: bool, plafond_fixe: i128, plafond_bps: i128) -> Decor<'static> {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let aapl_id = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
    let usdc_id = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
    let id = env.register(UnlockShares, (admin.clone(), aapl_id.clone(), usdc_id.clone(), 100 * U, plafond_fixe, plafond_bps, demo_perso));
    let pret = UnlockSharesClient::new(&env, &id);
    let lea = Address::generate(&env);
    let preteur = Address::generate(&env);
    let liquidateur = Address::generate(&env);
    StellarAssetClient::new(&env, &aapl_id).mint(&lea, &(10 * U));
    StellarAssetClient::new(&env, &usdc_id).mint(&preteur, &(1_000 * U));
    StellarAssetClient::new(&env, &usdc_id).mint(&liquidateur, &(1_000 * U));
    pret.fournir(&preteur, &(1_000 * U));
    Decor {
        aapl: TokenClient::new(&env, &aapl_id),
        usdc: TokenClient::new(&env, &usdc_id),
        env, pret, admin, lea, preteur, liquidateur,
    }
}

#[test]
fn fournir_remplit_la_caisse() {
    let d = decor(false);
    let m = d.pret.marche();
    assert_eq!(m.caisse, 1_000 * U);
    assert_eq!(m.total_fourni, 1_000 * U);
    assert_eq!(d.pret.fourni(&d.preteur), 1_000 * U);
}

#[test]
fn deposer_puis_emprunter_jusqua_50_pourcent() {
    let d = decor(false);
    d.pret.deposer(&d.lea, &(10 * U)); // valeur 1 000
    let v = d.pret.position(&d.lea);
    assert_eq!(v.valeur, 1_000 * U);
    assert_eq!(v.disponible, 500 * U);
    d.pret.emprunter(&d.lea, &(500 * U));
    assert_eq!(d.usdc.balance(&d.lea), 500 * U);
    let v = d.pret.position(&d.lea);
    assert_eq!(v.ltv_bps, 5_000);
    assert_eq!(v.disponible, 0);
    assert_eq!(v.prix_liquidation, 625_000_000); // 62,5 tUSDC
    assert!(!v.liquidable);
}

#[test]
fn emprunter_trop_est_refuse() {
    let d = decor(false);
    d.pret.deposer(&d.lea, &(10 * U));
    assert_eq!(d.pret.try_emprunter(&d.lea, &(501 * U)), Err(Ok(Erreur::GarantieInsuffisante)));
}

#[test]
fn caisse_vide() {
    let d = decor(false);
    StellarAssetClient::new(&d.env, &d.aapl.address).mint(&d.lea, &(100 * U));
    d.pret.deposer(&d.lea, &(110 * U)); // valeur 11 000, limite 5 500 > caisse 1 000
    assert_eq!(d.pret.try_emprunter(&d.lea, &(1_001 * U)), Err(Ok(Erreur::CaisseVide)));
}

#[test]
fn montant_nul_refuse() {
    let d = decor(false);
    assert_eq!(d.pret.try_deposer(&d.lea, &0), Err(Ok(Erreur::MontantInvalide)));
    assert_eq!(d.pret.try_emprunter(&d.lea, &-5), Err(Ok(Erreur::MontantInvalide)));
}

#[test]
fn rembourser_puis_retirer_ses_actions() {
    let d = decor(false);
    d.pret.deposer(&d.lea, &(10 * U));
    d.pret.emprunter(&d.lea, &(300 * U));
    // Avec 300 de dette, elle ne peut pas tout reprendre.
    assert_eq!(d.pret.try_retirer(&d.lea, &(10 * U)), Err(Ok(Erreur::GarantieInsuffisante)));
    // V2 : un montant trop grand est débité puis l'excédent est rendu.
    StellarAssetClient::new(&d.env, &d.usdc.address).mint(&d.lea, &(100 * U));
    assert_eq!(d.pret.rembourser(&d.lea, &(400 * U)), 300 * U);
    assert_eq!(d.usdc.balance(&d.lea), 100 * U);
    assert_eq!(d.pret.try_rembourser(&d.lea, &U), Err(Ok(Erreur::PasDeDette)));
    d.pret.retirer(&d.lea, &(10 * U));
    assert_eq!(d.aapl.balance(&d.lea), 10 * U);
    assert_eq!(d.pret.marche().total_emprunte, 0);
}

/// Vérifie que le dernier appel a exigé la signature de `qui` (et de personne d'autre).
fn signe_par(d: &Decor, qui: &Address) {
    let auths = d.env.auths();
    assert_eq!(auths.len(), 1, "une seule signature attendue");
    assert_eq!(&auths[0].0, qui);
}

#[test]
fn prix_de_reference_admin_seulement() {
    // Même en mode démo perso, le prix GLOBAL n'est modifiable que par l'admin.
    let d = decor(true);
    d.pret.fixer_prix(&(40 * U));
    signe_par(&d, &d.admin);
    assert_eq!(d.pret.marche().prix, 40 * U);
    assert_eq!(d.pret.try_fixer_prix(&0), Err(Ok(Erreur::PrixInvalide)));
}

#[test]
fn scenario_complet_de_liquidation() {
    let d = decor(true);
    d.pret.deposer(&d.lea, &(10 * U));
    d.pret.emprunter(&d.lea, &(500 * U));
    // À 70, LTV = 71 % : pas encore liquidable.
    d.pret.fixer_prix(&(70 * U));
    assert_eq!(d.pret.try_liquider(&d.liquidateur, &d.lea, &U), Err(Ok(Erreur::PasLiquidable)));
    // Le prix s'effondre à 40 : LTV = 125 %.
    d.pret.fixer_prix(&(40 * U));
    assert!(d.pret.position(&d.lea).liquidable);
    let saisie = d.pret.liquider(&d.liquidateur, &d.lea, &d.pret.montant_liquidable(&d.lea));
    // Il faudrait 500 × 1,05 / 40 = 13,125 actions : plafonné aux 10 déposées.
    assert_eq!(saisie, 10 * U);
    assert_eq!(d.aapl.balance(&d.liquidateur), 10 * U);
    assert_eq!(d.usdc.balance(&d.liquidateur), 500 * U);
    let v = d.pret.position(&d.lea);
    assert_eq!((v.garantie, v.dette), (0, 0));
    // Les prêteurs retrouvent toute leur caisse.
    assert_eq!(d.pret.marche().caisse, 1_000 * U);
    d.pret.retirer_fonds(&d.preteur, &(1_000 * U));
    assert_eq!(d.usdc.balance(&d.preteur), 1_000 * U);
}

#[test]
fn liquidation_partielle_ramene_a_60_pourcent() {
    let d = decor(true);
    d.pret.deposer(&d.lea, &(10 * U));
    d.pret.emprunter(&d.lea, &(500 * U));
    d.pret.fixer_prix(&(60 * U)); // valeur 600, LTV 83 %
    let saisie = d.pret.liquider(&d.liquidateur, &d.lea, &d.pret.montant_liquidable(&d.lea));
    // Remboursé : (500 - 60 % × 600) / (1 - 0,63) = 378,38 USDC ; saisie : 378,38 × 1,05 / 60 = 6,62 actions.
    let rembourse = 1_000 * U - d.usdc.balance(&d.liquidateur);
    assert_eq!(rembourse, 3_783_783_784);
    assert_eq!(saisie, 66_216_216);
    assert_eq!(d.aapl.balance(&d.liquidateur), saisie);
    let v = d.pret.position(&d.lea);
    assert_eq!(v.garantie, 10 * U - saisie);
    assert_eq!(v.dette, 500 * U - rembourse);
    // Léa garde un prêt sain à 60 %.
    assert!(v.ltv_bps >= 5_990 && v.ltv_bps <= 6_000, "ltv {}", v.ltv_bps);
    assert!(!v.liquidable);
    assert_eq!(d.pret.try_liquider(&d.liquidateur, &d.lea, &U), Err(Ok(Erreur::PasLiquidable)));
    assert_eq!(d.pret.marche().total_emprunte, v.dette);
}

#[test]
fn au_dela_de_95_pourcent_liquidation_totale() {
    let d = decor(true);
    d.pret.deposer(&d.lea, &(10 * U));
    d.pret.emprunter(&d.lea, &(500 * U));
    d.pret.fixer_prix(&(52 * U)); // valeur 520, LTV 96 %
    let max = d.pret.montant_liquidable(&d.lea);
    // Payer un peu moins que toute la dette prendrait toute la garantie et laisserait une dette sans garantie : refusé.
    assert_eq!(d.pret.try_liquider(&d.liquidateur, &d.lea, &(max - 10)), Err(Ok(Erreur::MontantInvalide)));
    let saisie = d.pret.liquider(&d.liquidateur, &d.lea, &(max + 1_000));
    // Revenir à 60 % est impossible : toute la dette est payée, 500 × 1,05 / 52 = 10,096 > 10 actions.
    assert_eq!(saisie, 10 * U);
    assert_eq!(d.usdc.balance(&d.liquidateur), 500 * U);
    let v = d.pret.position(&d.lea);
    assert_eq!((v.garantie, v.dette), (0, 0));
}

#[test]
fn liquidation_partielle_a_92_pourcent() {
    let d = decor(true);
    d.pret.deposer(&d.lea, &(10 * U));
    d.pret.emprunter(&d.lea, &(500 * U));
    d.pret.fixer_prix(&(54 * U)); // valeur 540, LTV 92,6 % : partiel encore possible
    d.pret.liquider(&d.liquidateur, &d.lea, &d.pret.montant_liquidable(&d.lea));
    let v = d.pret.position(&d.lea);
    assert!(v.dette > 0 && v.ltv_bps <= 6_000);
}

#[test]
fn preteur_ne_retire_pas_les_fonds_empruntes() {
    let d = decor(false);
    d.pret.deposer(&d.lea, &(10 * U));
    d.pret.emprunter(&d.lea, &(500 * U));
    assert_eq!(d.pret.try_retirer_fonds(&d.preteur, &(600 * U)), Err(Ok(Erreur::CaisseVide)));
    assert_eq!(d.pret.try_retirer_fonds(&d.preteur, &(2_000 * U)), Err(Ok(Erreur::SoldeInsuffisant)));
    d.pret.retirer_fonds(&d.preteur, &(500 * U));
    assert_eq!(d.pret.fourni(&d.preteur), 500 * U);
}

// ---------- intérêts ----------

fn avancer(d: &Decor, secondes: u64) {
    d.env.ledger().with_mut(|l| l.timestamp += secondes);
}

#[test]
fn le_taux_suit_la_courbe_a_coude() {
    let d = decor(false);
    let m = d.pret.marche();
    // Personne n'emprunte : 0 % pour tout le monde.
    assert_eq!((m.utilisation_bps, m.taux_emprunt_bps, m.taux_depot_bps), (0, 0, 0));
    d.pret.deposer(&d.lea, &(10 * U));
    d.pret.emprunter(&d.lea, &(500 * U));
    let m = d.pret.marche();
    // 50 % utilisé : 50 % × 6 % / 80 % = 3,75 % ; prêteurs : 3,75 % × 50 % × 90 % = 1,6875 %.
    assert_eq!((m.utilisation_bps, m.taux_emprunt_bps, m.taux_depot_bps), (5_000, 375, 168));
}

#[test]
fn courbe_au_coude_et_au_maximum() {
    let r = reglages_defaut();
    assert_eq!(taux_emprunt_bps(0, &r), 0);
    assert_eq!(taux_emprunt_bps(5_000, &r), 375);
    assert_eq!(taux_emprunt_bps(8_000, &r), 600);
    assert_eq!(taux_emprunt_bps(9_000, &r), 3_300);
    assert_eq!(taux_emprunt_bps(10_000, &r), 6_000);
}

#[test]
fn un_an_d_interets_puis_tout_le_monde_est_paye() {
    let d = decor(false);
    d.pret.deposer(&d.lea, &(10 * U));
    d.pret.emprunter(&d.lea, &(500 * U)); // 50 % utilisé : 3,75 %
    avancer(&d, ANNEE); // le vrai temps du ledger
    // Dette : 500 × 1,0375 = 518,75. Intérêts 18,75 : 1,875 en réserve, 16,875 aux prêteurs.
    assert_eq!(d.pret.position(&d.lea).dette, 5_187_500_000);
    assert_eq!(d.pret.fourni(&d.preteur), 10_168_750_000);
    let m = d.pret.marche();
    assert_eq!((m.total_emprunte, m.reserve), (5_187_500_000, 18_750_000));
    // Léa rembourse tout, intérêts compris.
    StellarAssetClient::new(&d.env, &d.usdc.address).mint(&d.lea, &(19 * U));
    assert_eq!(d.pret.rembourser(&d.lea, &(519 * U)), 5_187_500_000); // 0,25 d'excédent rendu
    assert_eq!(d.usdc.balance(&d.lea), 25 * U / 100);
    assert_eq!(d.pret.position(&d.lea).dette, 0);
    // La réserve reste en caisse : le prêteur ne peut pas prendre 1 centime de plus que sa part.
    assert_eq!(d.pret.try_retirer_fonds(&d.preteur, &(10_168_750_001)), Err(Ok(Erreur::SoldeInsuffisant)));
    // Le prêteur repart avec 1 016,875 ; l'admin avec la réserve ; la caisse est vide.
    d.pret.retirer_fonds(&d.preteur, &10_168_750_000);
    assert_eq!(d.usdc.balance(&d.preteur), 10_168_750_000);
    assert_eq!(d.pret.marche().caisse, 18_750_000);
    d.pret.retirer_reserve(&18_750_000);
    assert_eq!(d.usdc.balance(&d.admin), 18_750_000);
    let m = d.pret.marche();
    assert_eq!((m.caisse, m.reserve), (0, 0));
}

#[test]
fn la_reserve_ne_peut_pas_etre_empruntee() {
    let d = decor(true);
    StellarAssetClient::new(&d.env, &d.aapl.address).mint(&d.lea, &(100 * U));
    d.pret.deposer(&d.lea, &(110 * U)); // limite d'emprunt 5 500, bien au-delà de la caisse
    d.pret.emprunter(&d.lea, &(500 * U));
    avancer(&d, ANNEE);
    StellarAssetClient::new(&d.env, &d.usdc.address).mint(&d.lea, &(19 * U));
    d.pret.rembourser(&d.lea, &(519 * U));
    // Caisse : 1 018,75 dont 1,875 de réserve → on peut emprunter 1 016,875, pas plus.
    assert_eq!(d.pret.try_emprunter(&d.lea, &10_168_750_001), Err(Ok(Erreur::CaisseVide)));
    d.pret.emprunter(&d.lea, &10_168_750_000);
}

#[test]
fn les_interets_comptent_dans_la_limite_de_50_pourcent() {
    let d = decor(false);
    d.pret.deposer(&d.lea, &(10 * U));
    d.pret.emprunter(&d.lea, &(500 * U));
    avancer(&d, ANNEE); // dette 518,75 > 500
    assert_eq!(d.pret.position(&d.lea).disponible, 0);
    assert_eq!(d.pret.try_emprunter(&d.lea, &U), Err(Ok(Erreur::GarantieInsuffisante)));
}

#[test]
fn les_interets_peuvent_rendre_liquidable() {
    let d = decor(false);
    d.pret.deposer(&d.lea, &(10 * U));
    d.pret.emprunter(&d.lea, &(500 * U));
    avancer(&d, 17 * ANNEE); // 500 × (1 + 3,75 % × 17) = 818,75 > 800
    assert_eq!(d.pret.position(&d.lea).dette, 8_187_500_000);
    assert!(d.pret.position(&d.lea).liquidable);
    d.pret.liquider(&d.liquidateur, &d.lea, &d.pret.montant_liquidable(&d.lea));
    assert!(!d.pret.position(&d.lea).liquidable);
}

// ---------- V2 : plafonds ----------

#[test]
fn plafond_fixe_par_adresse() {
    let d = decor_plafonds(false, 50 * U, 10_000);
    d.pret.deposer(&d.lea, &(10 * U)); // valeur 1 000 : la LTV autoriserait 500
    d.pret.emprunter(&d.lea, &(50 * U));
    assert_eq!(d.pret.try_emprunter(&d.lea, &1), Err(Ok(Erreur::PlafondDepasse)));
    // Après un remboursement partiel, on peut réemprunter jusqu au plafond.
    d.pret.rembourser(&d.lea, &(10 * U));
    d.pret.emprunter(&d.lea, &(10 * U));
    assert_eq!(d.pret.position(&d.lea).dette, 50 * U);
}

#[test]
fn plafond_relatif_a_la_caisse() {
    let d = decor_plafonds(false, 1_000_000 * U, 2_000); // 20 % de la caisse libre par emprunt
    StellarAssetClient::new(&d.env, &d.aapl.address).mint(&d.lea, &(100 * U));
    d.pret.deposer(&d.lea, &(110 * U));
    assert_eq!(d.pret.try_emprunter(&d.lea, &(200 * U + 1)), Err(Ok(Erreur::PlafondDepasse)));
    d.pret.emprunter(&d.lea, &(200 * U)); // 20 % de 1 000
    assert_eq!(d.pret.try_emprunter(&d.lea, &(160 * U + 1)), Err(Ok(Erreur::PlafondDepasse)));
    d.pret.emprunter(&d.lea, &(160 * U)); // 20 % de 800
    assert_eq!(d.pret.marche().caisse, 640 * U);
}

#[test]
fn plafonds_reglables_par_l_admin_seulement() {
    let d = decor(false);
    d.pret.fixer_plafonds(&(10 * U), &500);
    signe_par(&d, &d.admin);
    let m = d.pret.marche();
    assert_eq!((m.plafond_fixe, m.plafond_caisse_bps), (10 * U, 500));
    assert_eq!(d.pret.try_fixer_plafonds(&0, &500), Err(Ok(Erreur::MontantInvalide)));
    assert_eq!(d.pret.try_fixer_plafonds(&U, &10_001), Err(Ok(Erreur::MontantInvalide)));
    d.pret.deposer(&d.lea, &(10 * U));
    assert_eq!(d.pret.try_emprunter(&d.lea, &(11 * U)), Err(Ok(Erreur::PlafondDepasse)));
}

// ---------- V2 : démo personnelle isolée ----------

/// Bob emprunte comme Léa : deux positions indépendantes.
fn deux_emprunteurs(d: &Decor) -> Address {
    let bob = Address::generate(&d.env);
    StellarAssetClient::new(&d.env, &d.aapl.address).mint(&bob, &(10 * U));
    d.pret.deposer(&d.lea, &(10 * U));
    d.pret.emprunter(&d.lea, &(300 * U));
    d.pret.deposer(&bob, &(10 * U));
    d.pret.emprunter(&bob, &(300 * U));
    bob
}

#[test]
fn prix_demo_ne_touche_que_sa_position() {
    let d = decor(true);
    let bob = deux_emprunteurs(&d);
    let bob_avant = d.pret.position(&bob);
    let marche_avant = d.pret.marche();
    d.pret.fixer_prix_demo(&d.lea, &(35 * U)); // LTV 300 / 350 = 86 % : liquidable
    signe_par(&d, &d.lea);
    let v = d.pret.position(&d.lea);
    assert!(v.liquidable && v.prix_demo_actif && v.prix == 35 * U);
    // Bob et le marché : strictement identiques.
    assert_eq!(d.pret.position(&bob), bob_avant);
    assert_eq!(d.pret.marche(), marche_avant);
    // On ne peut pas monter au-dessus du prix de référence (emprunter plus).
    assert_eq!(d.pret.try_fixer_prix_demo(&d.lea, &(100 * U + 1)), Err(Ok(Erreur::PrixInvalide)));
    assert_eq!(d.pret.try_fixer_prix_demo(&d.lea, &0), Err(Ok(Erreur::PrixInvalide)));
}

#[test]
fn liquidation_reelle_au_prix_demo_sans_vider_la_caisse() {
    let d = decor(true);
    let bob = deux_emprunteurs(&d);
    let bob_avant = d.pret.position(&bob);
    let caisse_avant = d.pret.marche().caisse;
    d.pret.fixer_prix_demo(&d.lea, &(35 * U));
    let saisie = d.pret.liquider(&d.liquidateur, &d.lea, &d.pret.montant_liquidable(&d.lea));
    assert!(saisie > 0);
    // Le liquidateur a payé en USDC : la caisse augmente, elle ne baisse jamais.
    assert!(d.pret.marche().caisse > caisse_avant);
    assert_eq!(d.aapl.balance(&d.liquidateur), saisie);
    // Bob : garantie et dette inchangées (seul le taux du marché suit le remboursement).
    let bob_apres = d.pret.position(&bob);
    assert_eq!((bob_apres.garantie, bob_apres.dette, bob_apres.prix), (bob_avant.garantie, bob_avant.dette, bob_avant.prix));
    assert!(!bob_apres.liquidable);
    // Au prix de référence, Bob n'est pas liquidable.
    assert_eq!(d.pret.try_liquider(&d.liquidateur, &bob, &U), Err(Ok(Erreur::PasLiquidable)));
}

#[test]
fn prix_demo_reinitialise_et_retrait_de_garantie() {
    let d = decor(true);
    d.pret.deposer(&d.lea, &(10 * U));
    d.pret.emprunter(&d.lea, &(200 * U));
    d.pret.fixer_prix_demo(&d.lea, &(50 * U)); // valeur 500 : 200 = 40 %
    // Au prix de démo, retirer 3 actions ferait 200 / 350 = 57 % > 50 % : refusé.
    assert_eq!(d.pret.try_retirer(&d.lea, &(3 * U)), Err(Ok(Erreur::GarantieInsuffisante)));
    d.pret.reinitialiser_prix_demo(&d.lea);
    let v = d.pret.position(&d.lea);
    assert!(!v.prix_demo_actif && v.prix == 100 * U);
    d.pret.retirer(&d.lea, &(3 * U)); // 200 / 700 = 28,6 % : accepté
}

#[test]
fn temps_perso_ne_touche_ni_les_autres_ni_les_taux() {
    let d = decor(true);
    let bob = deux_emprunteurs(&d); // 600 / 1 000 = 60 % utilisé → 4,5 %
    let marche_avant = d.pret.marche();
    let bob_avant = d.pret.position(&bob);
    let interets = d.pret.avancer_temps_perso(&d.lea, &ANNEE);
    signe_par(&d, &d.lea);
    assert_eq!(interets, 135_000_000); // 300 × 4,5 % = 13,5
    let v = d.pret.position(&d.lea);
    assert_eq!((v.dette, v.dette_demo), (3_135_000_000, 135_000_000));
    assert_eq!(d.pret.position(&bob), bob_avant);
    assert_eq!(d.pret.marche(), marche_avant); // taux, utilisation, totaux : inchangés
    assert_eq!(d.pret.fourni(&d.preteur), 1_000 * U);
    // Remboursement : les intérêts de démo vont à la réserve.
    StellarAssetClient::new(&d.env, &d.usdc.address).mint(&d.lea, &(14 * U));
    d.pret.rembourser(&d.lea, &(314 * U));
    let m = d.pret.marche();
    assert_eq!(m.reserve, 135_000_000);
    assert_eq!(d.pret.position(&d.lea).dette, 0);
    assert_eq!(d.pret.try_avancer_temps_perso(&d.lea, &0), Err(Ok(Erreur::MontantInvalide)));
    assert_eq!(d.pret.try_avancer_temps_perso(&d.lea, &ANNEE), Err(Ok(Erreur::PasDeDette)));
}

#[test]
fn temps_perso_peut_rendre_liquidable_et_paie_la_reserve() {
    let d = decor(true);
    d.pret.deposer(&d.lea, &(10 * U));
    d.pret.emprunter(&d.lea, &(500 * U)); // 50 % utilisé → 3,75 %
    d.pret.avancer_temps_perso(&d.lea, &(9 * ANNEE)); // + 168,75 → 668,75
    d.pret.fixer_prix_demo(&d.lea, &(80 * U)); // valeur 800 : 83,6 % > 80 %
    assert!(d.pret.position(&d.lea).liquidable);
    let reserve_avant = d.pret.marche().reserve;
    d.pret.liquider(&d.liquidateur, &d.lea, &d.pret.montant_liquidable(&d.lea));
    // La part « démo » remboursée par le liquidateur part en réserve, jamais chez les prêteurs.
    assert!(d.pret.marche().reserve > reserve_avant);
    assert_eq!(d.pret.fourni(&d.preteur), 1_000 * U);
}

#[test]
fn outils_demo_coupes_par_l_admin() {
    let d = decor(false);
    d.pret.deposer(&d.lea, &(10 * U));
    d.pret.emprunter(&d.lea, &(100 * U));
    assert_eq!(d.pret.try_fixer_prix_demo(&d.lea, &(50 * U)), Err(Ok(Erreur::NonAutorise)));
    assert_eq!(d.pret.try_avancer_temps_perso(&d.lea, &ANNEE), Err(Ok(Erreur::NonAutorise)));
    d.pret.fixer_demo_perso(&true);
    signe_par(&d, &d.admin);
    assert!(d.pret.marche().demo_perso);
    d.pret.fixer_prix_demo(&d.lea, &(50 * U));
}

#[test]
fn fixer_reglages_taux_change_le_taux() {
    let d = decor(false);
    assert_eq!(d.pret.reglages_taux(), reglages_defaut());
    d.pret.deposer(&d.lea, &(10 * U));
    d.pret.emprunter(&d.lea, &(500 * U));
    // Coude à 50 %, 10 % au coude : à 50 % d'utilisation, on emprunte à 10 %.
    let nouveaux = ReglagesTaux { coude_bps: 5_000, taux_coude_bps: 1_000, taux_max_bps: 8_000, reserve_bps: 2_000 };
    d.pret.fixer_reglages_taux(&nouveaux);
    assert_eq!(d.pret.reglages_taux(), nouveaux);
    let m = d.pret.marche();
    // Prêteurs : 10 % × 50 % × 80 % = 4 %.
    assert_eq!((m.taux_emprunt_bps, m.taux_depot_bps), (1_000, 400));
    avancer(&d, ANNEE);
    assert_eq!(d.pret.position(&d.lea).dette, 550 * U);
    assert_eq!(d.pret.marche().reserve, 10 * U);
    // Réglages invalides refusés.
    let mauvais = [
        ReglagesTaux { coude_bps: 0, ..nouveaux.clone() },
        ReglagesTaux { coude_bps: 10_000, ..nouveaux.clone() },
        ReglagesTaux { taux_coude_bps: -1, ..nouveaux.clone() },
        ReglagesTaux { taux_max_bps: 500, ..nouveaux.clone() },
        ReglagesTaux { reserve_bps: 5_001, ..nouveaux.clone() },
    ];
    for r in mauvais.iter() {
        assert_eq!(d.pret.try_fixer_reglages_taux(r), Err(Ok(Erreur::MontantInvalide)));
    }
}

#[test]
#[should_panic]
fn fixer_reglages_taux_admin_seulement() {
    let d = decor(false);
    d.env.set_auths(&[]); // plus de signature automatique
    d.pret.fixer_reglages_taux(&reglages_defaut());
}

#[test]
fn interets_seconde_par_seconde() {
    // Beaucoup de petites mises à jour donnent le même résultat qu'une grande (à l'arrondi près).
    let d = decor(false);
    d.pret.deposer(&d.lea, &(10 * U));
    d.pret.emprunter(&d.lea, &(500 * U));
    for _ in 0..100 {
        avancer(&d, 5);
        d.pret.rembourser(&d.lea, &1); // force une mise à jour du compteur
    }
    let dette = d.pret.position(&d.lea).dette;
    // 500 × 3,75 % × 500 s / 1 an ≈ 2 973 unités d'intérêts, moins les 100 unités remboursées.
    assert!(dette > 500 * U + 2_700 && dette < 500 * U + 3_100, "dette {}", dette);
}

// ---------- V2 : montants exacts (compatibles avec les signatures Soroban) ----------

#[test]
fn liquidation_au_montant_exact_et_borne() {
    let d = decor(false);
    d.pret.deposer(&d.lea, &(10 * U));
    d.pret.emprunter(&d.lea, &(500 * U));
    d.pret.fixer_prix(&(60 * U));
    let max = d.pret.montant_liquidable(&d.lea);
    assert_eq!(max, 3_783_783_784);
    assert_eq!(d.pret.try_liquider(&d.liquidateur, &d.lea, &0), Err(Ok(Erreur::MontantInvalide)));
    // L'appli envoie le montant lu + une marge : seul `max` est réellement payé, l'excédent est rendu.
    d.pret.liquider(&d.liquidateur, &d.lea, &(max + 1_000));
    assert_eq!(1_000 * U - d.usdc.balance(&d.liquidateur), max);
    assert_eq!(d.pret.montant_liquidable(&d.lea), 0);
    assert_eq!(d.pret.try_liquider(&d.liquidateur, &d.lea, &U), Err(Ok(Erreur::PasLiquidable)));
}

#[test]
fn rembourser_plus_que_la_dette_rend_l_excedent() {
    let d = decor(false);
    d.pret.deposer(&d.lea, &(10 * U));
    d.pret.emprunter(&d.lea, &(100 * U));
    StellarAssetClient::new(&d.env, &d.usdc.address).mint(&d.lea, &(5 * U));
    assert_eq!(d.pret.rembourser(&d.lea, &(105 * U)), 100 * U);
    assert_eq!(d.usdc.balance(&d.lea), 5 * U);
    assert_eq!(d.pret.position(&d.lea).dette, 0);
    assert_eq!(d.pret.marche().caisse, 1_000 * U);
}
