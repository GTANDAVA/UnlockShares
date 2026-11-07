#![no_std]
//! Robinet (faucet) de testnet : donne des tAAPL et des tUSDC à qui le demande.
//! Analogie : le distributeur de jetons à l'entrée d'une salle d'arcade.
//! Le robinet est l'admin des deux jetons (via leur SAC) : il peut donc
//! créer des jetons et autoriser un compte à détenir tAAPL (AUTH_REQUIRED).

use soroban_sdk::{contract, contracterror, contractevent, contractimpl, contracttype, token::StellarAssetClient, Address, Env};

const JOUR: u32 = 17_280;

#[contracttype]
#[derive(Clone)]
pub enum Cle {
    Admin,
    Action,
    Dollar,
    MontantAction,
    MontantDollar,
    Delai,
    Dernier(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Erreur {
    TropTot = 1,
}

#[contractevent]
pub struct Distribue { #[topic] pub a: Address, pub action: i128, pub dollar: i128 }

#[contract]
pub struct Robinet;

fn lire<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(env: &Env, cle: &Cle) -> V {
    env.storage().instance().get(cle).unwrap()
}

#[contractimpl]
impl Robinet {
    /// `delai` : secondes à attendre entre deux distributions pour une même adresse.
    pub fn __constructor(env: Env, admin: Address, action: Address, dollar: Address, montant_action: i128, montant_dollar: i128, delai: u64) {
        let s = env.storage().instance();
        s.set(&Cle::Admin, &admin);
        s.set(&Cle::Action, &action);
        s.set(&Cle::Dollar, &dollar);
        s.set(&Cle::MontantAction, &montant_action);
        s.set(&Cle::MontantDollar, &montant_dollar);
        s.set(&Cle::Delai, &delai);
        s.extend_ttl(30 * JOUR, 60 * JOUR);
    }

    /// Autorise `qui` à détenir tAAPL puis lui envoie des tAAPL et des tUSDC.
    /// Le compte doit déjà avoir ses deux trustlines (l'appli les crée avant).
    pub fn recevoir(env: Env, qui: Address) -> Result<(), Erreur> {
        qui.require_auth();
        let cle = Cle::Dernier(qui.clone());
        let maintenant = env.ledger().timestamp();
        let delai: u64 = lire(&env, &Cle::Delai);
        if let Some(dernier) = env.storage().temporary().get::<_, u64>(&cle) {
            if maintenant < dernier + delai {
                return Err(Erreur::TropTot);
            }
        }
        env.storage().temporary().set(&cle, &maintenant);
        env.storage().temporary().extend_ttl(&cle, JOUR, JOUR);
        env.storage().instance().extend_ttl(30 * JOUR, 60 * JOUR);

        let action = StellarAssetClient::new(&env, &lire::<Address>(&env, &Cle::Action));
        let dollar = StellarAssetClient::new(&env, &lire::<Address>(&env, &Cle::Dollar));
        let ma: i128 = lire(&env, &Cle::MontantAction);
        let md: i128 = lire(&env, &Cle::MontantDollar);
        action.set_authorized(&qui, &true);
        action.mint(&qui, &ma);
        dollar.mint(&qui, &md);
        Distribue { a: qui, action: ma, dollar: md }.publish(&env);
        Ok(())
    }

    /// Autorise une adresse (par ex. le contrat de prêt) à détenir tAAPL. Admin seulement.
    pub fn autoriser(env: Env, qui: Address) {
        let admin: Address = lire(&env, &Cle::Admin);
        admin.require_auth();
        StellarAssetClient::new(&env, &lire::<Address>(&env, &Cle::Action)).set_authorized(&qui, &true);
    }

    /// Envoie des jetons à une adresse précise (par ex. remplir la caisse au départ). Admin seulement.
    pub fn creer(env: Env, qui: Address, montant_action: i128, montant_dollar: i128) {
        let admin: Address = lire(&env, &Cle::Admin);
        admin.require_auth();
        if montant_action > 0 {
            let action = StellarAssetClient::new(&env, &lire::<Address>(&env, &Cle::Action));
            action.set_authorized(&qui, &true);
            action.mint(&qui, &montant_action);
        }
        if montant_dollar > 0 {
            StellarAssetClient::new(&env, &lire::<Address>(&env, &Cle::Dollar)).mint(&qui, &montant_dollar);
        }
    }

    /// Rend l'admin des jetons à un autre compte (par ex. pour remplacer le robinet). Admin seulement.
    pub fn rendre_admin(env: Env, nouvel_admin: Address) {
        let admin: Address = lire(&env, &Cle::Admin);
        admin.require_auth();
        StellarAssetClient::new(&env, &lire::<Address>(&env, &Cle::Action)).set_admin(&nouvel_admin);
        StellarAssetClient::new(&env, &lire::<Address>(&env, &Cle::Dollar)).set_admin(&nouvel_admin);
    }
}

mod test;
