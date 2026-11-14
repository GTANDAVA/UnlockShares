#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

const U: i128 = 10_000_000;

fn decor(reserve: i128) -> (Env, DistributeurClient<'static>, TokenClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let usdc = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let id = env.register(Distributeur, (admin.clone(), usdc.address(), 20 * U, 86_400u64));
    StellarAssetClient::new(&env, &usdc.address()).mint(&id, &reserve);
    (env.clone(), DistributeurClient::new(&env, &id), TokenClient::new(&env, &usdc.address()), admin)
}

#[test]
fn donne_20_usdc() {
    let (env, d, u, _) = decor(100 * U);
    let lea = Address::generate(&env);
    assert_eq!(d.recevoir(&lea), 20 * U);
    assert_eq!(u.balance(&lea), 20 * U);
    assert_eq!(d.reserve(), 80 * U);
}

#[test]
fn une_fois_par_jour() {
    let (env, d, u, _) = decor(100 * U);
    let lea = Address::generate(&env);
    d.recevoir(&lea);
    assert_eq!(d.try_recevoir(&lea), Err(Ok(Erreur::TropTot)));
    env.ledger().with_mut(|l| l.timestamp += 86_400);
    d.recevoir(&lea);
    assert_eq!(u.balance(&lea), 40 * U);
}

#[test]
fn reserve_vide() {
    let (env, d, u, _) = decor(10 * U);
    let lea = Address::generate(&env);
    assert_eq!(d.try_recevoir(&lea), Err(Ok(Erreur::ReserveVide)));
    assert_eq!(u.balance(&lea), 0);
}

#[test]
fn admin_change_le_montant_et_retire() {
    let (_env, d, u, admin) = decor(100 * U);
    d.fixer_montant(&(30 * U));
    assert_eq!(d.montant(), 30 * U);
    assert_eq!(d.try_fixer_montant(&0), Err(Ok(Erreur::MontantInvalide)));
    d.retirer(&(40 * U));
    assert_eq!(u.balance(&admin), 40 * U);
    assert_eq!(d.reserve(), 60 * U);
}
