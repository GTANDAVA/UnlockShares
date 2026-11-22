#![no_std]
//! Règle « gardien » pour un compte passkey (compte intelligent OpenZeppelin stellar-accounts v0.8).
//!
//! Analogie : un badge d'accès qui n'ouvre qu'une porte. Le compte de l'utilisateur ajoute une 2e clé
//! (celle du robot gardien) dans une règle « Default » protégée par ce contrat. Avec cette clé, on peut
//! SEULEMENT rembourser sa propre dette au hub, avec au plus `plafond` USDC par période.
//! Tout le reste est refusé : emprunter, retirer des actions, envoyer des USDC ailleurs, créer un contrat.
//!
//! Le compte appelle `enforce` pour chaque « contexte » d'une autorisation : un remboursement en produit 2
//! (hub.rembourser, puis usdc.transfer(compte → hub) à l'intérieur).
//!
//! Pire cas si la clé du gardien est volée : le voleur ne peut que rembourser la dette de l'utilisateur
//! (ou, au pire, verser au hub au plus `plafond` USDC par période). Il ne peut rien recevoir.

use soroban_sdk::{
    auth::{Context, ContractContext},
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, symbol_short,
    Address, Env, FromVal, Symbol, TryFromVal, Val, Vec,
};
use stellar_accounts::smart_account::{ContextRule, ContextRuleType, Signer};

const JOUR: u32 = 17_280;
const TTL_SEUIL: u32 = 30 * JOUR;
const TTL_CIBLE: u32 = 60 * JOUR;

/// Réglages choisis par l'utilisateur à l'activation (paramètres d'installation de la règle).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reglages {
    /// Le hub UnlockShares : seul contrat où le gardien peut agir.
    pub hub: Address,
    /// Le jeton prêté (USDC) : seul jeton que le gardien peut verser, et seulement au hub.
    pub usdc: Address,
    /// Montant maximum versé par période (unités du jeton, 7 décimales).
    pub plafond: i128,
    /// Durée de la période, en ledgers (17 280 ≈ 1 jour).
    pub periode: u32,
}

/// État par (compte, règle) : réglages + dépenses de la période en cours.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Etat {
    pub reglages: Reglages,
    /// Ledger où la période en cours a commencé.
    pub debut: u32,
    /// Total versé depuis `debut`.
    pub depense: i128,
}

#[contracttype]
#[derive(Clone)]
enum Cle {
    Etat(Address, u32),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Erreur {
    /// Geste non autorisé pour le gardien.
    Interdit = 1,
    /// Le plafond de la période serait dépassé.
    PlafondDepasse = 2,
    /// Règle déjà installée pour ce compte.
    DejaInstalle = 3,
    /// Règle pas installée pour ce compte.
    PasInstalle = 4,
    /// Réglages invalides (plafond ou période nuls).
    ReglagesInvalides = 5,
    /// La clé du gardien n'a pas signé.
    PasSigne = 6,
    /// Montant invalide.
    MontantInvalide = 7,
}

#[contractevent]
pub struct GardienActive { #[topic] pub compte: Address, pub regle: u32, pub reglages: Reglages }
#[contractevent]
pub struct GardienRetire { #[topic] pub compte: Address, pub regle: u32 }
#[contractevent]
pub struct GardienVerse { #[topic] pub compte: Address, pub montant: i128, pub depense_periode: i128 }

fn cle(compte: &Address, regle: u32) -> Cle {
    Cle::Etat(compte.clone(), regle)
}

fn lire(e: &Env, compte: &Address, regle: u32) -> Etat {
    let k = cle(compte, regle);
    let etat: Etat = e.storage().persistent().get(&k).unwrap_or_else(|| panic_with_error!(e, Erreur::PasInstalle));
    e.storage().persistent().extend_ttl(&k, TTL_SEUIL, TTL_CIBLE);
    etat
}

fn arg<T: TryFromVal<Env, Val>>(e: &Env, args: &Vec<Val>, i: u32) -> T {
    let v = args.get(i).unwrap_or_else(|| panic_with_error!(e, Erreur::Interdit));
    T::try_from_val(e, &v).unwrap_or_else(|_| panic_with_error!(e, Erreur::Interdit))
}

#[contract]
pub struct Gardien;

#[contractimpl]
impl Gardien {
    /// Appelé par le compte quand l'utilisateur active le gardien (ajout de la règle).
    pub fn install(e: Env, install_params: Val, context_rule: ContextRule, smart_account: Address) {
        smart_account.require_auth();
        // Règle « Default » : elle doit couvrir le hub ET le jeton USDC (2 contrats) ; c'est ce contrat qui filtre.
        if context_rule.context_type != ContextRuleType::Default {
            panic_with_error!(&e, Erreur::Interdit)
        }
        let reglages = Reglages::from_val(&e, &install_params);
        if reglages.plafond <= 0 || reglages.periode == 0 {
            panic_with_error!(&e, Erreur::ReglagesInvalides)
        }
        let k = cle(&smart_account, context_rule.id);
        if e.storage().persistent().has(&k) {
            panic_with_error!(&e, Erreur::DejaInstalle)
        }
        let etat = Etat { reglages: reglages.clone(), debut: e.ledger().sequence(), depense: 0 };
        e.storage().persistent().set(&k, &etat);
        e.storage().persistent().extend_ttl(&k, TTL_SEUIL, TTL_CIBLE);
        GardienActive { compte: smart_account, regle: context_rule.id, reglages }.publish(&e);
    }

