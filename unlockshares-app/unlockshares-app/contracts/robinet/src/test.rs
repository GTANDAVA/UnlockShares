#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, IssuerFlags, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

const U: i128 = 10_000_000;

fn decor() -> (Env, RobinetClient<'static>, TokenClient<'static>, TokenClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let aapl = env.register_stellar_asset_contract_v2(Address::generate(&env));
    aapl.issuer().set_flag(IssuerFlags::RequiredFlag);
    aapl.issuer().set_flag(IssuerFlags::RevocableFlag);
    let usdc = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let id = env.register(Robinet, (admin, aapl.address(), usdc.address(), 100 * U, 5_000 * U, 3_600u64));
    StellarAssetClient::new(&env, &aapl.address()).set_admin(&id);
    StellarAssetClient::new(&env, &usdc.address()).set_admin(&id);
    let r = RobinetClient::new(&env, &id);
    let a = TokenClient::new(&env, &aapl.address());
    let u = TokenClient::new(&env, &usdc.address());
    (env, r, a, u)
}

#[test]
fn recevoir_autorise_et_distribue() {
    let (env, r, a, u) = decor();
    let lea = Address::generate(&env);
    r.recevoir(&lea);
    assert_eq!(a.balance(&lea), 100 * U);
    assert_eq!(u.balance(&lea), 5_000 * U);
    assert!(StellarAssetClient::new(&env, &a.address).authorized(&lea));
}

#[test]
fn une_fois_par_heure() {
    let (env, r, a, _) = decor();
    let lea = Address::generate(&env);
    r.recevoir(&lea);
    assert_eq!(r.try_recevoir(&lea), Err(Ok(Erreur::TropTot)));
    env.ledger().with_mut(|l| l.timestamp += 3_600);
    r.recevoir(&lea);
    assert_eq!(a.balance(&lea), 200 * U);
}

#[test]
fn autoriser_un_contrat() {
    let (env, r, a, _) = decor();
    let contrat = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &a.address);
    assert!(!sac.authorized(&contrat));
    r.autoriser(&contrat);
    assert!(sac.authorized(&contrat));
}

#[test]
fn creer_pour_remplir_la_caisse() {
    let (env, r, a, u) = decor();
    let caisse = Address::generate(&env);
    r.creer(&caisse, &0, &(20_000 * U));
    assert_eq!(u.balance(&caisse), 20_000 * U);
    assert_eq!(a.balance(&caisse), 0);
}
