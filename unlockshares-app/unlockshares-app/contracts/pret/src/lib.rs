#![no_std]
//! UnlockShares : prêt de tUSDC garanti par des actions tokenisées (tAAPL).
//! Analogie : un prêteur sur gages. Léa dépose ses actions (le gage),
//! emprunte jusqu'à 50 % de leur valeur, et un liquidateur peut saisir
//! le gage si la dette dépasse 80 % de la valeur.
//!
//! Intérêts : comme un compteur de taxi. Deux index (emprunt et dépôt) partent
//! de 1 et grossissent avec le temps. Chaque dette et chaque dépôt est stocké
//! en « parts » : montant réel = parts × index. Le taux d'emprunt suit
//! l'utilisation U de la caisse (emprunté / fourni), avec un « coude » :
//! - U ≤ 80 % : taux = U × 6 % / 80 %  (0 % si personne n'emprunte, 3,75 % à 50 %)
//! - U > 80 % : taux = 6 % + (U − 80 %) × (60 % − 6 %) / 20 %  (60 % à 100 %)
//! Comme un péage dynamique : quand la route sature, le prix grimpe vite.
//! Les prêteurs touchent ces intérêts, moins 10 % gardés en réserve.
//! Ces réglages sont modifiables par l'admin sans redéploiement.

use soroban_sdk::{contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env};

/// 1 jeton = 10_000_000 unités (7 décimales, comme tous les actifs Stellar).
pub const UNITE: i128 = 10_000_000;
/// Emprunt maximum : 50 % de la valeur de la garantie (en points de base).
pub const LTV_MAX_BPS: i128 = 5_000;
/// Seuil de liquidation : 80 % de la valeur de la garantie.
pub const SEUIL_LIQUIDATION_BPS: i128 = 8_000;
/// Bonus du liquidateur : il reçoit 105 % de la dette qu'il rembourse.
pub const BONUS_LIQUIDATION_BPS: i128 = 500;
/// Après une liquidation partielle, la dette revient à 60 % de la valeur des actions.
pub const CIBLE_APRES_LIQUIDATION_BPS: i128 = 6_000;
/// Réglages par défaut de la courbe de taux.
pub const COUDE_BPS: i128 = 8_000; // le coude est à 80 % d'utilisation
pub const TAUX_COUDE_BPS: i128 = 600; // 6 % au coude
pub const TAUX_MAX_BPS: i128 = 6_000; // 60 % à 100 % d'utilisation
pub const RESERVE_BPS: i128 = 1_000; // 10 % des intérêts gardés en réserve
/// Réserve maximum autorisée : 50 % des intérêts.
pub const RESERVE_MAX_BPS: i128 = 5_000;
/// Précision des index (1,0 = RAY).
pub const RAY: i128 = 1_000_000_000_000_000_000;
/// Une année en secondes.
pub const ANNEE: u64 = 31_536_000;
const BPS: i128 = 10_000;

const JOUR: u32 = 17_280; // ~ 1 jour de ledgers (5 s)
const TTL_SEUIL: u32 = 30 * JOUR;
const TTL_CIBLE: u32 = 60 * JOUR;

#[contracttype]
#[derive(Clone)]
pub enum Cle {
    Admin,
    JetonGarantie,
    JetonPret,
    Prix,
    ModeDemo,
    /// Somme des parts de dépôt de tous les prêteurs.
    TotalFourni,
    /// Somme des parts de dette de tous les emprunteurs.
    TotalEmprunte,
    /// Parts de dépôt d'un prêteur.
    Fourni(Address),
    Position(Address),
    IndexEmprunt,
    IndexDepot,
    /// Dernière mise à jour des index (secondes).
    DerniereMaj,
    /// Intérêts gardés par le protocole (tUSDC réels).
    Reserve,
    /// Temps ajouté par le bouton démo « avancer le temps » (secondes).
    Decalage,
    /// Réglages de la courbe de taux.
    Reglages,
}

