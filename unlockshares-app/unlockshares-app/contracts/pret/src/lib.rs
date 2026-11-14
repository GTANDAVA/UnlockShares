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
//!
//! V2 (sécurité de la démo) :
//! - prix de référence : ADMIN SEULEMENT (plus de mode démo global, plus d'avance du temps globale) ;
//! - plafonds d'emprunt : dette par adresse ≤ plafond fixe, et chaque emprunt ≤ X % de la caisse libre ;
//! - démo PERSONNELLE : chacun peut baisser son propre prix (jamais au-dessus de la référence) et ajouter
//!   des intérêts simulés à sa propre dette. Cela ne touche que sa position : la caisse, les taux,
//!   les prêteurs et les autres emprunteurs ne bougent pas. La liquidation qui en découle est réelle.

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
    /// Outils de démo personnels autorisés (prix perso, temps perso).
    DemoPerso,
    /// Plafonds d'emprunt.
    Plafonds,
    /// Prix de démo personnel d'un emprunteur (≤ prix de référence).
    PrixDemo(Address),
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
    /// Intérêts simulés par la démo personnelle (montant réel, hors index, versé à la réserve au remboursement).
    pub dette_demo: i128,
}

/// Plafonds d'emprunt (anti-vidange de la caisse).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plafonds {
    /// Dette maximum par adresse (unités du jeton prêté).
    pub fixe: i128,
    /// Chaque emprunt ≤ ce pourcentage de la caisse libre (points de base, 2000 = 20 %).
    pub caisse_bps: i128,
}

/// La position lue par l'appli, avec les calculs déjà faits (intérêts inclus).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VuePosition {
    pub garantie: i128,
    /// Dette réelle, intérêts compris (dont intérêts de démo).
    pub dette: i128,
    /// Part de la dette venant de la démo personnelle (avance du temps perso).
    pub dette_demo: i128,
    /// Prix utilisé pour CETTE position (prix de démo perso s'il existe, sinon prix de référence).
    pub prix: i128,
    /// Vrai si un prix de démo personnel est actif.
    pub prix_demo_actif: bool,
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
    /// Outils de démo personnels autorisés.
    pub demo_perso: bool,
    pub plafond_fixe: i128,
    pub plafond_caisse_bps: i128,
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
    PlafondDepasse = 9,
}