    /// Appelé par le compte quand l'utilisateur désactive le gardien.
    pub fn uninstall(e: Env, context_rule: ContextRule, smart_account: Address) {
        smart_account.require_auth();
        let k = cle(&smart_account, context_rule.id);
        if !e.storage().persistent().has(&k) {
            panic_with_error!(&e, Erreur::PasInstalle)
        }
        e.storage().persistent().remove(&k);
        GardienRetire { compte: smart_account, regle: context_rule.id }.publish(&e);
    }

    /// Appelé par le compte pour chaque contexte signé avec la clé du gardien. Panique = refus.
    pub fn enforce(e: Env, context: Context, authenticated_signers: Vec<Signer>, context_rule: ContextRule, smart_account: Address) {
        smart_account.require_auth();
        // Avec une politique, le compte ne vérifie pas lui-même les signatures : on exige que TOUTES
        // les clés de la règle (la clé du gardien) aient signé.
        if context_rule.signers.is_empty() || authenticated_signers.len() != context_rule.signers.len() {
            panic_with_error!(&e, Erreur::PasSigne)
        }
        for s in context_rule.signers.iter() {
            if !authenticated_signers.contains(&s) {
                panic_with_error!(&e, Erreur::PasSigne)
            }
        }
        let mut etat = lire(&e, &smart_account, context_rule.id);
        let Context::Contract(ContractContext { contract, fn_name, args }) = context else {
            panic_with_error!(&e, Erreur::Interdit)
        };
        let r = &etat.reglages;
        // 1) hub.rembourser(emprunteur = ce compte, …) : seule fonction du hub permise.
        if contract == r.hub {
            if fn_name != Symbol::new(&e, "rembourser") {
                panic_with_error!(&e, Erreur::Interdit)
            }
            let emprunteur: Address = arg(&e, &args, 0);
            if emprunteur != smart_account {
                panic_with_error!(&e, Erreur::Interdit)
            }
            return;
        }
        // 2) usdc.transfer(ce compte → hub, montant) : le versement fait par rembourser, plafonné par période.
        if contract == r.usdc && fn_name == symbol_short!("transfer") {
            let de: Address = arg(&e, &args, 0);
            let vers: Address = arg(&e, &args, 1);
            let montant: i128 = arg(&e, &args, 2);
            if de != smart_account || vers != r.hub {
                panic_with_error!(&e, Erreur::Interdit)
            }
            if montant <= 0 {
                panic_with_error!(&e, Erreur::MontantInvalide)
            }
            let maintenant = e.ledger().sequence();
            if maintenant >= etat.debut.saturating_add(r.periode) {
                etat.debut = maintenant;
                etat.depense = 0;
            }
            if etat.depense + montant > r.plafond {
                panic_with_error!(&e, Erreur::PlafondDepasse)
            }
            etat.depense += montant;
            let k = cle(&smart_account, context_rule.id);
            e.storage().persistent().set(&k, &etat);
            GardienVerse { compte: smart_account, montant, depense_periode: etat.depense }.publish(&e);
            return;
        }
        // 3) Tout le reste : refusé.
        panic_with_error!(&e, Erreur::Interdit)
    }

    /// Lecture : réglages et dépenses de la période (pour le site et le robot).
    pub fn etat(e: Env, smart_account: Address, regle: u32) -> Option<Etat> {
        e.storage().persistent().get(&cle(&smart_account, regle))
    }
}

#[cfg(test)]
mod test;
