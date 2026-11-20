#![cfg(test)]
use super::*;
use soroban_sdk::{symbol_short, testutils::{Address as _, Ledger}, token::{StellarAssetClient, TokenClient}, Address, Env};

const U: i128 = UNITE;

mod faux_oracle {
    use crate::{Asset, PriceData};
    use soroban_sdk::{contract, contractimpl, symbol_short, Env, Symbol};

    /// Oracle SEP-40 de test : un seul actif, nom, décimales et prix réglables.
    #[contract]
    pub struct FauxOracle;

    #[contractimpl]
    impl FauxOracle {
        pub fn __constructor(env: Env, decimales: u32, nom: Symbol) {
            env.storage().instance().set(&symbol_short!("dec"), &decimales);
            env.storage().instance().set(&symbol_short!("nom"), &nom);
        }
        pub fn poser(env: Env, prix: i128, date: u64) {
            env.storage().instance().set(&symbol_short!("px"), &PriceData { price: prix, timestamp: date });
        }
        pub fn decimals(env: Env) -> u32 {
            env.storage().instance().get(&symbol_short!("dec")).unwrap()
        }
        pub fn lastprice(env: Env, asset: Asset) -> Option<PriceData> {
            let nom: Symbol = env.storage().instance().get(&symbol_short!("nom")).unwrap();
            if asset != Asset::Other(nom) {
                return None;
            }
            env.storage().instance().get(&symbol_short!("px"))
        }
    }
}
use faux_oracle::{FauxOracle, FauxOracleClient};

struct Decor<'a> {
    env: Env,
    hub: HubClient<'a>,
    aapl: Address,
    tsla: Address,
    usdc: TokenClient<'a>,
    lea: Address,
    preteur: Address,
    liquidateur: Address,
}

fn regles_aapl() -> Regles {
    Regles { ltv_max_bps: 5_000, seuil_bps: 8_000, bonus_bps: 500, cible_bps: 6_000, prime_bps: 50, plafond_bps: 6_000 }
}

fn regles_tsla() -> Regles {
    Regles { ltv_max_bps: 4_000, seuil_bps: 7_000, bonus_bps: 500, cible_bps: 5_000, prime_bps: 200, plafond_bps: 1_500 }
}

/// Hub de 1 000 USDC. Spokes : Apple à 100 USDC, Tesla à 200 USDC.
/// Léa a 10 tAAPL et 5 tTSLA ; le liquidateur a 1 000 USDC.
fn decor_avec(plafond_fixe: i128, caisse_bps: i128, demo: bool) -> Decor<'static> {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let aapl = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
    let tsla = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
    let usdc_id = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
    let id = env.register(Hub, (admin, usdc_id.clone(), plafond_fixe, caisse_bps, demo));
    let hub = HubClient::new(&env, &id);
    hub.ajouter_spoke(&aapl, &regles_aapl(), &(100 * U));
    hub.ajouter_spoke(&tsla, &regles_tsla(), &(200 * U));
    let lea = Address::generate(&env);
    let preteur = Address::generate(&env);
    let liquidateur = Address::generate(&env);
    StellarAssetClient::new(&env, &aapl).mint(&lea, &(10 * U));
    StellarAssetClient::new(&env, &tsla).mint(&lea, &(5 * U));
    StellarAssetClient::new(&env, &usdc_id).mint(&preteur, &(1_000 * U));
    StellarAssetClient::new(&env, &usdc_id).mint(&liquidateur, &(1_000 * U));
    hub.fournir(&preteur, &(1_000 * U));
    Decor { usdc: TokenClient::new(&env, &usdc_id), env, hub, aapl, tsla, lea, preteur, liquidateur }
}

fn decor() -> Decor<'static> {
    decor_avec(1_000_000 * U, 10_000, true)
}

#[test]
fn le_hub_recoit_les_prets_et_liste_les_spokes() {
    let d = decor();
    let m = d.hub.marche();
    assert_eq!(m.total_fourni, 1_000 * U);
    assert_eq!(m.caisse, 1_000 * U);
    assert_eq!(m.nb_spokes, 2);
    let s = d.hub.spokes();
    assert_eq!(s.len(), 2);
    assert_eq!(s.get(0).unwrap().jeton, d.aapl);
    assert_eq!(s.get(1).unwrap().prix, 200 * U);
    assert_eq!(s.get(1).unwrap().reste_plafond, 150 * U); // 15 % de 1 000
}

