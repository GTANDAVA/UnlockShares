extern crate std;

use super::*;
use soroban_sdk::{
    auth::{CreateContractHostFnContext, ContractExecutable},
    testutils::{Address as _, Ledger},
    BytesN, IntoVal, String,
};

struct Monde {
    e: Env,
    client: GardienClient<'static>,
    compte: Address,
    cle_gardien: Signer,
    regle: ContextRule,
    hub: Address,
    usdc: Address,
}

const UNITE: i128 = 10_000_000;

fn regle(e: &Env, id: u32, signers: Vec<Signer>, t: ContextRuleType) -> ContextRule {
    ContextRule {
        id,
        context_type: t,
        name: String::from_str(e, "gardien"),
        signers,
        signer_ids: Vec::new(e),
        policies: Vec::new(e),
        policy_ids: Vec::new(e),
        valid_until: None,
    }
}

fn monde() -> Monde {
    let e = Env::default();
    e.mock_all_auths();
    let hub = Address::generate(&e);
    let usdc = Address::generate(&e);
    let id = e.register(Gardien, (hub.clone(), usdc.clone(), 17_280u32));
    let client = GardienClient::new(&e, &id);
    let compte = Address::generate(&e);
    let cle_gardien = Signer::Delegated(Address::generate(&e));
    let regle = regle(&e, 3, Vec::from_array(&e, [cle_gardien.clone()]), ContextRuleType::Default);
    client.install(&(20 * UNITE).into_val(&e), &regle, &compte);
    Monde { e, client, compte, cle_gardien, regle, hub, usdc }
}

fn appel(e: &Env, contrat: &Address, f: &str, args: Vec<Val>) -> Context {
    Context::Contract(ContractContext { contract: contrat.clone(), fn_name: Symbol::new(e, f), args })
}

fn rembourser(m: &Monde, emprunteur: &Address, montant: i128) -> Context {
    let jeton = Address::generate(&m.e);
    appel(&m.e, &m.hub, "rembourser", Vec::from_array(&m.e, [emprunteur.into_val(&m.e), jeton.into_val(&m.e), montant.into_val(&m.e)]))
}

fn transfert(m: &Monde, jeton: &Address, de: &Address, vers: &Address, montant: i128) -> Context {
    appel(&m.e, jeton, "transfer", Vec::from_array(&m.e, [de.into_val(&m.e), vers.into_val(&m.e), montant.into_val(&m.e)]))
}

fn signe(m: &Monde) -> Vec<Signer> {
    Vec::from_array(&m.e, [m.cle_gardien.clone()])
}

fn code(r: Result<Result<(), soroban_sdk::ConversionError>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>) -> Erreur {
    match r {
        Err(Ok(err)) => {
            let n = err.get_code();
            [Erreur::Interdit, Erreur::PlafondDepasse, Erreur::DejaInstalle, Erreur::PasInstalle, Erreur::ReglagesInvalides, Erreur::PasSigne, Erreur::MontantInvalide, Erreur::ListePleine]
                .into_iter()
                .find(|x| *x as u32 == n)
                .expect("code inconnu")
        }
        other => panic!("refus attendu, obtenu {:?}", other.is_ok()),
    }
}

#[test]
fn remboursement_permis() {
    let m = monde();
    // Un remboursement = 2 contextes : hub.rembourser puis usdc.transfer(compte → hub).
    m.client.enforce(&rembourser(&m, &m.compte, 5 * UNITE), &signe(&m), &m.regle, &m.compte);
    m.client.enforce(&transfert(&m, &m.usdc, &m.compte, &m.hub, 5 * UNITE), &signe(&m), &m.regle, &m.compte);
    let etat = m.client.etat(&m.compte, &m.regle.id).unwrap();
    assert_eq!(etat.depense, 5 * UNITE);
}

#[test]
fn emprunter_refuse() {
    let m = monde();
    let c = appel(&m.e, &m.hub, "emprunter", Vec::from_array(&m.e, [m.compte.into_val(&m.e), m.usdc.into_val(&m.e), (5 * UNITE).into_val(&m.e)]));
    assert_eq!(code(m.client.try_enforce(&c, &signe(&m), &m.regle, &m.compte)), Erreur::Interdit);
}

#[test]
fn retirer_et_retirer_fonds_refuses() {
    let m = monde();
    for f in ["retirer", "retirer_fonds", "deposer", "fournir", "fixer_prix_demo"] {
        let c = appel(&m.e, &m.hub, f, Vec::from_array(&m.e, [m.compte.into_val(&m.e)]));
        assert_eq!(code(m.client.try_enforce(&c, &signe(&m), &m.regle, &m.compte)), Erreur::Interdit, "{f}");
    }
}

#[test]
fn rembourser_la_dette_d_un_autre_refuse() {
    let m = monde();
    let autre = Address::generate(&m.e);
    assert_eq!(code(m.client.try_enforce(&rembourser(&m, &autre, UNITE), &signe(&m), &m.regle, &m.compte)), Erreur::Interdit);
}

#[test]
fn usdc_vers_un_inconnu_refuse() {
    let m = monde();
    let voleur = Address::generate(&m.e);
    assert_eq!(code(m.client.try_enforce(&transfert(&m, &m.usdc, &m.compte, &voleur, UNITE), &signe(&m), &m.regle, &m.compte)), Erreur::Interdit);
}