/// Les boutons de réglage de la courbe de taux (en points de base).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReglagesTaux {
    /// Utilisation où la pente change (8000 = 80 %).
    pub coude_bps: i128,
    /// Taux d'emprunt au coude (600 = 6 %).
    pub taux_coude_bps: i128,
    /// Taux d'emprunt à 100 % d'utilisation (6000 = 60 %).
    pub taux_max_bps: i128,
    /// Part des intérêts gardée en réserve (1000 = 10 %).
    pub reserve_bps: i128,
}

fn reglages_defaut() -> ReglagesTaux {
    ReglagesTaux {
        coude_bps: COUDE_BPS,
        taux_coude_bps: TAUX_COUDE_BPS,
        taux_max_bps: TAUX_MAX_BPS,
        reserve_bps: RESERVE_BPS,
    }
}

/// Ce que Léa a mis en gage et ce qu'elle doit (en parts de dette).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Position {
    pub garantie: i128,
    pub parts_dette: i128,
}

/// La position lue par l'appli, avec les calculs déjà faits (intérêts inclus).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VuePosition {
    pub garantie: i128,
    /// Dette réelle, intérêts compris.
    pub dette: i128,
    /// Valeur de la garantie en tUSDC.
    pub valeur: i128,
    /// Part de la valeur empruntée, en points de base (5000 = 50 %).
    pub ltv_bps: i128,
    /// Ce qu'elle peut encore emprunter.
    pub disponible: i128,
    /// Prix de l'action (tUSDC) en dessous duquel elle est liquidable. 0 si pas de dette.
    pub prix_liquidation: i128,
    pub liquidable: bool,
}

/// L'état global du marché (montants réels, intérêts compris).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Marche {
    pub prix: i128,
    pub total_fourni: i128,
    pub total_emprunte: i128,
    pub caisse: i128,
    pub mode_demo: bool,
    /// Emprunté / fourni, en points de base.
    pub utilisation_bps: i128,
    /// Taux d'emprunt annuel, en points de base (550 = 5,5 %).
    pub taux_emprunt_bps: i128,
    /// Taux annuel versé aux prêteurs, en points de base.
    pub taux_depot_bps: i128,
    /// Intérêts gardés par le protocole.
    pub reserve: i128,
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
}