#[contractevent]
pub struct PrixFixe { pub par: Address, pub prix: i128 }
#[contractevent]
pub struct PrixDemoFixe { #[topic] pub emprunteur: Address, pub prix: i128 }
#[contractevent(topics = ["temps_perso"])]
pub struct TempsPersoAvance { #[topic] pub emprunteur: Address, pub secondes: u64, pub interets: i128 }
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

fn prix_demo(env: &Env, qui: &Address) -> Option<i128> {
    env.storage().persistent().get(&Cle::PrixDemo(qui.clone()))
}

/// Prix utilisé pour la position de `qui` : son prix de démo s'il existe, jamais au-dessus du prix de référence.
fn prix_pour(env: &Env, qui: &Address) -> i128 {
    let reference = prix(env);
    match prix_demo(env, qui) {
        Some(p) if p < reference => p,
        _ => reference,
    }
}

fn valeur_a(garantie: i128, px: i128) -> i128 {
    // Toujours multiplier avant de diviser.
    garantie * px / UNITE
}

fn position(env: &Env, qui: &Address) -> Position {
    env.storage()
        .persistent()
        .get(&Cle::Position(qui.clone()))
        .unwrap_or(Position { garantie: 0, parts_dette: 0, dette_demo: 0 })
}

/// Dette totale réelle : parts × index + intérêts de démo.
fn dette_totale(p: &Position, index: i128) -> i128 {
    reel_haut(p.parts_dette, index) + p.dette_demo
}

fn plafonds(env: &Env) -> Plafonds {
    lire(env, &Cle::Plafonds)
}

fn demo_perso(env: &Env) -> bool {
    env.storage().instance().get(&Cle::DemoPerso).unwrap_or(false)
}

fn ecrire_position(env: &Env, qui: &Address, p: &Position) {
    let cle = Cle::Position(qui.clone());
    if p.garantie == 0 && p.parts_dette == 0 && p.dette_demo == 0 {
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

/// La dette reste-t-elle sous la limite d'emprunt (50 %) au prix `px` ?
fn sous_la_limite(dette: i128, garantie: i128, px: i128) -> bool {
    dette * BPS <= valeur_a(garantie, px) * LTV_MAX_BPS
}

fn est_liquidable(dette: i128, garantie: i128, px: i128) -> bool {
    dette > 0 && dette * BPS > valeur_a(garantie, px) * SEUIL_LIQUIDATION_BPS
}

/// Montant que le liquidateur peut rembourser : ce qu'il faut pour ramener la dette à 60 % de la valeur,
/// ou toute la dette si c'est impossible (au-delà d'environ 95 %). 0 si la position n'est pas liquidable.
fn montant_liquidable_calc(dette: i128, garantie: i128, px: i128) -> i128 {
    if !est_liquidable(dette, garantie, px) {
        return 0;
    }
    let v = valeur_a(garantie, px);
    // (dette - x) = 60 % × (valeur - 105 % × x)  =>  x = (dette - 60 % × valeur) / (1 - 60 % × 105 %)
    let denominateur = BPS - CIBLE_APRES_LIQUIDATION_BPS * (BPS + BONUS_LIQUIDATION_BPS) / BPS;
    let partiel = (dette * BPS - CIBLE_APRES_LIQUIDATION_BPS * v + denominateur - 1) / denominateur;
    let saisie_partielle = partiel * (BPS + BONUS_LIQUIDATION_BPS) * UNITE / (BPS * px);
    if partiel > 0 && partiel < dette && saisie_partielle < garantie { partiel } else { dette }
}

/// Répartit un paiement : d'abord les intérêts de démo (vers la réserve), puis la dette indexée.
/// Renvoie (part démo, parts de dette à brûler).
fn repartir_paiement(paye: i128, p: &Position, index: i128) -> (i128, i128) {
    let vers_demo = if paye < p.dette_demo { paye } else { p.dette_demo };
    let reste = paye - vers_demo;
    let dette_indexee = reel_haut(p.parts_dette, index);
    let brulees = if reste <= 0 { 0 } else { parts_remboursees(reste, dette_indexee, p.parts_dette, index) };
    (vers_demo, brulees)
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
    env.ledger().timestamp()
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
    /// Configuration au déploiement. `prix` = jeton prêté (en unités) pour 1 action entière.
    /// `plafond_fixe` / `plafond_caisse_bps` : plafonds d'emprunt. `demo_perso` : outils de démo personnels autorisés.
    pub fn __constructor(env: Env, admin: Address, jeton_garantie: Address, jeton_pret: Address, prix: i128, plafond_fixe: i128, plafond_caisse_bps: i128, demo_perso: bool) {
        if prix <= 0 {
            panic!("prix invalide");
        }
        if plafond_fixe <= 0 || plafond_caisse_bps <= 0 || plafond_caisse_bps > BPS {
            panic!("plafonds invalides");
        }
        let s = env.storage().instance();
        s.set(&Cle::Admin, &admin);
        s.set(&Cle::JetonGarantie, &jeton_garantie);
        s.set(&Cle::JetonPret, &jeton_pret);
        s.set(&Cle::Prix, &prix);
        s.set(&Cle::DemoPerso, &demo_perso);
        s.set(&Cle::Plafonds, &Plafonds { fixe: plafond_fixe, caisse_bps: plafond_caisse_bps });
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

    // ---------- contrôles admin (globaux) ----------

    /// Change le prix de RÉFÉRENCE de l'action. Admin seulement (prix administré, pas un prix de marché).
    pub fn fixer_prix(env: Env, prix: i128) -> Result<(), Erreur> {
        let admin: Address = lire(&env, &Cle::Admin);
        admin.require_auth();
        if prix <= 0 {
            return Err(Erreur::PrixInvalide);
        }
        env.storage().instance().set(&Cle::Prix, &prix);
        garder_en_vie(&env);
        PrixFixe { par: admin, prix }.publish(&env);
        Ok(())
    }

    /// Change les plafonds d'emprunt. Admin seulement. Ne touche pas aux dettes existantes.
    pub fn fixer_plafonds(env: Env, fixe: i128, caisse_bps: i128) -> Result<(), Erreur> {
        let admin: Address = lire(&env, &Cle::Admin);
        admin.require_auth();
        if fixe <= 0 || caisse_bps <= 0 || caisse_bps > BPS {
            return Err(Erreur::MontantInvalide);
        }
        let plafonds = Plafonds { fixe, caisse_bps };
        env.storage().instance().set(&Cle::Plafonds, &plafonds);
        garder_en_vie(&env);
        PlafondsFixes { plafonds }.publish(&env);
        Ok(())
    }

    /// Autorise ou coupe les outils de démo personnels. Admin seulement.
    /// Coupés : plus de nouveau prix perso ni de temps perso ; les prix perso existants restent appliqués
    /// jusqu'à leur réinitialisation par leur propriétaire (pour ne pas modifier une position sans son accord).
    pub fn fixer_demo_perso(env: Env, actif: bool) {
        let admin: Address = lire(&env, &Cle::Admin);
        admin.require_auth();
        env.storage().instance().set(&Cle::DemoPerso, &actif);
        garder_en_vie(&env);
        DemoPersoFixee { actif }.publish(&env);
    }

    // ---------- démo PERSONNELLE (ne touche que la position de l'appelant) ----------

    /// Fixe le prix de démo de SA position : 0 < prix ≤ prix de référence (on ne peut que le baisser).
    pub fn fixer_prix_demo(env: Env, emprunteur: Address, prix: i128) -> Result<(), Erreur> {
        emprunteur.require_auth();
        if !demo_perso(&env) {
            return Err(Erreur::NonAutorise);
        }
        if prix <= 0 || prix > self::prix(&env) {
            return Err(Erreur::PrixInvalide);
        }
        let cle = Cle::PrixDemo(emprunteur.clone());
        env.storage().persistent().set(&cle, &prix);
        env.storage().persistent().extend_ttl(&cle, TTL_SEUIL, TTL_CIBLE);
        garder_en_vie(&env);
        PrixDemoFixe { emprunteur, prix }.publish(&env);
        Ok(())
    }

    /// Supprime le prix de démo de SA position (retour au prix de référence). Toujours permis.
    pub fn reinitialiser_prix_demo(env: Env, emprunteur: Address) {
        emprunteur.require_auth();
        env.storage().persistent().remove(&Cle::PrixDemo(emprunteur.clone()));
        garder_en_vie(&env);
        PrixDemoFixe { emprunteur, prix: 0 }.publish(&env);
    }

    /// Démo : ajoute à SA dette les intérêts de `secondes` au taux d'emprunt actuel.
    /// Ces intérêts ne passent pas par les index : taux du pool, prêteurs et autres emprunteurs inchangés.
    /// Remboursés, ils vont à la réserve du protocole.
    pub fn avancer_temps_perso(env: Env, emprunteur: Address, secondes: u64) -> Result<i128, Erreur> {
        emprunteur.require_auth();
        if !demo_perso(&env) {
            return Err(Erreur::NonAutorise);
        }
        if secondes == 0 || secondes > 10 * ANNEE {
            return Err(Erreur::MontantInvalide);
        }
        let e = actualiser(&env);
        let mut p = position(&env, &emprunteur);
        let dette = dette_totale(&p, e.index_emprunt);
        if dette == 0 {
            return Err(Erreur::PasDeDette);
        }
        let taux = taux_emprunt_bps(e.utilisation(), &reglages(&env));
        let interets = dette * taux * secondes as i128 / (BPS * ANNEE as i128);
        p.dette_demo += interets;
        ecrire_position(&env, &emprunteur, &p);
        garder_en_vie(&env);
        TempsPersoAvance { emprunteur, secondes, interets }.publish(&env);
        Ok(interets)
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
        if !sous_la_limite(dette_totale(&p, e.index_emprunt), p.garantie, prix_pour(&env, &emprunteur)) {
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
        let dette = dette_totale(&p, e.index_emprunt) + montant;
        if !sous_la_limite(dette, p.garantie, prix_pour(&env, &emprunteur)) {
            return Err(Erreur::GarantieInsuffisante);
        }
        let pret = jeton_pret(&env);
        let libre = caisse_libre(&env, e.reserve);
        if montant > libre {
            return Err(Erreur::CaisseVide);
        }
        let pl = plafonds(&env);
        if dette > pl.fixe || montant * BPS > libre * pl.caisse_bps {
            return Err(Erreur::PlafondDepasse);
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

    /// Léa rembourse tout ou partie de sa dette (intérêts compris).
    /// V2 : exactement `montant` est débité (une signature Soroban porte sur un montant précis, alors que la dette
    /// grandit entre la préparation et l'exécution) ; l'excédent éventuel est rendu immédiatement.
    pub fn rembourser(env: Env, emprunteur: Address, montant: i128) -> Result<i128, Erreur> {
        emprunteur.require_auth();
        positif(montant)?;
        let mut e = actualiser(&env);
        let mut p = position(&env, &emprunteur);
        let dette = dette_totale(&p, e.index_emprunt);
        if dette == 0 {
            return Err(Erreur::PasDeDette);
        }
        let paye = if montant > dette { dette } else { montant };
        let pret = jeton_pret(&env);
        pret.transfer(&emprunteur, &env.current_contract_address(), &montant);
        if montant > paye {
            pret.transfer(&env.current_contract_address(), &emprunteur, &(montant - paye));
        }
        let (vers_demo, brulees) = repartir_paiement(paye, &p, e.index_emprunt);
        p.dette_demo -= vers_demo;
        e.reserve += vers_demo;
        p.parts_dette -= brulees;
        e.parts_emprunt -= brulees;
        ecrire_position(&env, &emprunteur, &p);
        ecrire_etat(&env, &e);
        garder_en_vie(&env);
        Rembourse { emprunteur, montant: paye }.publish(&env);
        Ok(paye)
    }

    // ---------- le liquidateur ----------

    /// Si la dette (intérêts compris) dépasse 80 % de la valeur (au prix de la position) : le liquidateur
    /// rembourse au plus le montant liquidable et reçoit des actions valant ce montant + 5 %,
    /// dans la limite de la garantie.
    /// V2 : `montant` est débité EXACTEMENT (une signature Soroban porte sur un montant précis), puis l'excédent
    /// est rendu. L'appli envoie le montant lu avec `montant_liquidable` + une petite marge : la dette grandit de
    /// quelques unités entre la lecture et l'exécution ; la marge garantit le même chemin qu'à la simulation.
    pub fn liquider(env: Env, liquidateur: Address, emprunteur: Address, montant: i128) -> Result<i128, Erreur> {
        liquidateur.require_auth();
        positif(montant)?;
        let mut e = actualiser(&env);
        let mut p = position(&env, &emprunteur);
        let dette_totale = dette_totale(&p, e.index_emprunt);
        let px = prix_pour(&env, &emprunteur);
        let max = montant_liquidable_calc(dette_totale, p.garantie, px);
        if max == 0 {
            return Err(Erreur::PasLiquidable);
        }
        let paye = if montant > max { max } else { montant };
        let mut saisie = paye * (BPS + BONUS_LIQUIDATION_BPS) * UNITE / (BPS * px);
        // Si toute la garantie part, toute la dette doit être payée : sinon il resterait une dette sans garantie.
        if saisie >= p.garantie && paye < dette_totale {
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
        let (vers_demo, brulees) = repartir_paiement(paye, &p, e.index_emprunt);
        p.dette_demo -= vers_demo;
        e.reserve += vers_demo;
        p.parts_dette -= brulees;
        e.parts_emprunt -= brulees;
        p.garantie -= saisie;
        ecrire_position(&env, &emprunteur, &p);
        ecrire_etat(&env, &e);
        garder_en_vie(&env);
        jeton_garantie(&env).transfer(&env.current_contract_address(), &liquidateur, &saisie);
        Liquide { emprunteur, liquidateur, dette: paye, garantie_saisie: saisie }.publish(&env);
        Ok(saisie)
    }

    /// Montant qu'un liquidateur peut rembourser maintenant (0 si la position n'est pas liquidable).
    pub fn montant_liquidable(env: Env, emprunteur: Address) -> i128 {
        let e = calculer(&env);
        let p = position(&env, &emprunteur);
        montant_liquidable_calc(dette_totale(&p, e.index_emprunt), p.garantie, prix_pour(&env, &emprunteur))
    }

    // ---------- lectures (gratuites, intérêts calculés jusqu'à maintenant) ----------

    pub fn position(env: Env, emprunteur: Address) -> VuePosition {
        let e = calculer(&env);
        let p = position(&env, &emprunteur);
        let dette = dette_totale(&p, e.index_emprunt);
        let px = prix_pour(&env, &emprunteur);
        let v = valeur_a(p.garantie, px);
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
            liquidable: est_liquidable(dette, p.garantie, px),
            garantie: p.garantie,
            dette,
            dette_demo: p.dette_demo,
            prix: px,
            prix_demo_actif: px != prix(&env),
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
            demo_perso: demo_perso(&env),
            plafond_fixe: plafonds(&env).fixe,
            plafond_caisse_bps: plafonds(&env).caisse_bps,
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
