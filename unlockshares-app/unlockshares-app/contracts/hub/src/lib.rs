#![no_std]
//! UnlockShares Hub & Spokes : une seule caisse de USDC (le hub), plusieurs actions en garantie (les spokes).
//!
//! Analogie : une banque avec un seul coffre de billets, et un guichet par type de gage.
//! Chaque guichet (spoke) a ses propres règles : prix de l'action, part prêtable (ratio), seuil de saisie,
//! bonus du liquidateur, prime de risque, plafond (part maximum du coffre prêtée contre cette action),
//! et un interrupteur pour fermer le guichet sans toucher aux autres.
//!
//! - Une position par (emprunteur, action) : un prêt Tesla ne peut jamais faire liquider un prêt Apple.
//! - Taux d'emprunt d'un spoke = taux de base du hub (courbe à coude sur l'utilisation du coffre) + prime du spoke.
//!   Chaque spoke a son propre index de dette (compteur de taxi), qui grossit à ce taux.
//! - Les prêteurs touchent tous les intérêts (primes comprises), moins la réserve du protocole.
//! - Une perte non couverte sur un spoke serait supportée par tous les prêteurs : le plafond par spoke la limite.
//! - Protections reprises du prêt v3 : dette ≤ plafond fixe par adresse (tous spokes confondus), chaque emprunt
//!   ≤ X % du coffre libre, prix de l'oracle trop vieux = nouveaux emprunts bloqués, démo PERSONNELLE seulement
//!   (prix plus bas et temps avancé sur sa propre position).

use soroban_sdk::{contract, contractclient, contracterror, contractevent, contractimpl, contracttype, token, Address, Env, Map, Symbol, Vec};

pub const UNITE: i128 = 10_000_000;
pub const RAY: i128 = 1_000_000_000_000_000_000;
pub const ANNEE: u64 = 31_536_000;
const BPS: i128 = 10_000;
pub const AGE_MAX_PRIX: u64 = 4 * 86_400;
pub const COUDE_BPS: i128 = 8_000;
pub const TAUX_COUDE_BPS: i128 = 600;
pub const TAUX_MAX_BPS: i128 = 6_000;
pub const RESERVE_BPS: i128 = 1_000;
pub const RESERVE_MAX_BPS: i128 = 5_000;
/// Prime de risque maximum d'un spoke : 20 % par an.
pub const PRIME_MAX_BPS: i128 = 2_000;
/// Nombre maximum de spokes (chaque opération parcourt les spokes pour faire tourner les compteurs).
pub const SPOKES_MAX: u32 = 12;

const JOUR: u32 = 17_280;
const TTL_SEUIL: u32 = 30 * JOUR;
const TTL_CIBLE: u32 = 60 * JOUR;

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

#[allow(dead_code)]
#[contractclient(name = "OracleClient")]
pub trait Sep40 {
    fn decimals(env: Env) -> u32;
    fn lastprice(env: Env, asset: Asset) -> Option<PriceData>;
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigOracle {
    pub adresse: Address,
    pub actif: Asset,
    pub decimales: u32,
}

/// Les règles d'un spoke (réglables par l'admin).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Regles {
    /// Emprunt maximum en % de la valeur des actions (5000 = 50 %).
    pub ltv_max_bps: i128,
    /// Liquidable au-delà de ce % (8000 = 80 %).
    pub seuil_bps: i128,
    /// Bonus du liquidateur (500 = il reçoit 105 %).
    pub bonus_bps: i128,
    /// Après une liquidation partielle, la dette revient à ce % (6000 = 60 %).
    pub cible_bps: i128,
    /// Prime de risque ajoutée au taux de base (50 = +0,5 %/an).
    pub prime_bps: i128,
    /// Dette maximum du spoke en % du total fourni au hub (2500 = 25 %).
    pub plafond_bps: i128,
}

/// Un spoke : ses règles, son prix et son compteur d'intérêts.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Spoke {
    pub regles: Regles,
    /// Guichet ouvert : nouveaux dépôts d'actions et nouveaux emprunts permis.
    pub actif: bool,
    /// Prix administré (jeton prêté pour 1 action), utilisé tant qu'aucun oracle n'est branché.
    pub prix_admin: i128,
    /// Index de dette du spoke (RAY = 1).
    pub index: i128,
    /// Total des parts de dette du spoke.
    pub parts: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReglagesTaux {
    pub coude_bps: i128,
    pub taux_coude_bps: i128,
    pub taux_max_bps: i128,
    pub reserve_bps: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plafonds {
    /// Dette maximum par adresse, tous spokes confondus.
    pub fixe: i128,
    /// Chaque emprunt ≤ ce % du coffre libre.
    pub caisse_bps: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Position {
    pub garantie: i128,
    pub parts_dette: i128,
    pub dette_demo: i128,
}

#[contracttype]
#[derive(Clone)]
pub enum Cle {
    Admin,
    JetonPret,
    DemoPerso,
    Plafonds,
    Reglages,
    /// Liste des jetons de garantie (ordre d'ajout).
    Liste,
    /// Les spokes, par jeton de garantie.
    Spokes,
    IndexDepot,
    TotalFourni,
    Reserve,
    DerniereMaj,
    Fourni(Address),
    /// (emprunteur, jeton de garantie)
    Position(Address, Address),
    PrixDemo(Address, Address),
    /// Oracle branché sur un spoke (absent = prix administré).
    Oracle(Address),
}

/// La position lue par l'appli (intérêts compris).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VuePosition {
    pub jeton: Address,
    pub garantie: i128,
    pub dette: i128,
    pub dette_demo: i128,
    pub prix: i128,
    pub prix_demo_actif: bool,
    pub valeur: i128,
    pub ltv_bps: i128,
    pub disponible: i128,
    pub prix_liquidation: i128,
    pub liquidable: bool,
}

/// Un spoke vu par l'appli.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VueSpoke {
    pub jeton: Address,
    pub regles: Regles,
    pub actif: bool,
    pub prix: i128,
    pub oracle_actif: bool,
    pub prix_maj: u64,
    pub emprunte: i128,
    /// Ce qui peut encore être emprunté contre cette action (plafond du spoke).
    pub reste_plafond: i128,
    /// Taux d'emprunt du spoke = base + prime.
    pub taux_emprunt_bps: i128,
    pub garantie_totale: i128,
}

