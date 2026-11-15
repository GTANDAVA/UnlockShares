#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{symbol_short, Address, Env};

const D: i128 = 10_000_000; // 1 dollar

struct Banc {
    env: Env,
    o: OraclePrixClient<'static>,
    admin: Address,
    bourse: Address,
    continu: Address,
}

fn reglages() -> Reglages {
    Reglages {
        tolerance_bps: 100,
        fenetre_s: 600,
        saut_max_bps: 1_500,
        ecart_hors_seance_bps: 1_000,
        silence_bourse_s: 1_800,
        intervalle_min_s: 300,
        bande_min: D,
        bande_max: 10_000 * D,
    }
}

fn banc() -> Banc {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);
    let admin = Address::generate(&env);
    let bourse = Address::generate(&env);
    let continu = Address::generate(&env);
    let id = env.register(OraclePrix, (admin.clone(), bourse.clone(), continu.clone(), symbol_short!("AAPL"), 200 * D, reglages()));
    let o = OraclePrixClient::new(&env, &id);
    Banc { env, o, admin, bourse, continu }
}

fn avancer(b: &Banc, s: u64) {
    let t = b.env.ledger().timestamp();
    b.env.ledger().set_timestamp(t + s);
}

fn aapl(_b: &Banc) -> Asset {
    Asset::Other(symbol_short!("AAPL"))
}

#[test]
fn deux_temoins_d_accord_le_prix_est_accepte() {
    let b = banc();
    avancer(&b, 900);
    assert_eq!(b.o.soumettre(&b.bourse, &(201 * D)), Resultat::EnAttente);
    assert_eq!(b.o.soumettre(&b.continu, &(203 * D)), Resultat::Accepte(202 * D));
    let p = b.o.lastprice(&aapl(&b)).unwrap();
    assert_eq!(p.price, 202 * D);
    assert_eq!(b.o.dernier_confirme().price, 202 * D);
}

#[test]
fn deux_temoins_en_desaccord_rien_ne_change() {
    let b = banc();
    avancer(&b, 900);
    b.o.soumettre(&b.bourse, &(200 * D));
    assert_eq!(b.o.soumettre(&b.continu, &(205 * D)), Resultat::Refuse(REFUS_DESACCORD));
    assert_eq!(b.o.lastprice(&aapl(&b)).unwrap().price, 200 * D);
}

#[test]
fn un_seul_temoin_pendant_la_seance_ne_suffit_pas() {
    let b = banc();
    avancer(&b, 900);
    b.o.soumettre(&b.bourse, &(200 * D));
    b.o.soumettre(&b.continu, &(200 * D));
    avancer(&b, 900); // la Bourse a parlé il y a 15 min : séance ouverte
    assert_eq!(b.o.soumettre(&b.continu, &(205 * D)), Resultat::EnAttente);
    assert_eq!(b.o.lastprice(&aapl(&b)).unwrap().price, 200 * D);
}

#[test]
fn un_vote_ne_sert_qu_une_fois() {
    let b = banc();
    avancer(&b, 900);
    b.o.soumettre(&b.bourse, &(200 * D));
    assert_eq!(b.o.soumettre(&b.continu, &(200 * D)), Resultat::Accepte(200 * D));
    avancer(&b, 400);
    // Le continu revote seul : l'ancien vote bourse a été consommé, et la Bourse a parlé il y a moins de 30 min.
    assert_eq!(b.o.soumettre(&b.continu, &(201 * D)), Resultat::EnAttente);
}

#[test]
fn hors_seance_le_continu_seul_dans_la_marge() {
    let b = banc();
    avancer(&b, 3_600); // la Bourse n'a jamais parlé : séance fermée
    assert_eq!(b.o.soumettre(&b.continu, &(215 * D)), Resultat::Accepte(215 * D));
    // Le prix confirmé, lui, ne bouge pas.
    assert_eq!(b.o.dernier_confirme().price, 200 * D);
}