#[test]
fn autre_jeton_refuse() {
    // Les actions (ou tout autre jeton) ne peuvent pas sortir, même vers le hub.
    let m = monde();
    let action = Address::generate(&m.e);
    assert_eq!(code(m.client.try_enforce(&transfert(&m, &action, &m.compte, &m.hub, UNITE), &signe(&m), &m.regle, &m.compte)), Erreur::Interdit);
    let autre_contrat = Address::generate(&m.e);
    let c = appel(&m.e, &autre_contrat, "rembourser", Vec::from_array(&m.e, [m.compte.into_val(&m.e)]));
    assert_eq!(code(m.client.try_enforce(&c, &signe(&m), &m.regle, &m.compte)), Erreur::Interdit);
}

#[test]
fn creation_de_contrat_refusee() {
    let m = monde();
    let c = Context::CreateContractHostFn(CreateContractHostFnContext {
        executable: ContractExecutable::Wasm(BytesN::from_array(&m.e, &[0; 32])),
        salt: BytesN::from_array(&m.e, &[1; 32]),
    });
    assert_eq!(code(m.client.try_enforce(&c, &signe(&m), &m.regle, &m.compte)), Erreur::Interdit);
}

#[test]
fn plafond_par_periode() {
    let m = monde();
    let verser = |n: i128| m.client.try_enforce(&transfert(&m, &m.usdc, &m.compte, &m.hub, n * UNITE), &signe(&m), &m.regle, &m.compte);
    assert!(verser(15).is_ok());
    assert_eq!(code(verser(6)), Erreur::PlafondDepasse); // 15 + 6 > 20
    assert!(verser(5).is_ok()); // pile 20
    // Période suivante : compteur remis à zéro.
    m.e.ledger().with_mut(|l| l.sequence_number += 17_280);
    assert!(verser(20).is_ok());
}

#[test]
fn montant_nul_ou_negatif_refuse() {
    let m = monde();
    let v = |n: i128| m.client.try_enforce(&transfert(&m, &m.usdc, &m.compte, &m.hub, n), &signe(&m), &m.regle, &m.compte);
    assert_eq!(code(v(0)), Erreur::MontantInvalide);
    assert_eq!(code(v(-1)), Erreur::MontantInvalide);
}

#[test]
fn sans_la_signature_du_gardien_refuse() {
    let m = monde();
    let aucun: Vec<Signer> = Vec::new(&m.e);
    assert_eq!(code(m.client.try_enforce(&rembourser(&m, &m.compte, UNITE), &aucun, &m.regle, &m.compte)), Erreur::PasSigne);
    let intrus = Vec::from_array(&m.e, [Signer::Delegated(Address::generate(&m.e))]);
    assert_eq!(code(m.client.try_enforce(&rembourser(&m, &m.compte, UNITE), &intrus, &m.regle, &m.compte)), Erreur::PasSigne);
}

#[test]
fn installation_controlee() {
    let m = monde();
    let p: Val = (20 * UNITE).into_val(&m.e);
    // Deux fois la même règle : refusé.
    assert_eq!(code(m.client.try_install(&p, &m.regle, &m.compte)), Erreur::DejaInstalle);
    // Règle limitée à un seul contrat : refusé (il faut couvrir hub + USDC).
    let r2 = regle(&m.e, 4, signe(&m), ContextRuleType::CallContract(m.hub.clone()));
    assert_eq!(code(m.client.try_install(&p, &r2, &m.compte)), Erreur::Interdit);
    // Plafond nul ou pas un nombre : refusé.
    let r3 = regle(&m.e, 5, signe(&m), ContextRuleType::Default);
    assert_eq!(code(m.client.try_install(&0i128.into_val(&m.e), &r3, &m.compte)), Erreur::ReglagesInvalides);
    assert_eq!(code(m.client.try_install(&m.hub.to_val(), &r3, &m.compte)), Erreur::ReglagesInvalides);
    // Plafond encodé en u64 ou u32 par le site : accepté.
    let r4 = regle(&m.e, 6, signe(&m), ContextRuleType::Default);
    m.client.install(&(20u64 * 10_000_000).into_val(&m.e), &r4, &m.compte);
    assert_eq!(m.client.etat(&m.compte, &6).unwrap().plafond, 20 * UNITE);
    let r5 = regle(&m.e, 7, signe(&m), ContextRuleType::Default);
    m.client.install(&20u32.into_val(&m.e), &r5, &m.compte);
    assert_eq!(m.client.reglages(), Reglages { hub: m.hub.clone(), usdc: m.usdc.clone(), periode: 17_280 });
}

#[test]
#[should_panic]
fn deploiement_periode_nulle_refuse() {
    let e = Env::default();
    e.register(Gardien, (Address::generate(&e), Address::generate(&e), 0u32));
}

#[test]
fn liste_des_comptes_suivis() {
    let m = monde();
    assert_eq!(m.client.inscrits(), Vec::from_array(&m.e, [Inscrit { compte: m.compte.clone(), regle: 3 }]));
    let autre = Address::generate(&m.e);
    let r = regle(&m.e, 1, signe(&m), ContextRuleType::Default);
    m.client.install(&(5 * UNITE).into_val(&m.e), &r, &autre);
    assert_eq!(m.client.inscrits().len(), 2);
    m.client.uninstall(&m.regle, &m.compte);
    assert_eq!(m.client.inscrits(), Vec::from_array(&m.e, [Inscrit { compte: autre, regle: 1 }]));
}

#[test]
fn desactivation() {
    let m = monde();
    m.client.uninstall(&m.regle, &m.compte);
    assert!(m.client.etat(&m.compte, &m.regle.id).is_none());
    assert_eq!(code(m.client.try_enforce(&rembourser(&m, &m.compte, UNITE), &signe(&m), &m.regle, &m.compte)), Erreur::PasInstalle);
}