/// Le hub vu par l'appli.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Marche {
    pub total_fourni: i128,
    pub total_emprunte: i128,
    pub caisse: i128,
    pub reserve: i128,
    pub utilisation_bps: i128,
    pub taux_base_bps: i128,
    /// Taux moyen versé aux prêteurs (primes comprises).
    pub taux_depot_bps: i128,
    pub demo_perso: bool,
    pub plafond_fixe: i128,
    pub plafond_caisse_bps: i128,
    pub nb_spokes: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Erreur {
    MontantInvalide = 1,
    GarantieInsuffisante = 2,
    CaisseVide = 3,
    PasLiquidable = 4,
    PasDeDette = 5,
    NonAutorise = 6,
    SoldeInsuffisant = 7,
    PrixInvalide = 8,
    PlafondDepasse = 9,
    PrixPerime = 10,
    /// Hub : aucune action de ce type n'est acceptée.
    SpokeInconnu = 11,
    /// Hub : guichet fermé (pause) pour les nouveaux dépôts et emprunts.
    SpokeEnPause = 12,
    /// Hub : plafond du spoke atteint.
    PlafondSpoke = 13,
    /// Hub : règles incohérentes.
    ReglesInvalides = 14,
    /// Hub : ce spoke existe déjà, ou trop de spokes.
    SpokeExistant = 15,
}

