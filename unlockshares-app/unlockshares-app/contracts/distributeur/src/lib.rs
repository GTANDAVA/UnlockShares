#![no_std]
//! Distributeur d'USDC (Circle) pour les testeurs d'UnlockShares.
//! Analogie : une tirelire publique. On ne peut pas IMPRIMER l'USDC (c'est Circle l'émetteur),
//! donc le contrat redistribue une réserve que l'admin remplit : X USDC par adresse, au plus une fois par délai.

use soroban_sdk::{contract, contracterror, contractevent, contractimpl, contracttype, token::TokenClient, Address, Env};

const JOUR: u32 = 17_280;

#[contracttype]
#[derive(Clone)]
pub enum Cle {
    Admin,
    Jeton,
    Montant,
    Delai,
    Dernier(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Erreur {
    /// Déjà servi récemment
    TropTot = 1,
    /// La réserve ne contient plus assez d'USDC
    ReserveVide = 2,
    /// Montant invalide
    MontantInvalide = 3,
}

#[contractevent]
pub struct Servi { #[topic] pub a: Address, pub montant: i128 }

#[contract]
pub struct Distributeur;

fn lire<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(env: &Env, cle: &Cle) -> V {
    env.storage().instance().get(cle).unwrap()
}

fn jeton(env: &Env) -> TokenClient<'_> {
    TokenClient::new(env, &lire::<Address>(env, &Cle::Jeton))
}

#[contractimpl]
impl Distributeur {
    pub fn __constructor(env: Env, admin: Address, jeton: Address, montant: i128, delai: u64) {
        let s = env.storage().instance();
        s.set(&Cle::Admin, &admin);
        s.set(&Cle::Jeton, &jeton);
        s.set(&Cle::Montant, &montant);
        s.set(&Cle::Delai, &delai);
        s.extend_ttl(30 * JOUR, 60 * JOUR);
    }

    /// Donne `montant` USDC à `qui` (une fois par délai). Pour la remplir, il suffit d'envoyer des USDC à l'adresse du contrat.
    pub fn recevoir(env: Env, qui: Address) -> Result<i128, Erreur> {
        qui.require_auth();
        let cle = Cle::Dernier(qui.clone());
        let maintenant = env.ledger().timestamp();
        let delai: u64 = lire(&env, &Cle::Delai);
        if let Some(dernier) = env.storage().temporary().get::<_, u64>(&cle) {
            if maintenant < dernier + delai {
                return Err(Erreur::TropTot);
            }
        }
        let montant: i128 = lire(&env, &Cle::Montant);
        let moi = env.current_contract_address();
        let j = jeton(&env);
        if j.balance(&moi) < montant {
            return Err(Erreur::ReserveVide);
        }
        env.storage().temporary().set(&cle, &maintenant);
        let ttl = (delai / 5) as u32 + JOUR; // ~5 s par ledger : on garde la trace un peu plus longtemps que le délai
        env.storage().temporary().extend_ttl(&cle, ttl, ttl);
        env.storage().instance().extend_ttl(30 * JOUR, 60 * JOUR);
        j.transfer(&moi, &qui, &montant);
        Servi { a: qui, montant }.publish(&env);
        Ok(montant)
    }

    /// USDC encore disponibles dans la réserve
    pub fn reserve(env: Env) -> i128 {
        jeton(&env).balance(&env.current_contract_address())
    }

    /// Montant donné par personne
    pub fn montant(env: Env) -> i128 {
        lire(&env, &Cle::Montant)
    }

    /// Change le montant par personne. Admin seulement.
    pub fn fixer_montant(env: Env, montant: i128) -> Result<(), Erreur> {
        lire::<Address>(&env, &Cle::Admin).require_auth();
        if montant <= 0 {
            return Err(Erreur::MontantInvalide);
        }
        env.storage().instance().set(&Cle::Montant, &montant);
        Ok(())
    }

    /// Récupère des USDC de la réserve (par ex. pour remplir le pool). Admin seulement.
    pub fn retirer(env: Env, montant: i128) -> Result<(), Erreur> {
        let admin: Address = lire(&env, &Cle::Admin);
        admin.require_auth();
        if montant <= 0 {
            return Err(Erreur::MontantInvalide);
        }
        jeton(&env).transfer(&env.current_contract_address(), &admin, &montant);
        Ok(())
    }
}

mod test;