#[contractevent]
pub struct PrixFixe { pub par: Address, pub prix: i128 }
#[contractevent(topics = ["temps_avance"])]
pub struct TempsAvance { pub par: Address, pub secondes: u64 }
#[contractevent]
pub struct ReglagesFixes { pub reglages: ReglagesTaux }
#[contractevent]
pub struct Fourni { #[topic] pub preteur: Address, pub montant: i128 }
#[contractevent]
pub struct FondsRetires { #[topic] pub preteur: Address, pub montant: i128 }
#[contractevent]
pub struct ReserveRetiree { pub montant: i128 }
#[contractevent]
pub struct Depose { #[topic] pub emprunteur: Address, pub montant: i128 }
#[contractevent]
pub struct GarantieRetiree { #[topic] pub emprunteur: Address, pub montant: i128 }
#[contractevent]
pub struct Emprunte { #[topic] pub emprunteur: Address, pub montant: i128 }
#[contractevent]
pub struct Rembourse { #[topic] pub emprunteur: Address, pub montant: i128 }
#[contractevent]
pub struct Liquide {
    #[topic] pub emprunteur: Address,
    #[topic] pub liquidateur: Address,
    pub dette: i128,
    pub garantie_saisie: i128,
}

#[contract]
pub struct UnlockShares;

// ---------- petits outils internes ----------

fn lire<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(env: &Env, cle: &Cle) -> V {
    env.storage().instance().get(cle).unwrap()
}

fn prix(env: &Env) -> i128 {
    lire(env, &Cle::Prix)
}

fn valeur(env: &Env, garantie: i128) -> i128 {
    // Toujours multiplier avant de diviser.
    garantie * prix(env) / UNITE
}

fn position(env: &Env, qui: &Address) -> Position {
    env.storage()
        .persistent()
        .get(&Cle::Position(qui.clone()))
        .unwrap_or(Position { garantie: 0, parts_dette: 0 })
}

fn ecrire_position(env: &Env, qui: &Address, p: &Position) {
    let cle = Cle::Position(qui.clone());
    if p.garantie == 0 && p.parts_dette == 0 {
        env.storage().persistent().remove(&cle);
    } else {
        env.storage().persistent().set(&cle, p);
        env.storage().persistent().extend_ttl(&cle, TTL_SEUIL, TTL_CIBLE);
    }
}

fn garder_en_vie(env: &Env) {
    env.storage().instance().extend_ttl(TTL_SEUIL, TTL_CIBLE);
}

fn jeton_garantie(env: &Env) -> token::Client<'_> {
    token::Client::new(env, &lire::<Address>(env, &Cle::JetonGarantie))
}

fn jeton_pret(env: &Env) -> token::Client<'_> {
    token::Client::new(env, &lire::<Address>(env, &Cle::JetonPret))
}

fn positif(montant: i128) -> Result<(), Erreur> {
    if montant <= 0 { Err(Erreur::MontantInvalide) } else { Ok(()) }
}

fn reglages(env: &Env) -> ReglagesTaux {
    env.storage().instance().get(&Cle::Reglages).unwrap_or(reglages_defaut())
}

/// Ce qui peut sortir de la caisse : tout sauf la réserve (elle appartient au protocole).
fn caisse_libre(env: &Env, reserve: i128) -> i128 {
    let solde = jeton_pret(env).balance(&env.current_contract_address());
    if solde > reserve { solde - reserve } else { 0 }
}

/// Mode démo actif, ou appelant = admin ?
fn autorise_demo(env: &Env, appelant: &Address) -> bool {
    let admin: Address = lire(env, &Cle::Admin);
    let demo: bool = lire(env, &Cle::ModeDemo);
    demo || *appelant == admin
}

/// La dette reste-t-elle sous la limite d'emprunt (50 %) ?
fn sous_la_limite(env: &Env, dette: i128, garantie: i128) -> bool {
    dette * BPS <= valeur(env, garantie) * LTV_MAX_BPS
}

fn est_liquidable(env: &Env, dette: i128, garantie: i128) -> bool {
    dette > 0 && dette * BPS > valeur(env, garantie) * SEUIL_LIQUIDATION_BPS
}

// ---------- intérêts ----------

/// Parts → montant réel, arrondi vers le bas (ce qu'on doit à un prêteur).
fn reel_bas(parts: i128, index: i128) -> i128 {
    parts * index / RAY
}

/// Parts → montant réel, arrondi vers le haut (ce que doit un emprunteur).
fn reel_haut(parts: i128, index: i128) -> i128 {
    (parts * index + RAY - 1) / RAY
}

fn parts_bas(montant: i128, index: i128) -> i128 {
    montant * RAY / index
}

fn parts_haut(montant: i128, index: i128) -> i128 {
    (montant * RAY + index - 1) / index
}

fn utilisation_bps(emprunte: i128, fourni: i128) -> i128 {
    if fourni <= 0 {
        return if emprunte > 0 { BPS } else { 0 };
    }
    let u = emprunte * BPS / fourni;
    if u > BPS { BPS } else { u }
}

/// Taux d'emprunt : courbe à coude.
/// U ≤ coude : U × taux_coude / coude ; au-delà : taux_coude + (U − coude) × (max − taux_coude) / (100 % − coude).
fn taux_emprunt_bps(utilisation: i128, r: &ReglagesTaux) -> i128 {
    if utilisation <= r.coude_bps {
        utilisation * r.taux_coude_bps / r.coude_bps
    } else {
        r.taux_coude_bps + (utilisation - r.coude_bps) * (r.taux_max_bps - r.taux_coude_bps) / (BPS - r.coude_bps)
    }
}

/// Taux des prêteurs = taux d'emprunt × utilisation × (1 − réserve).
fn taux_depot_bps(utilisation: i128, r: &ReglagesTaux) -> i128 {
    taux_emprunt_bps(utilisation, r) * utilisation * (BPS - r.reserve_bps) / (BPS * BPS)
}

/// L'état des intérêts du marché.
struct Etat {
    index_emprunt: i128,
    index_depot: i128,
    parts_emprunt: i128,
    parts_depot: i128,
    reserve: i128,
    maj: u64,
}

impl Etat {
    fn emprunte(&self) -> i128 { reel_haut(self.parts_emprunt, self.index_emprunt) }
    fn fourni(&self) -> i128 { reel_bas(self.parts_depot, self.index_depot) }
    fn utilisation(&self) -> i128 { utilisation_bps(self.emprunte(), self.fourni()) }
}

fn maintenant(env: &Env) -> u64 {
    let decalage: u64 = env.storage().instance().get(&Cle::Decalage).unwrap_or(0);
    env.ledger().timestamp() + decalage
}

/// Calcule l'état à l'instant présent, sans rien écrire (utilisé par les lectures).
fn calculer(env: &Env) -> Etat {
    let s = env.storage().instance();
    let mut e = Etat {
        index_emprunt: s.get(&Cle::IndexEmprunt).unwrap_or(RAY),
        index_depot: s.get(&Cle::IndexDepot).unwrap_or(RAY),
        parts_emprunt: s.get(&Cle::TotalEmprunte).unwrap_or(0),
        parts_depot: s.get(&Cle::TotalFourni).unwrap_or(0),
        reserve: s.get(&Cle::Reserve).unwrap_or(0),
        maj: s.get(&Cle::DerniereMaj).unwrap_or(0),
    };
    let t = maintenant(env);
    if t <= e.maj {
        return e;
    }
    let dt = (t - e.maj) as i128;
    let emprunte = e.emprunte();
    if emprunte > 0 {
        let fourni = e.fourni();
        let r = reglages(env);
        let taux = taux_emprunt_bps(utilisation_bps(emprunte, fourni), &r);
        let nouvel_index = e.index_emprunt + e.index_emprunt * taux * dt / (BPS * ANNEE as i128);
        let interets = reel_haut(e.parts_emprunt, nouvel_index) - emprunte;
        let pour_reserve = interets * r.reserve_bps / BPS;
        if fourni > 0 {
            e.index_depot += e.index_depot * (interets - pour_reserve) / fourni;
            e.reserve += pour_reserve;
        } else {
            e.reserve += interets;
        }
        e.index_emprunt = nouvel_index;
    }
    e.maj = t;
    e
}

fn ecrire_etat(env: &Env, e: &Etat) {
    let s = env.storage().instance();
    s.set(&Cle::IndexEmprunt, &e.index_emprunt);
    s.set(&Cle::IndexDepot, &e.index_depot);
    s.set(&Cle::TotalEmprunte, &e.parts_emprunt);
    s.set(&Cle::TotalFourni, &e.parts_depot);
    s.set(&Cle::Reserve, &e.reserve);
    s.set(&Cle::DerniereMaj, &e.maj);
}

/// Fait tourner le compteur jusqu'à maintenant et l'enregistre.
fn actualiser(env: &Env) -> Etat {
    let e = calculer(env);
    ecrire_etat(env, &e);
    e
}

/// Rembourse `montant` (réel) sur une dette de `parts` : renvoie les parts à retirer.
fn parts_remboursees(montant: i128, dette: i128, parts: i128, index: i128) -> i128 {
    if montant >= dette {
        return parts;
    }
    let p = parts_bas(montant, index);
    if p > parts { parts } else { p }
}

#[contractimpl]
impl UnlockShares {
    /// Configuration au déploiement. `prix` = tUSDC (en unités) pour 1 tAAPL entier.
    /// `mode_demo` = true : tout le monde peut changer le prix et avancer le temps (testnet uniquement).
    pub fn __constructor(env: Env, admin: Address, jeton_garantie: Address, jeton_pret: Address, prix: i128, mode_demo: bool) {
        if prix <= 0 {
            panic!("prix invalide");
        }
        let s = env.storage().instance();
        s.set(&Cle::Admin, &admin);
        s.set(&Cle::JetonGarantie, &jeton_garantie);
        s.set(&Cle::JetonPret, &jeton_pret);
        s.set(&Cle::Prix, &prix);
        s.set(&Cle::ModeDemo, &mode_demo);
        s.set(&Cle::Decalage, &0u64);
        s.set(&Cle::Reglages, &reglages_defaut());
        ecrire_etat(&env, &Etat {
            index_emprunt: RAY,
            index_depot: RAY,
            parts_emprunt: 0,
            parts_depot: 0,
            reserve: 0,
            maj: env.ledger().timestamp(),
        });
        garder_en_vie(&env);
    }