#[contractevent]
pub struct SpokeAjoute { #[topic] pub jeton: Address, pub regles: Regles, pub prix: i128 }
#[contractevent]
pub struct SpokeModifie { #[topic] pub jeton: Address, pub regles: Regles }
#[contractevent]
pub struct SpokeOuvert { #[topic] pub jeton: Address, pub actif: bool }
#[contractevent]
pub struct PrixFixe { #[topic] pub jeton: Address, pub prix: i128 }
#[contractevent]
pub struct OracleFixe { #[topic] pub jeton: Address, pub oracle: Option<ConfigOracle> }
#[contractevent]
pub struct PrixDemoFixe { #[topic] pub emprunteur: Address, #[topic] pub jeton: Address, pub prix: i128 }
#[contractevent]
pub struct TempsPersoAvance { #[topic] pub emprunteur: Address, #[topic] pub jeton: Address, pub secondes: u64, pub interets: i128 }
#[contractevent]
pub struct PlafondsFixes { pub plafonds: Plafonds }
#[contractevent]
pub struct DemoPersoFixee { pub actif: bool }
#[contractevent]
pub struct ReglagesFixes { pub reglages: ReglagesTaux }
#[contractevent]
pub struct Fourni { #[topic] pub preteur: Address, pub montant: i128 }
#[contractevent]
pub struct FondsRetires { #[topic] pub preteur: Address, pub montant: i128 }
#[contractevent]
pub struct ReserveRetiree { pub montant: i128 }
#[contractevent]
pub struct Depose { #[topic] pub emprunteur: Address, #[topic] pub jeton: Address, pub montant: i128 }
#[contractevent]
pub struct GarantieRetiree { #[topic] pub emprunteur: Address, #[topic] pub jeton: Address, pub montant: i128 }
#[contractevent]
pub struct Emprunte { #[topic] pub emprunteur: Address, #[topic] pub jeton: Address, pub montant: i128 }
#[contractevent]
pub struct Rembourse { #[topic] pub emprunteur: Address, #[topic] pub jeton: Address, pub montant: i128 }
#[contractevent]
pub struct Liquide {
    #[topic] pub emprunteur: Address,
    #[topic] pub jeton: Address,
    pub liquidateur: Address,
    pub dette: i128,
    pub garantie_saisie: i128,
}

#[contract]
pub struct Hub;

// ---------- outils ----------

fn lire<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(env: &Env, cle: &Cle) -> V {
    env.storage().instance().get(cle).unwrap()
}

fn admin(env: &Env) -> Address {
    let a: Address = lire(env, &Cle::Admin);
    a.require_auth();
    a
}

fn garder_en_vie(env: &Env) {
    env.storage().instance().extend_ttl(TTL_SEUIL, TTL_CIBLE);
}

fn positif(montant: i128) -> Result<(), Erreur> {
    if montant <= 0 { Err(Erreur::MontantInvalide) } else { Ok(()) }
}

fn jeton_pret(env: &Env) -> token::Client<'_> {
    token::Client::new(env, &lire::<Address>(env, &Cle::JetonPret))
}

fn reglages(env: &Env) -> ReglagesTaux {
    lire(env, &Cle::Reglages)
}

fn plafonds(env: &Env) -> Plafonds {
    lire(env, &Cle::Plafonds)
}

fn demo_perso(env: &Env) -> bool {
    env.storage().instance().get(&Cle::DemoPerso).unwrap_or(false)
}

fn liste(env: &Env) -> Vec<Address> {
    env.storage().instance().get(&Cle::Liste).unwrap_or(Vec::new(env))
}

fn verifier_regles(r: &Regles) -> Result<(), Erreur> {
    let ok = r.ltv_max_bps > 0
        && r.ltv_max_bps < r.cible_bps
        && r.cible_bps < r.seuil_bps
        && r.seuil_bps < BPS
        && r.bonus_bps >= 0
        // Au seuil, la garantie doit couvrir la dette + le bonus.
        && r.seuil_bps * (BPS + r.bonus_bps) < BPS * BPS
        && r.prime_bps >= 0
        && r.prime_bps <= PRIME_MAX_BPS
        && r.plafond_bps > 0
        && r.plafond_bps <= BPS;
    if ok { Ok(()) } else { Err(Erreur::ReglesInvalides) }
}

// ---------- prix ----------

fn prix_oracle(env: &Env, c: &ConfigOracle) -> Option<PriceData> {
    let p = OracleClient::new(env, &c.adresse).lastprice(&c.actif)?;
    if p.price <= 0 {
        return None;
    }
    let d = c.decimales as i128 - 7;
    let mut prix = p.price;
    if d > 0 {
        prix /= 10i128.pow(d as u32);
    } else if d < 0 {
        prix *= 10i128.pow((-d) as u32);
    }
    Some(PriceData { price: prix, timestamp: p.timestamp })
}

fn oracle_de(env: &Env, jeton: &Address) -> Option<ConfigOracle> {
    env.storage().instance().get(&Cle::Oracle(jeton.clone()))
}

fn prix_spoke(env: &Env, s: &Spoke, jeton: &Address) -> i128 {
    match oracle_de(env, jeton).and_then(|c| prix_oracle(env, &c)) {
        Some(p) => p.price,
        None => s.prix_admin,
    }
}

fn verifier_prix_frais(env: &Env, jeton: &Address) -> Result<(), Erreur> {
    if let Some(c) = oracle_de(env, jeton) {
        match prix_oracle(env, &c) {
            Some(p) if env.ledger().timestamp() <= p.timestamp + AGE_MAX_PRIX => {}
            _ => return Err(Erreur::PrixPerime),
        }
    }
    Ok(())
}

fn prix_pour(env: &Env, s: &Spoke, qui: &Address, jeton: &Address) -> i128 {
    let reference = prix_spoke(env, s, jeton);
    let demo: Option<i128> = env.storage().persistent().get(&Cle::PrixDemo(qui.clone(), jeton.clone()));
    match demo {
        Some(p) if p < reference => p,
        _ => reference,
    }
}

fn valeur_a(garantie: i128, px: i128) -> i128 {
    garantie * px / UNITE
}

fn sous_la_limite(dette: i128, garantie: i128, px: i128, r: &Regles) -> bool {
    dette * BPS <= valeur_a(garantie, px) * r.ltv_max_bps
}

fn est_liquidable(dette: i128, garantie: i128, px: i128, r: &Regles) -> bool {
    dette > 0 && dette * BPS > valeur_a(garantie, px) * r.seuil_bps
}

fn montant_liquidable_calc(dette: i128, garantie: i128, px: i128, r: &Regles) -> i128 {
    if !est_liquidable(dette, garantie, px, r) {
        return 0;
    }
    let v = valeur_a(garantie, px);
    let denominateur = BPS - r.cible_bps * (BPS + r.bonus_bps) / BPS;
    let partiel = (dette * BPS - r.cible_bps * v + denominateur - 1) / denominateur;
    let saisie_partielle = partiel * (BPS + r.bonus_bps) * UNITE / (BPS * px);
    if partiel > 0 && partiel < dette && saisie_partielle < garantie { partiel } else { dette }
}

// ---------- intérêts ----------

fn reel_bas(parts: i128, index: i128) -> i128 { parts * index / RAY }
fn reel_haut(parts: i128, index: i128) -> i128 { (parts * index + RAY - 1) / RAY }
fn parts_bas(montant: i128, index: i128) -> i128 { montant * RAY / index }
fn parts_haut(montant: i128, index: i128) -> i128 { (montant * RAY + index - 1) / index }

fn utilisation_bps(emprunte: i128, fourni: i128) -> i128 {
    if fourni <= 0 {
        return if emprunte > 0 { BPS } else { 0 };
    }
    let u = emprunte * BPS / fourni;
    if u > BPS { BPS } else { u }
}

fn taux_base_bps(u: i128, r: &ReglagesTaux) -> i128 {
    if u <= r.coude_bps {
        u * r.taux_coude_bps / r.coude_bps
    } else {
        r.taux_coude_bps + (u - r.coude_bps) * (r.taux_max_bps - r.taux_coude_bps) / (BPS - r.coude_bps)
    }
}

/// L'état du hub et de tous ses spokes à un instant donné.
struct Etat {
    index_depot: i128,
    parts_depot: i128,
    reserve: i128,
    maj: u64,
    spokes: Map<Address, Spoke>,
}

impl Etat {
    fn fourni(&self) -> i128 { reel_bas(self.parts_depot, self.index_depot) }
    fn emprunte(&self) -> i128 {
        let mut t = 0;
        for (_, s) in self.spokes.iter() {
            t += reel_haut(s.parts, s.index);
        }
        t
    }
    fn utilisation(&self) -> i128 { utilisation_bps(self.emprunte(), self.fourni()) }
    fn spoke(&self, jeton: &Address) -> Result<Spoke, Erreur> {
        self.spokes.get(jeton.clone()).ok_or(Erreur::SpokeInconnu)
    }
}

fn calculer(env: &Env) -> Etat {
    let s = env.storage().instance();
    let mut e = Etat {
        index_depot: s.get(&Cle::IndexDepot).unwrap_or(RAY),
        parts_depot: s.get(&Cle::TotalFourni).unwrap_or(0),
        reserve: s.get(&Cle::Reserve).unwrap_or(0),
        maj: s.get(&Cle::DerniereMaj).unwrap_or(0),
        spokes: s.get(&Cle::Spokes).unwrap_or(Map::new(env)),
    };
    let t = env.ledger().timestamp();
    if t <= e.maj {
        return e;
    }
    let dt = (t - e.maj) as i128;
    let emprunte = e.emprunte();
    if emprunte > 0 {
        let fourni = e.fourni();
        let r = reglages(env);
        let base = taux_base_bps(utilisation_bps(emprunte, fourni), &r);
        let mut interets = 0;
        let mut nouveaux = Map::new(env);
        for (jeton, mut sp) in e.spokes.iter() {
            if sp.parts > 0 {
                let avant = reel_haut(sp.parts, sp.index);
                let taux = base + sp.regles.prime_bps;
                sp.index += sp.index * taux * dt / (BPS * ANNEE as i128);
                interets += reel_haut(sp.parts, sp.index) - avant;
            }
            nouveaux.set(jeton, sp);
        }
        e.spokes = nouveaux;
        let pour_reserve = interets * r.reserve_bps / BPS;
        if fourni > 0 {
            e.index_depot += e.index_depot * (interets - pour_reserve) / fourni;
            e.reserve += pour_reserve;
        } else {
            e.reserve += interets;
        }
    }
    e.maj = t;
    e
}

fn ecrire_etat(env: &Env, e: &Etat) {
    let s = env.storage().instance();
    s.set(&Cle::IndexDepot, &e.index_depot);
    s.set(&Cle::TotalFourni, &e.parts_depot);
    s.set(&Cle::Reserve, &e.reserve);
    s.set(&Cle::DerniereMaj, &e.maj);
    s.set(&Cle::Spokes, &e.spokes);
}

fn actualiser(env: &Env) -> Etat {
    let e = calculer(env);
    ecrire_etat(env, &e);
    e
}

fn caisse_libre(env: &Env, reserve: i128) -> i128 {
    let solde = jeton_pret(env).balance(&env.current_contract_address());
    if solde > reserve { solde - reserve } else { 0 }
}

fn position(env: &Env, qui: &Address, jeton: &Address) -> Position {
    env.storage()
        .persistent()
        .get(&Cle::Position(qui.clone(), jeton.clone()))
        .unwrap_or(Position { garantie: 0, parts_dette: 0, dette_demo: 0 })
}

fn ecrire_position(env: &Env, qui: &Address, jeton: &Address, p: &Position) {
    let cle = Cle::Position(qui.clone(), jeton.clone());
    if p.garantie == 0 && p.parts_dette == 0 && p.dette_demo == 0 {
        env.storage().persistent().remove(&cle);
    } else {
        env.storage().persistent().set(&cle, p);
        env.storage().persistent().extend_ttl(&cle, TTL_SEUIL, TTL_CIBLE);
    }
}

fn dette_totale(p: &Position, index: i128) -> i128 {
    reel_haut(p.parts_dette, index) + p.dette_demo
}

/// Dette de `qui` sur tous les spokes (pour le plafond par adresse).
fn dette_adresse(env: &Env, e: &Etat, qui: &Address) -> i128 {
    let mut t = 0;
    for (jeton, s) in e.spokes.iter() {
        t += dette_totale(&position(env, qui, &jeton), s.index);
    }
    t
}

fn repartir_paiement(paye: i128, p: &Position, index: i128) -> (i128, i128) {
    let vers_demo = if paye < p.dette_demo { paye } else { p.dette_demo };
    let reste = paye - vers_demo;
    let dette_indexee = reel_haut(p.parts_dette, index);
    let brulees = if reste <= 0 {
        0
    } else if reste >= dette_indexee {
        p.parts_dette
    } else {
        let x = parts_bas(reste, index);
        if x > p.parts_dette { p.parts_dette } else { x }
    };
    (vers_demo, brulees)
}

fn vue_spoke(env: &Env, e: &Etat, jeton: &Address, s: &Spoke) -> VueSpoke {
    let emprunte = reel_haut(s.parts, s.index);
    let max = e.fourni() * s.regles.plafond_bps / BPS;
    let base = taux_base_bps(e.utilisation(), &reglages(env));
    let oracle = oracle_de(env, jeton);
    let maj = oracle.as_ref().and_then(|c| prix_oracle(env, c)).map_or(0, |p| p.timestamp);
    VueSpoke {
        jeton: jeton.clone(),
        regles: s.regles.clone(),
        actif: s.actif,
        prix: prix_spoke(env, s, jeton),
        oracle_actif: oracle.is_some(),
        prix_maj: maj,
        emprunte,
        reste_plafond: if max > emprunte { max - emprunte } else { 0 },
        taux_emprunt_bps: base + s.regles.prime_bps,
        garantie_totale: token::Client::new(env, jeton).balance(&env.current_contract_address()),
    }
}

#[contractimpl]
impl Hub {
    pub fn __constructor(env: Env, admin: Address, jeton_pret: Address, plafond_fixe: i128, plafond_caisse_bps: i128, demo_perso: bool) {
        if plafond_fixe <= 0 || plafond_caisse_bps <= 0 || plafond_caisse_bps > BPS {
            panic!("plafonds invalides");
        }
        let s = env.storage().instance();
        s.set(&Cle::Admin, &admin);
        s.set(&Cle::JetonPret, &jeton_pret);
        s.set(&Cle::DemoPerso, &demo_perso);
        s.set(&Cle::Plafonds, &Plafonds { fixe: plafond_fixe, caisse_bps: plafond_caisse_bps });
        s.set(&Cle::Reglages, &ReglagesTaux { coude_bps: COUDE_BPS, taux_coude_bps: TAUX_COUDE_BPS, taux_max_bps: TAUX_MAX_BPS, reserve_bps: RESERVE_BPS });
        s.set(&Cle::Liste, &Vec::<Address>::new(&env));
        ecrire_etat(&env, &Etat { index_depot: RAY, parts_depot: 0, reserve: 0, maj: env.ledger().timestamp(), spokes: Map::new(&env) });
        garder_en_vie(&env);
    }

