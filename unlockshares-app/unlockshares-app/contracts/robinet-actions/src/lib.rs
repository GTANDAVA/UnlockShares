#![no_std]
//! Robinet multi-actions (testnet) : un « pack de bienvenue » de quelques titres en une signature (`recevoir`),
//! puis n'importe quel autre titre à la demande (`recevoir_titre`).
//! Analogie : le distributeur de jetons d'arcade, avec un tiroir par jeu ; le pack est le menu du jour.
//! Le robinet est l'admin de chaque jeton (via son SAC) : il crée les jetons et autorise les comptes
//! à les détenir (jetons AUTH_REQUIRED, comme le seraient de vraies actions).

use soroban_sdk::{contract, contracterror, contractevent, contractimpl, contracttype, token::StellarAssetClient, Address, Env, Map, Vec};

const JOUR: u32 = 17_280;
/// Nombre maximum de jetons distribués (un par spoke).
pub const JETONS_MAX: u32 = 12;

#[contracttype]
#[derive(Clone)]
pub enum Cle {
    Admin,
    /// Jeton → montant distribué par personne (0 = rien).
    Jetons,
    Delai,
    Dernier(Address),
    /// Jetons du pack de bienvenue (vide = tous les jetons distribués).
    Pack,
    /// Dernier passage d'une adresse pour un titre à la demande.
    DernierTitre(Address, Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Erreur {
    TropTot = 1,
    MontantInvalide = 2,
    TropDeJetons = 3,
    JetonInconnu = 4,
}

#[contractevent]
pub struct Distribue { #[topic] pub a: Address, pub jetons: u32 }

#[contract]
pub struct RobinetActions;

fn admin(env: &Env) -> Address {
    let a: Address = env.storage().instance().get(&Cle::Admin).unwrap();
    a.require_auth();
    a
}

fn jetons(env: &Env) -> Map<Address, i128> {
    env.storage().instance().get(&Cle::Jetons).unwrap_or(Map::new(env))
}

fn pack(env: &Env) -> Vec<Address> {
    env.storage().instance().get(&Cle::Pack).unwrap_or(Vec::new(env))
}

/// Refuse si `cle` a servi il y a moins de `delai` secondes, sinon note ce passage.
fn passage(env: &Env, cle: &Cle) -> Result<(), Erreur> {
    let maintenant = env.ledger().timestamp();
    let delai: u64 = env.storage().instance().get(&Cle::Delai).unwrap();
    if let Some(dernier) = env.storage().temporary().get::<_, u64>(cle) {
        if maintenant < dernier + delai {
            return Err(Erreur::TropTot);
        }
    }
    env.storage().temporary().set(cle, &maintenant);
    env.storage().temporary().extend_ttl(cle, JOUR, JOUR);
    Ok(())
}

fn donner(env: &Env, qui: &Address, jeton: &Address, montant: i128) {
    let sac = StellarAssetClient::new(env, jeton);
    sac.set_authorized(qui, &true);
    sac.mint(qui, &montant);
}

fn garder_en_vie(env: &Env) {
    env.storage().instance().extend_ttl(30 * JOUR, 60 * JOUR);
}

#[contractimpl]
impl RobinetActions {
    /// `delai` : secondes à attendre entre deux distributions pour une même adresse.
    pub fn __constructor(env: Env, admin: Address, delai: u64) {
        let s = env.storage().instance();
        s.set(&Cle::Admin, &admin);
        s.set(&Cle::Delai, &delai);
        s.set(&Cle::Jetons, &Map::<Address, i128>::new(&env));
        garder_en_vie(&env);
    }

    /// Pack de bienvenue : autorise `qui` à détenir chaque titre du pack et lui en envoie (tous les jetons
    /// si aucun pack n'est fixé). Les comptes classiques (G…) doivent déjà avoir leurs lignes de confiance
    /// (l'appli les crée avant) ; les comptes passkey (C…) n'en ont pas besoin. Un passage par délai.
    pub fn recevoir(env: Env, qui: Address) -> Result<(), Erreur> {
        qui.require_auth();
        passage(&env, &Cle::Dernier(qui.clone()))?;
        garder_en_vie(&env);
        let p = pack(&env);
        let mut n = 0;
        for (jeton, montant) in jetons(&env).iter() {
            if montant > 0 && (p.is_empty() || p.contains(&jeton)) {
                donner(&env, &qui, &jeton, montant);
                n += 1;
            }
        }
        Distribue { a: qui, jetons: n }.publish(&env);
        Ok(())
    }

    /// Un titre à la demande : envoie à `qui` le montant prévu de ce seul jeton.
    /// Un passage par délai et par titre (indépendant du pack).
    pub fn recevoir_titre(env: Env, qui: Address, jeton: Address) -> Result<(), Erreur> {
        qui.require_auth();
        let montant = jetons(&env).get(jeton.clone()).unwrap_or(0);
        if montant <= 0 {
            return Err(Erreur::JetonInconnu);
        }
        passage(&env, &Cle::DernierTitre(qui.clone(), jeton.clone()))?;
        garder_en_vie(&env);
        donner(&env, &qui, &jeton, montant);
        Distribue { a: qui, jetons: 1 }.publish(&env);
        Ok(())
    }

    /// Fixe les titres du pack de bienvenue (liste vide = tous). Chaque titre doit déjà être un jeton
    /// du robinet. Admin seulement.
    pub fn fixer_pack(env: Env, titres: Vec<Address>) -> Result<(), Erreur> {
        admin(&env);
        if titres.len() > JETONS_MAX {
            return Err(Erreur::TropDeJetons);
        }
        let j = jetons(&env);
        for t in titres.iter() {
            if !j.contains_key(t) {
                return Err(Erreur::JetonInconnu);
            }
        }
        env.storage().instance().set(&Cle::Pack, &titres);
        garder_en_vie(&env);
        Ok(())
    }

    /// Titres du pack de bienvenue (vide = tous).
    pub fn pack(env: Env) -> Vec<Address> {
        pack(&env)
    }

    /// Ajoute un jeton ou change son montant (0 = ne plus le distribuer). Admin seulement.
    /// Le robinet doit être l'admin du SAC de ce jeton.
    pub fn fixer_jeton(env: Env, jeton: Address, montant: i128) -> Result<(), Erreur> {
        admin(&env);
        if montant < 0 {
            return Err(Erreur::MontantInvalide);
        }
        let mut j = jetons(&env);
        if !j.contains_key(jeton.clone()) && j.len() >= JETONS_MAX {
            return Err(Erreur::TropDeJetons);
        }
        j.set(jeton, montant);
        env.storage().instance().set(&Cle::Jetons, &j);
        garder_en_vie(&env);
        Ok(())
    }

    /// Jetons distribués et montant par personne.
    pub fn jetons(env: Env) -> Map<Address, i128> {
        jetons(&env)
    }

    /// Autorise une adresse (par ex. le hub) à détenir TOUS les jetons du robinet. Admin seulement.
    pub fn autoriser(env: Env, qui: Address) {
        admin(&env);
        for (jeton, _) in jetons(&env).iter() {
            StellarAssetClient::new(&env, &jeton).set_authorized(&qui, &true);
        }
    }

    /// Crée des jetons pour une adresse précise (tests, démo). Admin seulement.
    pub fn creer(env: Env, qui: Address, jeton: Address, montant: i128) -> Result<(), Erreur> {
        admin(&env);
        if montant <= 0 {
            return Err(Erreur::MontantInvalide);
        }
        if !jetons(&env).contains_key(jeton.clone()) {
            return Err(Erreur::JetonInconnu);
        }
        donner(&env, &qui, &jeton, montant);
        Ok(())
    }

    /// Rend l'admin d'un jeton à un autre compte (pour remplacer le robinet). Admin seulement.
    pub fn rendre_admin(env: Env, jeton: Address, nouvel_admin: Address) {
        admin(&env);
        StellarAssetClient::new(&env, &jeton).set_admin(&nouvel_admin);
    }
}

mod test;