    // ---------- le faux oracle et les contrôles de démo ----------

    /// Change le prix de l'action. Admin seulement, sauf en mode démo.
    pub fn fixer_prix(env: Env, appelant: Address, prix: i128) -> Result<(), Erreur> {
        appelant.require_auth();
        if !autorise_demo(&env, &appelant) {
            return Err(Erreur::NonAutorise);
        }
        if prix <= 0 {
            return Err(Erreur::PrixInvalide);
        }
        env.storage().instance().set(&Cle::Prix, &prix);
        garder_en_vie(&env);
        PrixFixe { par: appelant, prix }.publish(&env);
        Ok(())
    }

    /// Démo : fait comme si `secondes` s'étaient écoulées (les intérêts tombent d'un coup).
    /// Uniquement en mode démo, même pour l'admin : en production, le temps ne se triche pas.
    pub fn avancer_temps(env: Env, appelant: Address, secondes: u64) -> Result<(), Erreur> {
        appelant.require_auth();
        let demo: bool = lire(&env, &Cle::ModeDemo);
        if !demo {
            return Err(Erreur::NonAutorise);
        }
        if secondes == 0 || secondes > 10 * ANNEE {
            return Err(Erreur::MontantInvalide);
        }
        actualiser(&env);
        let decalage: u64 = env.storage().instance().get(&Cle::Decalage).unwrap_or(0);
        env.storage().instance().set(&Cle::Decalage, &(decalage + secondes));
        actualiser(&env);
        garder_en_vie(&env);
        TempsAvance { par: appelant, secondes }.publish(&env);
        Ok(())
    }