    // ---------- admin : spokes ----------

    /// Ouvre un nouveau guichet pour l'action `jeton`, avec ses règles et un prix administré de départ.
    pub fn ajouter_spoke(env: Env, jeton: Address, regles: Regles, prix: i128) -> Result<(), Erreur> {
        admin(&env);
        verifier_regles(&regles)?;
        if prix <= 0 {
            return Err(Erreur::PrixInvalide);
        }
        if jeton == lire::<Address>(&env, &Cle::JetonPret) {
            return Err(Erreur::ReglesInvalides);
        }
        let mut e = actualiser(&env);
        let mut l = liste(&env);
        if e.spokes.contains_key(jeton.clone()) || l.len() >= SPOKES_MAX {
            return Err(Erreur::SpokeExistant);
        }
        e.spokes.set(jeton.clone(), Spoke { regles: regles.clone(), actif: true, prix_admin: prix, index: RAY, parts: 0 });
        l.push_back(jeton.clone());
        env.storage().instance().set(&Cle::Liste, &l);
        ecrire_etat(&env, &e);
        garder_en_vie(&env);
        SpokeAjoute { jeton, regles, prix }.publish(&env);
        Ok(())
    }

    /// Change les règles d'un spoke (les intérêts courus jusqu'ici sont comptés à l'ancienne prime).
    pub fn modifier_spoke(env: Env, jeton: Address, regles: Regles) -> Result<(), Erreur> {
        admin(&env);
        verifier_regles(&regles)?;
        let mut e = actualiser(&env);
        let mut s = e.spoke(&jeton)?;
        s.regles = regles.clone();
        e.spokes.set(jeton.clone(), s);
        ecrire_etat(&env, &e);
        garder_en_vie(&env);
        SpokeModifie { jeton, regles }.publish(&env);
        Ok(())
    }