#[test]
fn chaque_spoke_a_son_ratio() {
    let d = decor();
    d.hub.deposer(&d.lea, &d.aapl, &(10 * U)); // 1 000 USDC de valeur
    d.hub.deposer(&d.lea, &d.tsla, &(1 * U)); // 200 USDC de valeur
    assert_eq!(d.hub.position(&d.lea, &d.aapl).disponible, 500 * U); // 50 %
    assert_eq!(d.hub.position(&d.lea, &d.tsla).disponible, 80 * U); // 40 %
    assert_eq!(d.hub.try_emprunter(&d.lea, &d.tsla, &(81 * U)), Err(Ok(Erreur::GarantieInsuffisante)));
    d.hub.emprunter(&d.lea, &d.tsla, &(80 * U));
    d.hub.emprunter(&d.lea, &d.aapl, &(300 * U));
    assert_eq!(d.usdc.balance(&d.lea), 380 * U);
    assert_eq!(d.hub.positions(&d.lea).len(), 2);
    assert_eq!(d.hub.marche().total_emprunte, 380 * U);
}

#[test]
fn une_action_qui_s_effondre_ne_touche_pas_les_autres() {
    let d = decor();
    d.hub.deposer(&d.lea, &d.aapl, &(10 * U));
    d.hub.deposer(&d.lea, &d.tsla, &(1 * U));
    d.hub.emprunter(&d.lea, &d.aapl, &(500 * U));
    d.hub.emprunter(&d.lea, &d.tsla, &(80 * U));
    d.hub.fixer_prix(&d.tsla, &(100 * U)); // Tesla perd 50 %
    assert!(d.hub.position(&d.lea, &d.tsla).liquidable);
    assert!(!d.hub.position(&d.lea, &d.aapl).liquidable);
    assert_eq!(d.hub.try_liquider(&d.liquidateur, &d.lea, &d.aapl, &(10 * U)), Err(Ok(Erreur::PasLiquidable)));
    // Liquidation partielle aux règles Tesla : la dette revient à la cible de 50 %, le liquidateur
    // reçoit des tTSLA valant ce qu'il paie + 5 %.
    let saisie = d.hub.liquider(&d.liquidateur, &d.lea, &d.tsla, &(80 * U));
    assert_eq!(TokenClient::new(&d.env, &d.tsla).balance(&d.liquidateur), saisie);
    let paye = 80 * U - d.hub.position(&d.lea, &d.tsla).dette;
    assert_eq!(saisie, paye * 105 / 100 / 100); // prix 100, bonus 5 %
    let v = d.hub.position(&d.lea, &d.tsla);
    assert!(v.ltv_bps <= 5_000 && v.ltv_bps > 4_900, "{}", v.ltv_bps);
    assert!(!v.liquidable);
    assert_eq!(d.hub.position(&d.lea, &d.aapl).dette, 500 * U);
}

#[test]
fn le_plafond_du_spoke_limite_ce_qu_on_prete_contre_une_action() {
    let d = decor();
    d.hub.deposer(&d.lea, &d.tsla, &(5 * U)); // 1 000 de valeur, 400 empruntables
    assert_eq!(d.hub.try_emprunter(&d.lea, &d.tsla, &(151 * U)), Err(Ok(Erreur::PlafondSpoke)));
    d.hub.emprunter(&d.lea, &d.tsla, &(150 * U));
    assert_eq!(d.hub.spoke(&d.tsla).reste_plafond, 0);
}

#[test]
fn le_plafond_par_adresse_compte_tous_les_spokes() {
    let d = decor_avec(50 * U, 10_000, true);
    d.hub.deposer(&d.lea, &d.aapl, &(10 * U));
    d.hub.deposer(&d.lea, &d.tsla, &(1 * U));
    d.hub.emprunter(&d.lea, &d.aapl, &(30 * U));
    assert_eq!(d.hub.try_emprunter(&d.lea, &d.tsla, &(21 * U)), Err(Ok(Erreur::PlafondDepasse)));
    d.hub.emprunter(&d.lea, &d.tsla, &(20 * U));
}

