#![no_std]
//! UnlockShares : adaptateur de prix gratuit à deux témoins (modèle Agama « Oracle Adapter »).
//!
//! Analogie : deux témoins lisent le cours d'Apple chacun dans un journal différent.
//! Le registre n'écrit le prix que s'ils disent la même chose (à 1 % près).
//! - témoin « bourse »  : un robot qui lit Finnhub (cours de la Bourse de New York) ;
//! - témoin « continu » : un robot qui lit le prix oracle de Hyperliquid (24 h/24).
//!
//! Pendant la séance, il faut l'accord des deux. Hors séance (le témoin bourse se tait depuis
//! `silence_bourse_s`), le témoin continu peut mettre à jour seul, mais seulement à ±`ecart_hors_seance_bps`
//! du dernier prix CONFIRMÉ par les deux. Toute mise à jour respecte aussi : une bande absolue,
//! un délai minimum entre deux prix (en temps du ledger), et un saut maximum.
//!
//! Interface de lecture : SEP-40 (`lastprice`, `decimals`, `base`, `assets`…), la même que Reflector
//! et RedStone, pour pouvoir les brancher plus tard sans réécrire le contrat de prêt.
//! L'admin n'est jamais rapporteur : il ne peut que remplacer un rapporteur ou changer les réglages,
//! et chaque changement est un événement public.

use soroban_sdk::{contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, Symbol, Vec};

/// Décimales des prix (comme les jetons Stellar) : 1 dollar = 10_000_000.
pub const DECIMALES: u32 = 7;
const BPS: i128 = 10_000;
const JOUR: u32 = 17_280;
const TTL_SEUIL: u32 = 30 * JOUR;
const TTL_CIBLE: u32 = 60 * JOUR;

/// Actif SEP-40 (même forme que Reflector).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

/// Prix SEP-40 : valeur et date (secondes).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

/// Qui parle.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    /// Finnhub : la Bourse, seulement pendant la séance.
    Bourse,
    /// Hyperliquid : 24 h/24.
    Continu,
}

/// Les réglages de sécurité.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reglages {
    /// Écart maximum entre les deux témoins (100 = 1 %).
    pub tolerance_bps: i128,
    /// Les deux votes doivent dater de moins de ça (secondes).
    pub fenetre_s: u64,
    /// Saut maximum par rapport au dernier prix accepté (1500 = 15 %).
    pub saut_max_bps: i128,
    /// Hors séance : écart maximum par rapport au dernier prix confirmé (1000 = 10 %).
    pub ecart_hors_seance_bps: i128,
    /// La séance est considérée fermée si le témoin bourse se tait depuis ça (secondes).
    pub silence_bourse_s: u64,
    /// Délai minimum entre deux prix acceptés (secondes de ledger).
    pub intervalle_min_s: u64,
    /// Bande absolue : prix minimum et maximum acceptables.
    pub bande_min: i128,
    pub bande_max: i128,
}

/// Un vote en attente.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Vote {
    pub prix: i128,
    pub t: u64,
}

/// Résultat d'une soumission. On ne fait pas échouer la transaction quand un prix est refusé,
/// pour que le refus reste visible dans les événements (une transaction en erreur efface ses événements).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Resultat {
    EnAttente,
    Accepte(i128),
    Refuse(u32),
}

/// Codes de refus.
pub const REFUS_BANDE: u32 = 1;
pub const REFUS_DESACCORD: u32 = 2;
pub const REFUS_TROP_TOT: u32 = 3;
pub const REFUS_SAUT: u32 = 4;
pub const REFUS_HORS_SEANCE: u32 = 5;