    /// Change la courbe de taux sans redéployer. Admin seulement.
    /// Les intérêts déjà courus sont comptés à l'ancien taux avant le changement.
    pub fn fixer_reglages_taux(env: Env, reglages: ReglagesTaux) -> Result<(), Erreur> {
        let admin: Address = lire(&env, &Cle::Admin);
        admin.require_auth();
        let r = &reglages;
        if r.coude_bps <= 0
            || r.coude_bps >= BPS
            || r.taux_coude_bps < 0
            || r.taux_max_bps < r.taux_coude_bps
            || r.reserve_bps < 0
            || r.reserve_bps > RESERVE_MAX_BPS
        {
            return Err(Erreur::MontantInvalide);
        }
        actualiser(&env);
        env.storage().instance().set(&Cle::Reglages, &reglages);
        garder_en_vie(&env);
        ReglagesFixes { reglages }.publish(&env);
        Ok(())
    }

    /// Active ou coupe le mode démo. Admin seulement.
    pub fn fixer_mode_demo(env: Env, actif: bool) {
        let admin: Address = lire(&env, &Cle::Admin);
        admin.require_auth();
        env.storage().instance().set(&Cle::ModeDemo, &actif);
        garder_en_vie(&env);
    }

    // ---------- côté prêteurs ----------

    /// Le prêteur remplit la caisse en tUSDC.
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

    /// Le prêteur reprend ses tUSDC (intérêts compris), dans la limite de ce qui est en caisse.
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
        let pret = jeton_pret(&env);
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
        pret.transfer(&env.current_contract_address(), &preteur, &montant);
        FondsRetires { preteur, montant }.publish(&env);
        Ok(())
    }

    /// L'admin récupère les intérêts gardés en réserve.
    pub fn retirer_reserve(env: Env, montant: i128) -> Result<(), Erreur> {
        let admin: Address = lire(&env, &Cle::Admin);
        admin.require_auth();
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
        pret.transfer(&env.current_contract_address(), &admin, &montant);
        ReserveRetiree { montant }.publish(&env);
        Ok(())
    }

    // ---------- côté emprunteurs ----------

    /// Léa met ses actions en gage.
    pub fn deposer(env: Env, emprunteur: Address, montant: i128) -> Result<(), Erreur> {
        emprunteur.require_auth();
        positif(montant)?;
        jeton_garantie(&env).transfer(&emprunteur, &env.current_contract_address(), &montant);
        let mut p = position(&env, &emprunteur);
        p.garantie += montant;
        ecrire_position(&env, &emprunteur, &p);
        garder_en_vie(&env);
        Depose { emprunteur, montant }.publish(&env);
        Ok(())
    }