#[test]
fn chaque_emprunt_est_limite_a_une_part_du_coffre_libre() {
    let d = decor_avec(1_000_000 * U, 2_000, true);
    d.hub.deposer(&d.lea, &d.aapl, &(10 * U));
    assert_eq!(d.hub.try_emprunter(&d.lea, &d.aapl, &(201 * U)), Err(Ok(Erreur::PlafondDepasse)));
    d.hub.emprunter(&d.lea, &d.aapl, &(200 * U));
}

#[test]
fn un_guichet_en_pause_refuse_depots_et_emprunts_mais_laisse_rembourser() {
    let d = decor();
    d.hub.deposer(&d.lea, &d.aapl, &(10 * U));
    d.hub.emprunter(&d.lea, &d.aapl, &(100 * U));
    d.hub.ouvrir_spoke(&d.aapl, &false);
    assert_eq!(d.hub.try_deposer(&d.lea, &d.aapl, &U), Err(Ok(Erreur::SpokeEnPause)));
    assert_eq!(d.hub.try_emprunter(&d.lea, &d.aapl, &U), Err(Ok(Erreur::SpokeEnPause)));
    d.hub.rembourser(&d.lea, &d.aapl, &(100 * U));
    d.hub.retirer(&d.lea, &d.aapl, &(10 * U));
    // Tesla n'est pas touché.
    d.hub.deposer(&d.lea, &d.tsla, &U);
    d.hub.emprunter(&d.lea, &d.tsla, &(10 * U));
}

#[test]
fn la_prime_de_risque_fait_payer_plus_cher_et_profite_aux_preteurs() {
    let d = decor();
    d.hub.deposer(&d.lea, &d.aapl, &(10 * U));
    d.hub.deposer(&d.lea, &d.tsla, &(5 * U));
    d.hub.emprunter(&d.lea, &d.aapl, &(100 * U));
    d.hub.emprunter(&d.lea, &d.tsla, &(100 * U));
    // Utilisation 20 % : base = 20 % × 6 % / 80 % = 1,5 %. Apple 2 %, Tesla 3,5 %.
    assert_eq!(d.hub.marche().taux_base_bps, 150);
    assert_eq!(d.hub.spoke(&d.aapl).taux_emprunt_bps, 200);
    assert_eq!(d.hub.spoke(&d.tsla).taux_emprunt_bps, 350);
    d.env.ledger().set_timestamp(d.env.ledger().timestamp() + ANNEE);
    let dette_aapl = d.hub.position(&d.lea, &d.aapl).dette;
    let dette_tsla = d.hub.position(&d.lea, &d.tsla).dette;
    // Un an d'un coup : intérêts simples (le compteur tourne à chaque opération).
    assert_eq!(dette_aapl, 102 * U);
    assert_eq!(dette_tsla, 1035 * U / 10);
    // Les prêteurs touchent 90 % des intérêts.
    let interets = dette_aapl + dette_tsla - 200 * U;
    let gain = d.hub.fourni(&d.preteur) - 1_000 * U;
    let attendu = interets * 9 / 10;
    assert!((gain - attendu).abs() < U / 100, "gain {} attendu {}", gain, attendu);
}

#[test]
fn rembourser_tout_rend_l_excedent_et_libere_les_actions() {
    let d = decor();
    d.hub.deposer(&d.lea, &d.aapl, &(10 * U));
    d.hub.emprunter(&d.lea, &d.aapl, &(100 * U));
    d.env.ledger().set_timestamp(d.env.ledger().timestamp() + 86_400);
    StellarAssetClient::new(&d.env, &d.usdc.address).mint(&d.lea, &(10 * U));
    let paye = d.hub.rembourser(&d.lea, &d.aapl, &(105 * U));
    assert!(paye > 100 * U && paye < 101 * U);
    assert_eq!(d.usdc.balance(&d.lea), 110 * U - paye);
    assert_eq!(d.hub.position(&d.lea, &d.aapl).dette, 0);
    d.hub.retirer(&d.lea, &d.aapl, &(10 * U));
    assert_eq!(d.hub.positions(&d.lea).len(), 0);
    assert_eq!(d.hub.spoke(&d.aapl).emprunte, 0);
}

#[test]
fn retirer_des_actions_garde_la_dette_sous_la_limite() {
    let d = decor();
    d.hub.deposer(&d.lea, &d.aapl, &(10 * U));
    d.hub.emprunter(&d.lea, &d.aapl, &(400 * U));
    assert_eq!(d.hub.try_retirer(&d.lea, &d.aapl, &(3 * U)), Err(Ok(Erreur::GarantieInsuffisante)));
    d.hub.retirer(&d.lea, &d.aapl, &(2 * U));
}

