#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, IssuerFlags, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

const U: i128 = 10_000_000;

fn action(env: &Env, robinet: &Address) -> Address {
    let a = env.register_stellar_asset_contract_v2(Address::generate(env));
    a.issuer().set_flag(IssuerFlags::RequiredFlag);
    a.issuer().set_flag(IssuerFlags::RevocableFlag);
    StellarAssetClient::new(env, &a.address()).set_admin(robinet);
    a.address()
}

fn decor() -> (Env, RobinetActionsClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(RobinetActions, (Address::generate(&env), 3_600u64));
    let r = RobinetActionsClient::new(&env, &id);
    let aapl = action(&env, &id);
    let nvda = action(&env, &id);
    let tsla = action(&env, &id);
    r.fixer_jeton(&aapl, &(2 * U));
    r.fixer_jeton(&nvda, &(3 * U));
    r.fixer_jeton(&tsla, &U);
    (env, r, aapl, nvda, tsla)
}

#[test]
fn une_signature_donne_toutes_les_actions() {
    let (env, r, aapl, nvda, tsla) = decor();
    let lea = Address::generate(&env);
    r.recevoir(&lea);
    assert_eq!(TokenClient::new(&env, &aapl).balance(&lea), 2 * U);
    assert_eq!(TokenClient::new(&env, &nvda).balance(&lea), 3 * U);
    assert_eq!(TokenClient::new(&env, &tsla).balance(&lea), U);
    assert!(StellarAssetClient::new(&env, &tsla).authorized(&lea));
}

#[test]
fn une_fois_par_delai() {
    let (env, r, aapl, _, _) = decor();
    let lea = Address::generate(&env);
    r.recevoir(&lea);
    assert_eq!(r.try_recevoir(&lea), Err(Ok(Erreur::TropTot)));
    env.ledger().set_timestamp(env.ledger().timestamp() + 3_600);
    r.recevoir(&lea);
    assert_eq!(TokenClient::new(&env, &aapl).balance(&lea), 4 * U);
}

#[test]
fn montant_zero_ne_distribue_plus_ce_jeton() {
    let (env, r, aapl, nvda, _) = decor();
    r.fixer_jeton(&nvda, &0);
    let lea = Address::generate(&env);
    r.recevoir(&lea);
    assert_eq!(TokenClient::new(&env, &nvda).balance(&lea), 0);
    assert_eq!(TokenClient::new(&env, &aapl).balance(&lea), 2 * U);
    assert_eq!(r.try_fixer_jeton(&nvda, &-1), Err(Ok(Erreur::MontantInvalide)));
}

#[test]
fn autoriser_le_hub_sur_tous_les_jetons_et_creer() {
    let (env, r, aapl, nvda, tsla) = decor();
    let hub = Address::generate(&env);
    r.autoriser(&hub);
    for j in [&aapl, &nvda, &tsla] {
        assert!(StellarAssetClient::new(&env, j).authorized(&hub));
    }
    let lea = Address::generate(&env);
    r.creer(&lea, &nvda, &(10 * U));
    assert_eq!(TokenClient::new(&env, &nvda).balance(&lea), 10 * U);
    let inconnu = Address::generate(&env);
    assert_eq!(r.try_creer(&lea, &inconnu, &U), Err(Ok(Erreur::JetonInconnu)));
}

#[test]
fn reglages_reserves_a_l_admin() {
    let env = Env::default();
    let id = env.register(RobinetActions, (Address::generate(&env), 3_600u64));
    let r = RobinetActionsClient::new(&env, &id);
    assert!(r.try_fixer_jeton(&Address::generate(&env), &U).is_err());
    assert!(r.try_fixer_pack(&soroban_sdk::vec![&env]).is_err());
}

#[test]
fn le_pack_ne_donne_que_ses_titres() {
    let (env, r, aapl, nvda, tsla) = decor();
    r.fixer_pack(&soroban_sdk::vec![&env, aapl.clone(), tsla.clone()]);
    assert_eq!(r.pack().len(), 2);
    let lea = Address::generate(&env);
    r.recevoir(&lea);
    assert_eq!(TokenClient::new(&env, &aapl).balance(&lea), 2 * U);
    assert_eq!(TokenClient::new(&env, &tsla).balance(&lea), U);
    assert_eq!(TokenClient::new(&env, &nvda).balance(&lea), 0);
    let inconnu = Address::generate(&env);
    assert_eq!(r.try_fixer_pack(&soroban_sdk::vec![&env, inconnu]), Err(Ok(Erreur::JetonInconnu)));
}

#[test]
fn un_titre_a_la_demande_une_fois_par_delai_et_par_titre() {
    let (env, r, aapl, nvda, tsla) = decor();
    r.fixer_pack(&soroban_sdk::vec![&env, aapl.clone()]);
    let lea = Address::generate(&env);
    r.recevoir(&lea);
    // Le pack ne bloque pas les titres à la demande.
    r.recevoir_titre(&lea, &nvda);
    assert_eq!(TokenClient::new(&env, &nvda).balance(&lea), 3 * U);
    assert!(StellarAssetClient::new(&env, &nvda).authorized(&lea));
    assert_eq!(r.try_recevoir_titre(&lea, &nvda), Err(Ok(Erreur::TropTot)));
    // Un autre titre reste possible tout de suite.
    r.recevoir_titre(&lea, &tsla);
    assert_eq!(TokenClient::new(&env, &tsla).balance(&lea), U);
    env.ledger().set_timestamp(env.ledger().timestamp() + 3_600);
    r.recevoir_titre(&lea, &nvda);
    assert_eq!(TokenClient::new(&env, &nvda).balance(&lea), 6 * U);
}

#[test]
fn titre_inconnu_ou_coupe_refuse() {
    let (env, r, _, nvda, _) = decor();
    let lea = Address::generate(&env);
    assert_eq!(r.try_recevoir_titre(&lea, &Address::generate(&env)), Err(Ok(Erreur::JetonInconnu)));
    r.fixer_jeton(&nvda, &0);
    assert_eq!(r.try_recevoir_titre(&lea, &nvda), Err(Ok(Erreur::JetonInconnu)));
}