    /// Léa reprend des actions, si sa dette (intérêts compris) reste sous 50 %.
    pub fn retirer(env: Env, emprunteur: Address, montant: i128) -> Result<(), Erreur> {
        emprunteur.require_auth();
        positif(montant)?;
        let e = actualiser(&env);
        let mut p = position(&env, &emprunteur);
        if montant > p.garantie {
            return Err(Erreur::SoldeInsuffisant);
        }
        p.garantie -= montant;
        if !sous_la_limite(&env, reel_haut(p.parts_dette, e.index_emprunt), p.garantie) {
            return Err(Erreur::GarantieInsuffisante);
        }
        ecrire_position(&env, &emprunteur, &p);
        garder_en_vie(&env);
        jeton_garantie(&env).transfer(&env.current_contract_address(), &emprunteur, &montant);
        GarantieRetiree { emprunteur, montant }.publish(&env);
        Ok(())
    }

    /// Léa reçoit des tUSDC, tant que sa dette (intérêts compris) reste sous 50 % de la valeur de ses actions.
    pub fn emprunter(env: Env, emprunteur: Address, montant: i128) -> Result<(), Erreur> {
        emprunteur.require_auth();
        positif(montant)?;
        let mut e = actualiser(&env);
        let mut p = position(&env, &emprunteur);
        let dette = reel_haut(p.parts_dette, e.index_emprunt) + montant;
        if !sous_la_limite(&env, dette, p.garantie) {
            return Err(Erreur::GarantieInsuffisante);
        }
        let pret = jeton_pret(&env);
        if montant > caisse_libre(&env, e.reserve) {
            return Err(Erreur::CaisseVide);
        }
        let parts = parts_haut(montant, e.index_emprunt);
        p.parts_dette += parts;
        e.parts_emprunt += parts;
        ecrire_position(&env, &emprunteur, &p);
        ecrire_etat(&env, &e);
        garder_en_vie(&env);
        pret.transfer(&env.current_contract_address(), &emprunteur, &montant);
        Emprunte { emprunteur, montant }.publish(&env);
        Ok(())
    }

    /// Léa rembourse tout ou partie de sa dette (intérêts compris). Un montant trop grand est ramené à la dette.
    pub fn rembourser(env: Env, emprunteur: Address, montant: i128) -> Result<i128, Erreur> {
        emprunteur.require_auth();
        positif(montant)?;
        let mut e = actualiser(&env);
        let mut p = position(&env, &emprunteur);
        let dette = reel_haut(p.parts_dette, e.index_emprunt);
        if dette == 0 {
            return Err(Erreur::PasDeDette);
        }
        let paye = if montant > dette { dette } else { montant };
        jeton_pret(&env).transfer(&emprunteur, &env.current_contract_address(), &paye);
        let brulees = parts_remboursees(paye, dette, p.parts_dette, e.index_emprunt);
        p.parts_dette -= brulees;
        e.parts_emprunt -= brulees;
        ecrire_position(&env, &emprunteur, &p);
        ecrire_etat(&env, &e);
        garder_en_vie(&env);
        Rembourse { emprunteur, montant: paye }.publish(&env);
        Ok(paye)
    }

    // ---------- le liquidateur ----------