    /// Ouvre ou ferme un guichet. Fermé : plus de dépôt d'actions ni d'emprunt ; rembourser, retirer et liquider restent possibles.
    pub fn ouvrir_spoke(env: Env, jeton: Address, actif: bool) -> Result<(), Erreur> {
        admin(&env);
        let mut e = actualiser(&env);
        let mut s = e.spoke(&jeton)?;
        s.actif = actif;
        e.spokes.set(jeton.clone(), s);
        ecrire_etat(&env, &e);
        garder_en_vie(&env);
        SpokeOuvert { jeton, actif }.publish(&env);
        Ok(())
    }

    /// Prix administré d'un spoke. Refusé tant qu'un oracle est branché sur ce spoke.
    pub fn fixer_prix(env: Env, jeton: Address, prix: i128) -> Result<(), Erreur> {
        admin(&env);
        if prix <= 0 {
            return Err(Erreur::PrixInvalide);
        }
        let mut e = actualiser(&env);
        let mut s = e.spoke(&jeton)?;
        if oracle_de(&env, &jeton).is_some() {
            return Err(Erreur::NonAutorise);
        }
        s.prix_admin = prix;
        e.spokes.set(jeton.clone(), s);
        ecrire_etat(&env, &e);
        garder_en_vie(&env);
        PrixFixe { jeton, prix }.publish(&env);
        Ok(())
    }

    /// Branche (Some) ou débranche (None) l'oracle SEP-40 d'un spoke. L'oracle doit déjà donner un prix.
    pub fn fixer_oracle(env: Env, jeton: Address, oracle: Option<(Address, Asset)>) -> Result<(), Erreur> {
        admin(&env);
        let e = calculer(&env);
        e.spoke(&jeton)?;
        let conf = match oracle {
            Some((adresse, actif)) => {
                let decimales = OracleClient::new(&env, &adresse).decimals();
                let c = ConfigOracle { adresse, actif, decimales };
                if decimales > 18 || prix_oracle(&env, &c).is_none() {
                    return Err(Erreur::PrixInvalide);
                }
                env.storage().instance().set(&Cle::Oracle(jeton.clone()), &c);
                Some(c)
            }
            None => {
                env.storage().instance().remove(&Cle::Oracle(jeton.clone()));
                None
            }
        };
        garder_en_vie(&env);
        OracleFixe { jeton, oracle: conf }.publish(&env);
        Ok(())
    }

    // ---------- admin : hub ----------

    pub fn fixer_plafonds(env: Env, fixe: i128, caisse_bps: i128) -> Result<(), Erreur> {
        admin(&env);
        if fixe <= 0 || caisse_bps <= 0 || caisse_bps > BPS {
            return Err(Erreur::MontantInvalide);
        }
        let plafonds = Plafonds { fixe, caisse_bps };
        env.storage().instance().set(&Cle::Plafonds, &plafonds);
        garder_en_vie(&env);
        PlafondsFixes { plafonds }.publish(&env);
        Ok(())
    }

    pub fn fixer_demo_perso(env: Env, actif: bool) {
        admin(&env);
        env.storage().instance().set(&Cle::DemoPerso, &actif);
        garder_en_vie(&env);
        DemoPersoFixee { actif }.publish(&env);
    }

    pub fn fixer_reglages_taux(env: Env, reglages: ReglagesTaux) -> Result<(), Erreur> {
        admin(&env);
        let r = &reglages;
        if r.coude_bps <= 0 || r.coude_bps >= BPS || r.taux_coude_bps < 0 || r.taux_max_bps < r.taux_coude_bps
            || r.reserve_bps < 0 || r.reserve_bps > RESERVE_MAX_BPS
        {
            return Err(Erreur::MontantInvalide);
        }
        actualiser(&env);
        env.storage().instance().set(&Cle::Reglages, &reglages);
        garder_en_vie(&env);
        ReglagesFixes { reglages }.publish(&env);
        Ok(())
    }