#[contracttype]
#[derive(Clone)]
enum Cle {
    Admin,
    Actif,
    Reglages,
    Rapporteur(Role),
    Vote(Role),
    /// Dernier prix accepté (confirmé ou hors séance).
    Dernier,
    /// Dernier prix confirmé par les deux témoins.
    Confirme,
    /// Dernière fois que le témoin bourse a parlé.
    DerniereBourse,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Erreur {
    NonAutorise = 1,
    ReglagesInvalides = 2,
    AdminRapporteur = 3,
    PrixInvalide = 4,
}

#[contractevent]
pub struct VoteRecu { #[topic] pub role: Role, pub prix: i128 }
#[contractevent]
pub struct PrixAccepte { pub prix: i128, pub confirme: bool }
#[contractevent]
pub struct PrixRefuse { #[topic] pub role: Role, pub prix: i128, pub code: u32 }
#[contractevent]
pub struct RapporteurChange { #[topic] pub role: Role, pub adresse: Address }
#[contractevent]
pub struct ReglagesChanges { pub reglages: Reglages }

#[contract]
pub struct OraclePrix;

fn lire<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(env: &Env, cle: &Cle) -> V {
    env.storage().instance().get(cle).unwrap()
}

fn garder_en_vie(env: &Env) {
    env.storage().instance().extend_ttl(TTL_SEUIL, TTL_CIBLE);
}

fn admin(env: &Env) -> Address {
    lire(env, &Cle::Admin)
}

fn reglages(env: &Env) -> Reglages {
    lire(env, &Cle::Reglages)
}

fn valider(r: &Reglages) -> Result<(), Erreur> {
    let ok = r.tolerance_bps > 0 && r.tolerance_bps <= 1_000
        && r.saut_max_bps > 0 && r.saut_max_bps <= 5_000
        && r.ecart_hors_seance_bps > 0 && r.ecart_hors_seance_bps <= 5_000
        && r.fenetre_s > 0 && r.silence_bourse_s > 0
        && r.bande_min > 0 && r.bande_max > r.bande_min;
    if ok { Ok(()) } else { Err(Erreur::ReglagesInvalides) }
}

/// |a − b| ≤ tol × réf (en points de base), sans division.
fn proche(a: i128, b: i128, tol_bps: i128, reference: i128) -> bool {
    (a - b).abs() * BPS <= tol_bps * reference
}

#[contractimpl]
impl OraclePrix {
    /// `actif` : symbole suivi (par ex. AAPL). `prix_initial` : premier prix, fixé au déploiement et soumis à la bande.
    pub fn __constructor(
        env: Env,
        admin: Address,
        rapporteur_bourse: Address,
        rapporteur_continu: Address,
        actif: Symbol,
        prix_initial: i128,
        reglages: Reglages,
    ) {
        valider(&reglages).unwrap();
        if rapporteur_bourse == admin || rapporteur_continu == admin || rapporteur_bourse == rapporteur_continu {
            panic!("rapporteurs invalides");
        }
        if prix_initial < reglages.bande_min || prix_initial > reglages.bande_max {
            panic!("prix initial hors bande");
        }
        let s = env.storage().instance();
        let maintenant = env.ledger().timestamp();
        let p = PriceData { price: prix_initial, timestamp: maintenant };
        s.set(&Cle::Admin, &admin);
        s.set(&Cle::Actif, &actif);
        s.set(&Cle::Reglages, &reglages);
        s.set(&Cle::Rapporteur(Role::Bourse), &rapporteur_bourse);
        s.set(&Cle::Rapporteur(Role::Continu), &rapporteur_continu);
        s.set(&Cle::Dernier, &p);
        s.set(&Cle::Confirme, &p);
        garder_en_vie(&env);
    }

    // ---------- les témoins ----------