#[test]
fn le_prix_de_demo_ne_touche_que_sa_position_et_son_action() {
    let d = decor();
    d.hub.deposer(&d.lea, &d.aapl, &(10 * U));
    d.hub.deposer(&d.lea, &d.tsla, &(1 * U));
    d.hub.emprunter(&d.lea, &d.aapl, &(500 * U));
    d.hub.emprunter(&d.lea, &d.tsla, &(80 * U));
    assert_eq!(d.hub.try_fixer_prix_demo(&d.lea, &d.aapl, &(101 * U)), Err(Ok(Erreur::PrixInvalide)));
    d.hub.fixer_prix_demo(&d.lea, &d.aapl, &(60 * U));
    assert!(d.hub.position(&d.lea, &d.aapl).liquidable);
    assert!(d.hub.position(&d.lea, &d.aapl).prix_demo_actif);
    assert!(!d.hub.position(&d.lea, &d.tsla).liquidable);
    assert_eq!(d.hub.spoke(&d.aapl).prix, 100 * U);
    // Liquidation réelle, au prix de démo : la dette revient vers 60 %.
    d.hub.liquider(&d.liquidateur, &d.lea, &d.aapl, &(500 * U));
    let v = d.hub.position(&d.lea, &d.aapl);
    assert!(v.ltv_bps <= 6_000 && v.ltv_bps > 5_900, "{}", v.ltv_bps);
    d.hub.reinitialiser_prix_demo(&d.lea, &d.aapl);
    assert!(!d.hub.position(&d.lea, &d.aapl).prix_demo_actif);
}

#[test]
fn demo_coupee_refuse_les_outils_perso() {
    let d = decor_avec(1_000_000 * U, 10_000, false);
    d.hub.deposer(&d.lea, &d.aapl, &(10 * U));
    d.hub.emprunter(&d.lea, &d.aapl, &(100 * U));
    assert_eq!(d.hub.try_fixer_prix_demo(&d.lea, &d.aapl, &(50 * U)), Err(Ok(Erreur::NonAutorise)));
    assert_eq!(d.hub.try_avancer_temps_perso(&d.lea, &d.aapl, &ANNEE), Err(Ok(Erreur::NonAutorise)));
}

#[test]
fn le_temps_de_demo_n_augmente_que_sa_dette_et_va_en_reserve() {
    let d = decor();
    d.hub.deposer(&d.lea, &d.tsla, &(5 * U));
    d.hub.emprunter(&d.lea, &d.tsla, &(100 * U));
    let interets = d.hub.avancer_temps_perso(&d.lea, &d.tsla, &ANNEE);
    // Utilisation 10 % : base 0,75 % + prime 2 % = 2,75 %.
    assert_eq!(interets, 275 * U / 100);
    assert_eq!(d.hub.marche().total_emprunte, 100 * U);
    StellarAssetClient::new(&d.env, &d.usdc.address).mint(&d.lea, &(5 * U));
    d.hub.rembourser(&d.lea, &d.tsla, &(10_275 * U / 100));
    assert_eq!(d.hub.marche().reserve, 275 * U / 100);
}

#[test]
fn chaque_spoke_lit_son_propre_oracle_et_bloque_si_le_prix_est_vieux() {
    let d = decor();
    d.env.ledger().set_timestamp(1_000_000);
    let o = d.env.register(FauxOracle, (14u32, symbol_short!("TSLA")));
    let oracle = FauxOracleClient::new(&d.env, &o);
    oracle.poser(&(25_000_000_000_000_000), &1_000_000); // 250 $ en 14 décimales
    d.hub.fixer_oracle(&d.tsla, &Some((o.clone(), Asset::Other(symbol_short!("TSLA")))));
    assert_eq!(d.hub.spoke(&d.tsla).prix, 250 * U);
    assert!(d.hub.spoke(&d.tsla).oracle_actif);
    assert_eq!(d.hub.spoke(&d.aapl).prix, 100 * U); // Apple garde son prix administré
    assert_eq!(d.hub.try_fixer_prix(&d.tsla, &(1 * U)), Err(Ok(Erreur::NonAutorise)));
    d.hub.deposer(&d.lea, &d.tsla, &(1 * U));
    d.hub.emprunter(&d.lea, &d.tsla, &(50 * U));
    // 5 jours sans prix : nouveaux emprunts Tesla bloqués, Apple non.
    d.env.ledger().set_timestamp(1_000_000 + 5 * 86_400);
    assert_eq!(d.hub.try_emprunter(&d.lea, &d.tsla, &U), Err(Ok(Erreur::PrixPerime)));
    d.hub.deposer(&d.lea, &d.aapl, &(1 * U));
    d.hub.emprunter(&d.lea, &d.aapl, &(10 * U));
    // Rembourser reste possible.
    d.hub.rembourser(&d.lea, &d.tsla, &(10 * U));
}