#[test]
fn hors_seance_trop_loin_du_dernier_prix_confirme() {
    let b = banc();
    avancer(&b, 3_600);
    assert_eq!(b.o.soumettre(&b.continu, &(225 * D)), Resultat::Refuse(REFUS_HORS_SEANCE));
    // La marge se mesure depuis le prix CONFIRMÉ, pas depuis le dernier prix hors séance :
    // on ne peut pas faire glisser le prix par petites étapes tout le week-end.
    assert_eq!(b.o.soumettre(&b.continu, &(219 * D)), Resultat::Accepte(219 * D));
    avancer(&b, 600);
    assert_eq!(b.o.soumettre(&b.continu, &(225 * D)), Resultat::Refuse(REFUS_HORS_SEANCE));
}

#[test]
fn la_bourse_seule_n_ecrit_jamais() {
    let b = banc();
    avancer(&b, 3_600);
    assert_eq!(b.o.soumettre(&b.bourse, &(210 * D)), Resultat::EnAttente);
    assert_eq!(b.o.lastprice(&aapl(&b)).unwrap().price, 200 * D);
}

#[test]
fn prix_hors_bande_refuse() {
    let b = banc();
    avancer(&b, 900);
    assert_eq!(b.o.soumettre(&b.continu, &(D / 2)), Resultat::Refuse(REFUS_BANDE));
}

#[test]
fn saut_trop_grand_refuse_meme_si_les_deux_sont_d_accord() {
    let b = banc();
    avancer(&b, 900);
    b.o.soumettre(&b.bourse, &(240 * D));
    assert_eq!(b.o.soumettre(&b.continu, &(240 * D)), Resultat::Refuse(REFUS_SAUT));
}

#[test]
fn trop_tot_apres_le_dernier_prix() {
    let b = banc();
    avancer(&b, 900);
    b.o.soumettre(&b.bourse, &(201 * D));
    b.o.soumettre(&b.continu, &(201 * D));
    avancer(&b, 60);
    b.o.soumettre(&b.bourse, &(202 * D));
    assert_eq!(b.o.soumettre(&b.continu, &(202 * D)), Resultat::Refuse(REFUS_TROP_TOT));
}

#[test]
fn votes_trop_vieux_ne_se_combinent_pas() {
    let b = banc();
    avancer(&b, 900);
    b.o.soumettre(&b.bourse, &(200 * D));
    avancer(&b, 700); // plus de 10 min plus tard
    assert_eq!(b.o.soumettre(&b.continu, &(200 * D)), Resultat::EnAttente);
}

#[test]
fn un_inconnu_ne_peut_pas_voter() {
    let b = banc();
    let x = Address::generate(&b.env);
    assert_eq!(b.o.try_soumettre(&x, &(200 * D)), Err(Ok(Erreur::NonAutorise)));
}

#[test]
fn l_admin_ne_peut_pas_devenir_rapporteur() {
    let b = banc();
    assert_eq!(b.o.try_changer_rapporteur(&Role::Bourse, &b.admin), Err(Ok(Erreur::AdminRapporteur)));
    assert_eq!(b.o.try_changer_rapporteur(&Role::Bourse, &b.continu), Err(Ok(Erreur::AdminRapporteur)));
    let nouveau = Address::generate(&b.env);
    b.o.changer_rapporteur(&Role::Bourse, &nouveau);
    assert_eq!(b.o.rapporteur(&Role::Bourse), nouveau);
    assert_eq!(b.o.try_soumettre(&b.bourse, &(200 * D)), Err(Ok(Erreur::NonAutorise)));
}

#[test]
fn reglages_invalides_refuses() {
    let b = banc();
    let mut r = reglages();
    r.tolerance_bps = 0;
    assert_eq!(b.o.try_fixer_reglages(&r), Err(Ok(Erreur::ReglagesInvalides)));
}

#[test]
fn interface_sep40() {
    let b = banc();
    assert_eq!(b.o.decimals(), 7);
    assert_eq!(b.o.assets().len(), 1);
    assert_eq!(b.o.lastprice(&Asset::Other(symbol_short!("TSLA"))), None);
    let p = b.o.lastprice(&aapl(&b)).unwrap();
    assert_eq!(b.o.price(&aapl(&b), &p.timestamp), Some(p.clone()));
    assert_eq!(b.o.price(&aapl(&b), &(p.timestamp + 1)), None);
}