    pub fn retirer_reserve(env: Env, montant: i128) -> Result<(), Erreur> {
        let a = admin(&env);
        positif(montant)?;
        let mut e = actualiser(&env);
        if montant > e.reserve {
            return Err(Erreur::SoldeInsuffisant);
        }
        let pret = jeton_pret(&env);
        if montant > pret.balance(&env.current_contract_address()) {
            return Err(Erreur::CaisseVide);
        }
        e.reserve -= montant;
        ecrire_etat(&env, &e);
        garder_en_vie(&env);
        pret.transfer(&env.current_contract_address(), &a, &montant);
        ReserveRetiree { montant }.publish(&env);
        Ok(())
    }

    // ---------- démo personnelle ----------

    pub fn fixer_prix_demo(env: Env, emprunteur: Address, jeton: Address, prix: i128) -> Result<(), Erreur> {
        emprunteur.require_auth();
        if !demo_perso(&env) {
            return Err(Erreur::NonAutorise);
        }
        let e = calculer(&env);
        let s = e.spoke(&jeton)?;
        if prix <= 0 || prix > prix_spoke(&env, &s, &jeton) {
            return Err(Erreur::PrixInvalide);
        }
        let cle = Cle::PrixDemo(emprunteur.clone(), jeton.clone());
        env.storage().persistent().set(&cle, &prix);
        env.storage().persistent().extend_ttl(&cle, TTL_SEUIL, TTL_CIBLE);
        garder_en_vie(&env);
        PrixDemoFixe { emprunteur, jeton, prix }.publish(&env);
        Ok(())
    }

    pub fn reinitialiser_prix_demo(env: Env, emprunteur: Address, jeton: Address) {
        emprunteur.require_auth();
        env.storage().persistent().remove(&Cle::PrixDemo(emprunteur.clone(), jeton.clone()));
        garder_en_vie(&env);
        PrixDemoFixe { emprunteur, jeton, prix: 0 }.publish(&env);
    }

    pub fn avancer_temps_perso(env: Env, emprunteur: Address, jeton: Address, secondes: u64) -> Result<i128, Erreur> {
        emprunteur.require_auth();
        if !demo_perso(&env) {
            return Err(Erreur::NonAutorise);
        }
        if secondes == 0 || secondes > 10 * ANNEE {
            return Err(Erreur::MontantInvalide);
        }
        let e = actualiser(&env);
        let s = e.spoke(&jeton)?;
        let mut p = position(&env, &emprunteur, &jeton);
        let dette = dette_totale(&p, s.index);
        if dette == 0 {
            return Err(Erreur::PasDeDette);
        }
        let taux = taux_base_bps(e.utilisation(), &reglages(&env)) + s.regles.prime_bps;
        let interets = dette * taux * secondes as i128 / (BPS * ANNEE as i128);
        p.dette_demo += interets;
        ecrire_position(&env, &emprunteur, &jeton, &p);
        garder_en_vie(&env);
        TempsPersoAvance { emprunteur, jeton, secondes, interets }.publish(&env);
        Ok(interets)
    }

    // ---------- prêteurs (le hub) ----------

    pub fn fournir(env: Env, preteur: Address, montant: i128) -> Result<(), Erreur> {
        preteur.require_auth();
        positif(montant)?;
        let mut e = actualiser(&env);
        jeton_pret(&env).transfer(&preteur, &env.current_contract_address(), &montant);
        let parts = parts_bas(montant, e.index_depot);
        let cle = Cle::Fourni(preteur.clone());
        let deja: i128 = env.storage().persistent().get(&cle).unwrap_or(0);
        env.storage().persistent().set(&cle, &(deja + parts));
        env.storage().persistent().extend_ttl(&cle, TTL_SEUIL, TTL_CIBLE);
        e.parts_depot += parts;
        ecrire_etat(&env, &e);
        garder_en_vie(&env);
        Fourni { preteur, montant }.publish(&env);
        Ok(())
    }

    pub fn retirer_fonds(env: Env, preteur: Address, montant: i128) -> Result<(), Erreur> {
        preteur.require_auth();
        positif(montant)?;
        let mut e = actualiser(&env);
        let cle = Cle::Fourni(preteur.clone());
        let parts: i128 = env.storage().persistent().get(&cle).unwrap_or(0);
        let solde = reel_bas(parts, e.index_depot);
        if montant > solde {
            return Err(Erreur::SoldeInsuffisant);
        }
        if montant > caisse_libre(&env, e.reserve) {
            return Err(Erreur::CaisseVide);
        }
        let brulees = if montant == solde {
            parts
        } else {
            let p = parts_haut(montant, e.index_depot);
            if p > parts { parts } else { p }
        };
        if brulees == parts {
            env.storage().persistent().remove(&cle);
        } else {
            env.storage().persistent().set(&cle, &(parts - brulees));
            env.storage().persistent().extend_ttl(&cle, TTL_SEUIL, TTL_CIBLE);
        }
        e.parts_depot -= brulees;
        ecrire_etat(&env, &e);
        garder_en_vie(&env);
        jeton_pret(&env).transfer(&env.current_contract_address(), &preteur, &montant);
        FondsRetires { preteur, montant }.publish(&env);
        Ok(())
    }

    // ---------- emprunteurs (les spokes) ----------