    /// Un rapporteur envoie le prix qu'il a lu. Le prix n'est enregistré que si les règles le permettent.
    pub fn soumettre(env: Env, rapporteur: Address, prix: i128) -> Result<Resultat, Erreur> {
        rapporteur.require_auth();
        let role = if rapporteur == lire::<Address>(&env, &Cle::Rapporteur(Role::Bourse)) {
            Role::Bourse
        } else if rapporteur == lire::<Address>(&env, &Cle::Rapporteur(Role::Continu)) {
            Role::Continu
        } else {
            return Err(Erreur::NonAutorise);
        };
        if prix <= 0 {
            return Err(Erreur::PrixInvalide);
        }
        let r = reglages(&env);
        let s = env.storage().instance();
        let maintenant = env.ledger().timestamp();
        garder_en_vie(&env);
        VoteRecu { role, prix }.publish(&env);

        let refuser = |code: u32| -> Result<Resultat, Erreur> {
            PrixRefuse { role, prix, code }.publish(&env);
            Ok(Resultat::Refuse(code))
        };

        if prix < r.bande_min || prix > r.bande_max {
            return refuser(REFUS_BANDE);
        }

        s.set(&Cle::Vote(role), &Vote { prix, t: maintenant });
        if role == Role::Bourse {
            s.set(&Cle::DerniereBourse, &maintenant);
        }

        let frais = |v: &Option<Vote>| v.as_ref().map_or(false, |v| maintenant - v.t <= r.fenetre_s);
        let vb: Option<Vote> = s.get(&Cle::Vote(Role::Bourse));
        let vc: Option<Vote> = s.get(&Cle::Vote(Role::Continu));
        let confirme: PriceData = lire(&env, &Cle::Confirme);

        // 1) Séance : les deux témoins ont parlé récemment.
        let (candidat, est_confirme) = if frais(&vb) && frais(&vc) {
            let (b, c) = (vb.unwrap().prix, vc.unwrap().prix);
            let moyenne = (b + c) / 2;
            // Les votes sont consommés dans tous les cas : un vote ne sert qu'une fois.
            s.remove(&Cle::Vote(Role::Bourse));
            s.remove(&Cle::Vote(Role::Continu));
            if !proche(b, c, r.tolerance_bps, moyenne) {
                return refuser(REFUS_DESACCORD);
            }
            (moyenne, true)
        } else {
            // 2) Hors séance : le témoin continu seul, si la Bourse se tait.
            let derniere_bourse: u64 = s.get(&Cle::DerniereBourse).unwrap_or(0);
            let bourse_muette = derniere_bourse == 0 || maintenant - derniere_bourse > r.silence_bourse_s;
            if role == Role::Continu && bourse_muette {
                s.remove(&Cle::Vote(Role::Continu));
                if !proche(prix, confirme.price, r.ecart_hors_seance_bps, confirme.price) {
                    return refuser(REFUS_HORS_SEANCE);
                }
                (prix, false)
            } else {
                return Ok(Resultat::EnAttente);
            }
        };

        // 3) Garde-fous communs, face au dernier prix accepté.
        let dernier: PriceData = lire(&env, &Cle::Dernier);
        if maintenant < dernier.timestamp + r.intervalle_min_s {
            return refuser(REFUS_TROP_TOT);
        }
        if !proche(candidat, dernier.price, r.saut_max_bps, dernier.price) {
            return refuser(REFUS_SAUT);
        }

        let p = PriceData { price: candidat, timestamp: maintenant };
        s.set(&Cle::Dernier, &p);
        if est_confirme {
            s.set(&Cle::Confirme, &p);
        }
        PrixAccepte { prix: candidat, confirme: est_confirme }.publish(&env);
        Ok(Resultat::Accepte(candidat))
    }

    // ---------- admin (jamais rapporteur) ----------

    pub fn changer_rapporteur(env: Env, role: Role, adresse: Address) -> Result<(), Erreur> {
        let a = admin(&env);
        a.require_auth();
        let autre = match role { Role::Bourse => Role::Continu, Role::Continu => Role::Bourse };
        if adresse == a || adresse == lire::<Address>(&env, &Cle::Rapporteur(autre)) {
            return Err(Erreur::AdminRapporteur);
        }
        env.storage().instance().set(&Cle::Rapporteur(role), &adresse);
        env.storage().instance().remove(&Cle::Vote(role));
        garder_en_vie(&env);
        RapporteurChange { role, adresse }.publish(&env);
        Ok(())
    }

    pub fn fixer_reglages(env: Env, reglages: Reglages) -> Result<(), Erreur> {
        admin(&env).require_auth();
        valider(&reglages)?;
        env.storage().instance().set(&Cle::Reglages, &reglages);
        garder_en_vie(&env);
        ReglagesChanges { reglages }.publish(&env);
        Ok(())
    }

    // ---------- lecture ----------

    pub fn reglages(env: Env) -> Reglages {
        reglages(&env)
    }

    pub fn rapporteur(env: Env, role: Role) -> Address {
        lire(&env, &Cle::Rapporteur(role))
    }

    /// Dernier prix confirmé par les deux témoins.
    pub fn dernier_confirme(env: Env) -> PriceData {
        lire(&env, &Cle::Confirme)
    }

    // ---------- interface SEP-40 ----------

    pub fn base(_env: Env) -> Asset {
        Asset::Other(Symbol::new(&_env, "USD"))
    }

    pub fn assets(env: Env) -> Vec<Asset> {
        Vec::from_array(&env, [Asset::Other(lire(&env, &Cle::Actif))])
    }

    pub fn decimals(_env: Env) -> u32 {
        DECIMALES
    }

    /// Pas de temps indicatif entre deux prix (secondes).
    pub fn resolution(env: Env) -> u32 {
        reglages(&env).intervalle_min_s as u32
    }

    pub fn lastprice(env: Env, asset: Asset) -> Option<PriceData> {
        if asset != Asset::Other(lire(&env, &Cle::Actif)) {
            return None;
        }
        Some(lire(&env, &Cle::Dernier))
    }

    /// Seul le dernier prix est conservé : renvoie un prix seulement pour sa date exacte.
    pub fn price(env: Env, asset: Asset, timestamp: u64) -> Option<PriceData> {
        Self::lastprice(env, asset).filter(|p| p.timestamp == timestamp)
    }
}

mod test;