    /// Si la dette (intérêts compris) dépasse 80 % : le liquidateur rembourse juste ce qu'il faut
    /// pour ramener la dette à 60 % de la valeur, et reçoit des actions valant
    /// ce montant + 5 %. Si c'est impossible (dette au-delà d'environ 95 %),
    /// il rembourse toute la dette et reçoit au plus toute la garantie.
    pub fn liquider(env: Env, liquidateur: Address, emprunteur: Address) -> Result<i128, Erreur> {
        liquidateur.require_auth();
        let mut e = actualiser(&env);
        let mut p = position(&env, &emprunteur);
        let dette_totale = reel_haut(p.parts_dette, e.index_emprunt);
        if !est_liquidable(&env, dette_totale, p.garantie) {
            return Err(Erreur::PasLiquidable);
        }
        let px = prix(&env);
        let v = valeur(&env, p.garantie);
        // (dette - x) = 60 % × (valeur - 105 % × x)  =>  x = (dette - 60 % × valeur) / (1 - 60 % × 105 %)
        let denominateur = BPS - CIBLE_APRES_LIQUIDATION_BPS * (BPS + BONUS_LIQUIDATION_BPS) / BPS;
        let partiel = (dette_totale * BPS - CIBLE_APRES_LIQUIDATION_BPS * v + denominateur - 1) / denominateur;
        let saisie_partielle = partiel * (BPS + BONUS_LIQUIDATION_BPS) * UNITE / (BPS * px);
        let (dette, mut saisie) = if partiel > 0 && partiel < dette_totale && saisie_partielle < p.garantie {
            (partiel, saisie_partielle)
        } else {
            (dette_totale, dette_totale * (BPS + BONUS_LIQUIDATION_BPS) * UNITE / (BPS * px))
        };
        if saisie > p.garantie {
            saisie = p.garantie;
        }
        jeton_pret(&env).transfer(&liquidateur, &env.current_contract_address(), &dette);
        let brulees = parts_remboursees(dette, dette_totale, p.parts_dette, e.index_emprunt);
        p.parts_dette -= brulees;
        e.parts_emprunt -= brulees;
        p.garantie -= saisie;
        ecrire_position(&env, &emprunteur, &p);
        ecrire_etat(&env, &e);
        garder_en_vie(&env);
        jeton_garantie(&env).transfer(&env.current_contract_address(), &liquidateur, &saisie);
        Liquide { emprunteur, liquidateur, dette, garantie_saisie: saisie }.publish(&env);
        Ok(saisie)
    }

    // ---------- lectures (gratuites, intérêts calculés jusqu'à maintenant) ----------

    pub fn position(env: Env, emprunteur: Address) -> VuePosition {
        let e = calculer(&env);
        let p = position(&env, &emprunteur);
        let dette = reel_haut(p.parts_dette, e.index_emprunt);
        let v = valeur(&env, p.garantie);
        let ltv_bps = if v > 0 { dette * BPS / v } else if dette > 0 { BPS } else { 0 };
        let max = v * LTV_MAX_BPS / BPS;
        let disponible = if max > dette { max - dette } else { 0 };
        // Prix où dette = 80 % de la valeur : dette × UNITE / (garantie × 80 %).
        let prix_liquidation = if dette > 0 && p.garantie > 0 {
            dette * UNITE * BPS / (p.garantie * SEUIL_LIQUIDATION_BPS)
        } else {
            0
        };
        VuePosition {
            liquidable: est_liquidable(&env, dette, p.garantie),
            garantie: p.garantie,
            dette,
            valeur: v,
            ltv_bps,
            disponible,
            prix_liquidation,
        }
    }

    /// Ce que le prêteur peut reprendre, intérêts compris.
    pub fn fourni(env: Env, preteur: Address) -> i128 {
        let e = calculer(&env);
        let parts: i128 = env.storage().persistent().get(&Cle::Fourni(preteur)).unwrap_or(0);
        reel_bas(parts, e.index_depot)
    }

    pub fn marche(env: Env) -> Marche {
        let e = calculer(&env);
        let u = e.utilisation();
        let r = reglages(&env);
        Marche {
            prix: prix(&env),
            total_fourni: e.fourni(),
            total_emprunte: e.emprunte(),
            caisse: jeton_pret(&env).balance(&env.current_contract_address()),
            mode_demo: lire(&env, &Cle::ModeDemo),
            utilisation_bps: u,
            taux_emprunt_bps: taux_emprunt_bps(u, &r),
            taux_depot_bps: taux_depot_bps(u, &r),
            reserve: e.reserve,
        }
    }

    pub fn reglages_taux(env: Env) -> ReglagesTaux {
        reglages(&env)
    }

    pub fn jetons(env: Env) -> (Address, Address) {
        (lire(&env, &Cle::JetonGarantie), lire(&env, &Cle::JetonPret))
    }
}

mod test;