    pub fn deposer(env: Env, emprunteur: Address, jeton: Address, montant: i128) -> Result<(), Erreur> {
        emprunteur.require_auth();
        positif(montant)?;
        let e = calculer(&env);
        let s = e.spoke(&jeton)?;
        if !s.actif {
            return Err(Erreur::SpokeEnPause);
        }
        token::Client::new(&env, &jeton).transfer(&emprunteur, &env.current_contract_address(), &montant);
        let mut p = position(&env, &emprunteur, &jeton);
        p.garantie += montant;
        ecrire_position(&env, &emprunteur, &jeton, &p);
        garder_en_vie(&env);
        Depose { emprunteur, jeton, montant }.publish(&env);
        Ok(())
    }

    pub fn retirer(env: Env, emprunteur: Address, jeton: Address, montant: i128) -> Result<(), Erreur> {
        emprunteur.require_auth();
        positif(montant)?;
        let e = actualiser(&env);
        let s = e.spoke(&jeton)?;
        let mut p = position(&env, &emprunteur, &jeton);
        if montant > p.garantie {
            return Err(Erreur::SoldeInsuffisant);
        }
        p.garantie -= montant;
        let dette = dette_totale(&p, s.index);
        if dette > 0 {
            verifier_prix_frais(&env, &jeton)?;
            if !sous_la_limite(dette, p.garantie, prix_pour(&env, &s, &emprunteur, &jeton), &s.regles) {
                return Err(Erreur::GarantieInsuffisante);
            }
        }
        ecrire_position(&env, &emprunteur, &jeton, &p);
        garder_en_vie(&env);
        token::Client::new(&env, &jeton).transfer(&env.current_contract_address(), &emprunteur, &montant);
        GarantieRetiree { emprunteur, jeton, montant }.publish(&env);
        Ok(())
    }

    pub fn emprunter(env: Env, emprunteur: Address, jeton: Address, montant: i128) -> Result<(), Erreur> {
        emprunteur.require_auth();
        positif(montant)?;
        let mut e = actualiser(&env);
        let mut s = e.spoke(&jeton)?;
        if !s.actif {
            return Err(Erreur::SpokeEnPause);
        }
        verifier_prix_frais(&env, &jeton)?;
        let mut p = position(&env, &emprunteur, &jeton);
        let dette = dette_totale(&p, s.index) + montant;
        if !sous_la_limite(dette, p.garantie, prix_pour(&env, &s, &emprunteur, &jeton), &s.regles) {
            return Err(Erreur::GarantieInsuffisante);
        }
        let libre = caisse_libre(&env, e.reserve);
        if montant > libre {
            return Err(Erreur::CaisseVide);
        }
        let pl = plafonds(&env);
        if dette_adresse(&env, &e, &emprunteur) + montant > pl.fixe || montant * BPS > libre * pl.caisse_bps {
            return Err(Erreur::PlafondDepasse);
        }
        if (reel_haut(s.parts, s.index) + montant) * BPS > e.fourni() * s.regles.plafond_bps {
            return Err(Erreur::PlafondSpoke);
        }
        let parts = parts_haut(montant, s.index);
        p.parts_dette += parts;
        s.parts += parts;
        e.spokes.set(jeton.clone(), s);
        ecrire_position(&env, &emprunteur, &jeton, &p);
        ecrire_etat(&env, &e);
        garder_en_vie(&env);
        jeton_pret(&env).transfer(&env.current_contract_address(), &emprunteur, &montant);
        Emprunte { emprunteur, jeton, montant }.publish(&env);
        Ok(())
    }

    /// Rembourse exactement `montant` (l'excédent éventuel est rendu). Toujours permis, même spoke en pause.
    pub fn rembourser(env: Env, emprunteur: Address, jeton: Address, montant: i128) -> Result<i128, Erreur> {
        emprunteur.require_auth();
        positif(montant)?;
        let mut e = actualiser(&env);
        let mut s = e.spoke(&jeton)?;
        let mut p = position(&env, &emprunteur, &jeton);
        let dette = dette_totale(&p, s.index);
        if dette == 0 {
            return Err(Erreur::PasDeDette);
        }
        let paye = if montant > dette { dette } else { montant };
        let pret = jeton_pret(&env);
        pret.transfer(&emprunteur, &env.current_contract_address(), &montant);
        if montant > paye {
            pret.transfer(&env.current_contract_address(), &emprunteur, &(montant - paye));
        }
        let (vers_demo, brulees) = repartir_paiement(paye, &p, s.index);
        p.dette_demo -= vers_demo;
        e.reserve += vers_demo;
        p.parts_dette -= brulees;
        s.parts -= brulees;
        e.spokes.set(jeton.clone(), s);
        ecrire_position(&env, &emprunteur, &jeton, &p);
        ecrire_etat(&env, &e);
        garder_en_vie(&env);
        Rembourse { emprunteur, jeton, montant: paye }.publish(&env);
        Ok(paye)
    }