#[test]
fn oracle_qui_ne_connait_pas_l_action_est_refuse() {
    let d = decor();
    let o = d.env.register(FauxOracle, (7u32, symbol_short!("NVDA")));
    FauxOracleClient::new(&d.env, &o).poser(&(100 * U), &0);
    assert_eq!(d.hub.try_fixer_oracle(&d.tsla, &Some((o, Asset::Other(symbol_short!("TSLA"))))), Err(Ok(Erreur::PrixInvalide)));
}

#[test]
fn regles_et_spokes_invalides_refuses() {
    let d = decor();
    let mut r = regles_aapl();
    r.cible_bps = 9_000; // cible au-dessus du seuil
    assert_eq!(d.hub.try_modifier_spoke(&d.aapl, &r), Err(Ok(Erreur::ReglesInvalides)));
    let mut r = regles_aapl();
    r.seuil_bps = 9_600; // 96 % × 1,05 > 100 %
    assert_eq!(d.hub.try_modifier_spoke(&d.aapl, &r), Err(Ok(Erreur::ReglesInvalides)));
    let mut r = regles_aapl();
    r.prime_bps = 2_001;
    assert_eq!(d.hub.try_modifier_spoke(&d.aapl, &r), Err(Ok(Erreur::ReglesInvalides)));
    assert_eq!(d.hub.try_ajouter_spoke(&d.aapl, &regles_aapl(), &(100 * U)), Err(Ok(Erreur::SpokeExistant)));
    assert_eq!(d.hub.try_ajouter_spoke(&d.usdc.address, &regles_aapl(), &(100 * U)), Err(Ok(Erreur::ReglesInvalides)));
    let inconnu = Address::generate(&d.env);
    assert_eq!(d.hub.try_deposer(&d.lea, &inconnu, &U), Err(Ok(Erreur::SpokeInconnu)));
}

#[test]
fn modifier_la_prime_compte_d_abord_les_interets_a_l_ancienne_prime() {
    let d = decor();
    d.hub.deposer(&d.lea, &d.tsla, &(5 * U));
    d.hub.emprunter(&d.lea, &d.tsla, &(100 * U));
    d.env.ledger().set_timestamp(d.env.ledger().timestamp() + ANNEE);
    let avant = d.hub.position(&d.lea, &d.tsla).dette;
    let mut r = regles_tsla();
    r.prime_bps = 0;
    d.hub.modifier_spoke(&d.tsla, &r);
    assert_eq!(d.hub.position(&d.lea, &d.tsla).dette, avant);
    assert_eq!(d.hub.spoke(&d.tsla).regles.prime_bps, 0);
}

#[test]
fn le_preteur_retire_dans_la_limite_de_la_caisse() {
    let d = decor();
    d.hub.deposer(&d.lea, &d.aapl, &(10 * U));
    d.hub.emprunter(&d.lea, &d.aapl, &(400 * U));
    assert_eq!(d.hub.try_retirer_fonds(&d.preteur, &(601 * U)), Err(Ok(Erreur::CaisseVide)));
    d.hub.retirer_fonds(&d.preteur, &(600 * U));
    assert_eq!(d.usdc.balance(&d.preteur), 600 * U);
}

#[test]
fn les_reglages_admin_demandent_la_signature_de_l_admin() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let usdc = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
    let aapl = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
    let id = env.register(Hub, (admin, usdc, 50 * U, 2_000i128, true));
    let hub = HubClient::new(&env, &id);
    // Sans signature de l'admin : refusé.
    assert!(hub.try_ajouter_spoke(&aapl, &regles_aapl(), &(100 * U)).is_err());
}