    /// Liquidation d'UNE position (emprunteur, action), aux règles de son spoke.
    pub fn liquider(env: Env, liquidateur: Address, emprunteur: Address, jeton: Address, montant: i128) -> Result<i128, Erreur> {
        liquidateur.require_auth();
        positif(montant)?;
        let mut e = actualiser(&env);
        let mut s = e.spoke(&jeton)?;
        let mut p = position(&env, &emprunteur, &jeton);
        let dette = dette_totale(&p, s.index);
        let px = prix_pour(&env, &s, &emprunteur, &jeton);
        let max = montant_liquidable_calc(dette, p.garantie, px, &s.regles);
        if max == 0 {
            return Err(Erreur::PasLiquidable);
        }
        let paye = if montant > max { max } else { montant };
        let mut saisie = paye * (BPS + s.regles.bonus_bps) * UNITE / (BPS * px);
        if saisie >= p.garantie && paye < dette {
            return Err(Erreur::MontantInvalide);
        }
        if saisie > p.garantie {
            saisie = p.garantie;
        }
        let pret = jeton_pret(&env);
        pret.transfer(&liquidateur, &env.current_contract_address(), &montant);
        if montant > paye {
            pret.transfer(&env.current_contract_address(), &liquidateur, &(montant - paye));
        }
        let (vers_demo, brulees) = repartir_paiement(paye, &p, s.index);
        p.dette_demo -= vers_demo;
        e.reserve += vers_demo;
        p.parts_dette -= brulees;
        s.parts -= brulees;
        p.garantie -= saisie;
        e.spokes.set(jeton.clone(), s);
        ecrire_position(&env, &emprunteur, &jeton, &p);
        ecrire_etat(&env, &e);
        garder_en_vie(&env);
        token::Client::new(&env, &jeton).transfer(&env.current_contract_address(), &liquidateur, &saisie);
        Liquide { emprunteur, jeton, liquidateur, dette: paye, garantie_saisie: saisie }.publish(&env);
        Ok(saisie)
    }

    // ---------- lectures ----------

    pub fn montant_liquidable(env: Env, emprunteur: Address, jeton: Address) -> i128 {
        let e = calculer(&env);
        match e.spokes.get(jeton.clone()) {
            Some(s) => {
                let p = position(&env, &emprunteur, &jeton);
                montant_liquidable_calc(dette_totale(&p, s.index), p.garantie, prix_pour(&env, &s, &emprunteur, &jeton), &s.regles)
            }
            None => 0,
        }
    }

    pub fn position(env: Env, emprunteur: Address, jeton: Address) -> Result<VuePosition, Erreur> {
        let e = calculer(&env);
        let s = e.spoke(&jeton)?;
        Ok(Self::vue(&env, &s, &emprunteur, &jeton))
    }

    /// Toutes les positions non vides de l'emprunteur (une par action).
    pub fn positions(env: Env, emprunteur: Address) -> Vec<VuePosition> {
        let e = calculer(&env);
        let mut v = Vec::new(&env);
        for jeton in liste(&env).iter() {
            if let Some(s) = e.spokes.get(jeton.clone()) {
                let vp = Self::vue(&env, &s, &emprunteur, &jeton);
                if vp.garantie > 0 || vp.dette > 0 {
                    v.push_back(vp);
                }
            }
        }
        v
    }

    pub fn fourni(env: Env, preteur: Address) -> i128 {
        let e = calculer(&env);
        let parts: i128 = env.storage().persistent().get(&Cle::Fourni(preteur)).unwrap_or(0);
        reel_bas(parts, e.index_depot)
    }

    pub fn marche(env: Env) -> Marche {
        let e = calculer(&env);
        let u = e.utilisation();
        let r = reglages(&env);
        let base = taux_base_bps(u, &r);
        let fourni = e.fourni();
        // Intérêts annuels de tous les spokes, moins la réserve, rapportés au total fourni.
        let mut flux = 0;
        for (_, s) in e.spokes.iter() {
            flux += reel_haut(s.parts, s.index) * (base + s.regles.prime_bps);
        }
        let taux_depot = if fourni > 0 { flux * (BPS - r.reserve_bps) / (fourni * BPS) } else { 0 };
        let pl = plafonds(&env);
        Marche {
            total_fourni: fourni,
            total_emprunte: e.emprunte(),
            caisse: jeton_pret(&env).balance(&env.current_contract_address()),
            reserve: e.reserve,
            utilisation_bps: u,
            taux_base_bps: base,
            taux_depot_bps: taux_depot,
            demo_perso: demo_perso(&env),
            plafond_fixe: pl.fixe,
            plafond_caisse_bps: pl.caisse_bps,
            nb_spokes: liste(&env).len(),
        }
    }

    pub fn spoke(env: Env, jeton: Address) -> Result<VueSpoke, Erreur> {
        let e = calculer(&env);
        let s = e.spoke(&jeton)?;
        Ok(vue_spoke(&env, &e, &jeton, &s))
    }

    /// Tous les spokes, dans l'ordre d'ajout.
    pub fn spokes(env: Env) -> Vec<VueSpoke> {
        let e = calculer(&env);
        let mut v = Vec::new(&env);
        for jeton in liste(&env).iter() {
            if let Some(s) = e.spokes.get(jeton.clone()) {
                v.push_back(vue_spoke(&env, &e, &jeton, &s));
            }
        }
        v
    }

    pub fn reglages_taux(env: Env) -> ReglagesTaux {
        reglages(&env)
    }

    pub fn jeton_pret(env: Env) -> Address {
        lire(&env, &Cle::JetonPret)
    }
}

impl Hub {
    fn vue(env: &Env, s: &Spoke, qui: &Address, jeton: &Address) -> VuePosition {
        let p = position(env, qui, jeton);
        let dette = dette_totale(&p, s.index);
        let px = prix_pour(env, s, qui, jeton);
        let v = valeur_a(p.garantie, px);
        let ltv_bps = if v > 0 { dette * BPS / v } else if dette > 0 { BPS } else { 0 };
        let max = v * s.regles.ltv_max_bps / BPS;
        let prix_liquidation = if dette > 0 && p.garantie > 0 { dette * UNITE * BPS / (p.garantie * s.regles.seuil_bps) } else { 0 };
        VuePosition {
            jeton: jeton.clone(),
            garantie: p.garantie,
            dette,
            dette_demo: p.dette_demo,
            prix: px,
            prix_demo_actif: px != prix_spoke(env, s, jeton),
            valeur: v,
            ltv_bps,
            disponible: if max > dette { max - dette } else { 0 },
            prix_liquidation,
            liquidable: est_liquidable(dette, p.garantie, px, &s.regles),
        }
    }
}

mod test;
