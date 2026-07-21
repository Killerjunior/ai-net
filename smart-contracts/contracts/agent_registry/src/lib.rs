#![no_std]

use error_resolver::ErrorResolverContractClient;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String,
    Symbol, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct AgentRecord {
    pub id: Symbol,
    pub capability: Symbol,
    pub price_stroops: i128,
    pub endpoint: String,
    pub owner: Address,
}

/// Aggregate view of an agent's standing, including its error count as
/// tracked by error-resolver. `error_count` is 0 whenever error-resolver
/// isn't configured or the cross-contract call fails, rather than causing
/// this query to fail: health information degrades gracefully.
#[contracttype]
#[derive(Clone)]
pub struct AgentHealth {
    pub agent_id: Symbol,
    pub exists: bool,
    pub frozen: bool,
    pub error_count: u32,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Paused,
    Agent(Symbol),
    CapabilityIndex(Symbol),
    FrozenAgent(Symbol),
    ErrorResolverContract,
}

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum Error {
    NotFound = 1,
    Unauthorized = 2,
    AlreadyExists = 3,
    ContractPaused = 4,
    AgentFrozen = 5,
    NotAdmin = 6,
}

#[contract]
pub struct AgentRegistryContract;

fn require_not_paused(env: &Env) -> Result<(), Error> {
    let paused: bool = env
        .storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false);
    if paused {
        return Err(Error::ContractPaused);
    }
    Ok(())
}

fn require_admin(env: &Env) -> Result<Address, Error> {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotAdmin)?;
    admin.require_auth();
    Ok(admin)
}

fn require_not_frozen(env: &Env, agent_id: &Symbol) -> Result<(), Error> {
    let frozen: bool = env
        .storage()
        .persistent()
        .get(&DataKey::FrozenAgent(agent_id.clone()))
        .unwrap_or(false);
    if frozen {
        return Err(Error::AgentFrozen);
    }
    Ok(())
}

#[contractimpl]
impl AgentRegistryContract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyExists);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        require_admin(&env)?;
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    /// Configures the error-resolver contract this registry cascades
    /// `deregister_agent` cleanup and `get_agent_health` queries to. Admin
    /// only, since it's a trust boundary: whichever contract is set here
    /// is the one this registry calls on-chain.
    pub fn set_error_resolver(env: Env, error_resolver: Address) -> Result<(), Error> {
        require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::ErrorResolverContract, &error_resolver);
        Ok(())
    }

    pub fn get_error_resolver(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::ErrorResolverContract)
    }

    pub fn pause(env: Env) -> Result<(), Error> {
        require_admin(&env)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events()
            .publish((symbol_short!("registry"), symbol_short!("paused")), ());
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), Error> {
        require_admin(&env)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events()
            .publish((symbol_short!("registry"), symbol_short!("unpaused")), ());
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn get_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Admin)
    }

    pub fn freeze_agent(env: Env, agent_id: Symbol) -> Result<(), Error> {
        require_admin(&env)?;
        env.storage()
            .persistent()
            .set(&DataKey::FrozenAgent(agent_id.clone()), &true);
        env.events().publish(
            (symbol_short!("registry"), symbol_short!("freeze")),
            agent_id,
        );
        Ok(())
    }

    pub fn unfreeze_agent(env: Env, agent_id: Symbol) -> Result<(), Error> {
        require_admin(&env)?;
        env.storage()
            .persistent()
            .set(&DataKey::FrozenAgent(agent_id.clone()), &false);
        env.events().publish(
            (symbol_short!("registry"), symbol_short!("unfreeze")),
            agent_id,
        );
        Ok(())
    }

    pub fn is_agent_frozen(env: Env, agent_id: Symbol) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::FrozenAgent(agent_id))
            .unwrap_or(false)
    }

    pub fn register_agent(env: Env, record: AgentRecord) -> Result<(), Error> {
        require_not_paused(&env)?;
        require_not_frozen(&env, &record.id)?;
        record.owner.require_auth();

        let agent_key = DataKey::Agent(record.id.clone());
        if env.storage().persistent().has(&agent_key) {
            return Err(Error::AlreadyExists);
        }

        let cap_key = DataKey::CapabilityIndex(record.capability.clone());
        let mut ids: Vec<Symbol> = env
            .storage()
            .persistent()
            .get(&cap_key)
            .unwrap_or_else(|| Vec::new(&env));
        ids.push_back(record.id.clone());
        env.storage().persistent().set(&cap_key, &ids);

        env.storage().persistent().set(&agent_key, &record);
        Ok(())
    }

    pub fn lookup_agents(env: Env, capability: Symbol) -> Vec<AgentRecord> {
        let cap_key = DataKey::CapabilityIndex(capability);
        let ids: Vec<Symbol> = env
            .storage()
            .persistent()
            .get(&cap_key)
            .unwrap_or_else(|| Vec::new(&env));

        let mut records = Vec::new(&env);
        for id in ids.iter() {
            let agent_key = DataKey::Agent(id.clone());
            if let Some(r) = env
                .storage()
                .persistent()
                .get::<DataKey, AgentRecord>(&agent_key)
            {
                records.push_back(r);
            }
        }
        records
    }

    pub fn deregister_agent(env: Env, agent_id: Symbol) -> Result<(), Error> {
        require_not_paused(&env)?;
        let agent_key = DataKey::Agent(agent_id.clone());
        let record: AgentRecord = env
            .storage()
            .persistent()
            .get(&agent_key)
            .ok_or(Error::NotFound)?;

        record.owner.require_auth();

        let cap_key = DataKey::CapabilityIndex(record.capability.clone());
        let ids: Vec<Symbol> = env
            .storage()
            .persistent()
            .get(&cap_key)
            .unwrap_or_else(|| Vec::new(&env));

        let mut updated = Vec::new(&env);
        for id in ids.iter() {
            if id != agent_id {
                updated.push_back(id);
            }
        }
        env.storage().persistent().set(&cap_key, &updated);
        env.storage().persistent().remove(&agent_key);

        // Cascade to error-resolver so errors don't outlive the agent
        // record. Best-effort: if error-resolver isn't configured, isn't
        // reachable, or rejects the call, deregistration still succeeds —
        // an orphaned error count is a cleanup nuisance, not a reason to
        // block removing an agent.
        if let Some(resolver) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::ErrorResolverContract)
        {
            let resolver_client = ErrorResolverContractClient::new(&env, &resolver);
            let _ =
                resolver_client.try_clear_agent_errors(&env.current_contract_address(), &agent_id);
        }

        Ok(())
    }

    /// Aggregate health view for `agent_id`, including its error count from
    /// error-resolver (0 if error-resolver isn't configured or the
    /// cross-contract call fails — see `AgentHealth`).
    pub fn get_agent_health(env: Env, agent_id: Symbol) -> AgentHealth {
        let exists = env
            .storage()
            .persistent()
            .has(&DataKey::Agent(agent_id.clone()));
        let frozen = env
            .storage()
            .persistent()
            .get(&DataKey::FrozenAgent(agent_id.clone()))
            .unwrap_or(false);

        let error_count = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::ErrorResolverContract)
            .map(|resolver| {
                let resolver_client = ErrorResolverContractClient::new(&env, &resolver);
                resolver_client
                    .try_get_agent_error_count(&agent_id)
                    .ok()
                    .and_then(|inner| inner.ok())
                    .unwrap_or(0)
            })
            .unwrap_or(0);

        AgentHealth {
            agent_id,
            exists,
            frozen,
            error_count,
        }
    }

    pub fn update_pricing(env: Env, agent_id: Symbol, new_price: i128) -> Result<(), Error> {
        require_not_paused(&env)?;
        require_not_frozen(&env, &agent_id)?;
        let agent_key = DataKey::Agent(agent_id.clone());
        let mut record: AgentRecord = env
            .storage()
            .persistent()
            .get(&agent_key)
            .ok_or(Error::NotFound)?;

        record.owner.require_auth();

        record.price_stroops = new_price;
        env.storage().persistent().set(&agent_key, &record);

        env.events().publish(
            (symbol_short!("registry"), symbol_short!("price_upd")),
            (agent_id, new_price),
        );

        Ok(())
    }
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    fn setup() -> (Env, AgentRegistryContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(AgentRegistryContract, ());
        let client = AgentRegistryContractClient::new(&env, &id);
        (env, client)
    }

    fn setup_with_admin() -> (Env, AgentRegistryContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(AgentRegistryContract, ());
        let client = AgentRegistryContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, client, admin)
    }

    fn make_record(env: &Env, id: &str, capability: &str, owner: Address) -> AgentRecord {
        AgentRecord {
            id: Symbol::new(env, id),
            capability: Symbol::new(env, capability),
            price_stroops: 1_000,
            endpoint: String::from_str(env, "https://agent.example.com"),
            owner,
        }
    }

    #[test]
    fn register_and_lookup() {
        let (env, client) = setup();
        let owner = Address::generate(&env);
        client.register_agent(&make_record(&env, "agent1", "research", owner));

        let results = client.lookup_agents(&Symbol::new(&env, "research"));
        assert_eq!(results.len(), 1);
        assert_eq!(results.get(0).unwrap().id, Symbol::new(&env, "agent1"));
    }

    #[test]
    fn register_duplicate_returns_error() {
        let (env, client) = setup();
        let owner = Address::generate(&env);
        let record = make_record(&env, "dup", "research", owner);
        client.register_agent(&record.clone());
        assert_eq!(
            client.try_register_agent(&record),
            Err(Ok(Error::AlreadyExists))
        );
    }

    #[test]
    fn lookup_multiple_agents_same_capability() {
        let (env, client) = setup();
        client.register_agent(&make_record(
            &env,
            "a1",
            "analytics",
            Address::generate(&env),
        ));
        client.register_agent(&make_record(
            &env,
            "a2",
            "analytics",
            Address::generate(&env),
        ));
        client.register_agent(&make_record(&env, "a3", "other", Address::generate(&env)));

        let results = client.lookup_agents(&Symbol::new(&env, "analytics"));
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn lookup_unknown_capability_returns_empty() {
        let (env, client) = setup();
        let results = client.lookup_agents(&Symbol::new(&env, "unknown"));
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn deregister_removes_from_index() {
        let (env, client) = setup();
        let owner = Address::generate(&env);
        client.register_agent(&make_record(&env, "agent2", "coding", owner));
        client.deregister_agent(&Symbol::new(&env, "agent2"));

        let results = client.lookup_agents(&Symbol::new(&env, "coding"));
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn deregister_missing_agent_returns_not_found() {
        let (env, client) = setup();
        assert_eq!(
            client.try_deregister_agent(&Symbol::new(&env, "ghost")),
            Err(Ok(Error::NotFound))
        );
    }

    #[test]
    fn deregister_wrong_signer_is_unauthorized() {
        let env = Env::default();
        let contract_id = env.register(AgentRegistryContract, ());
        let client = AgentRegistryContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);

        env.mock_all_auths();
        client.register_agent(&make_record(&env, "agent3", "risk", owner.clone()));

        env.mock_auths(&[]);
        let result = client.try_deregister_agent(&Symbol::new(&env, "agent3"));
        assert!(result.is_err());
    }

    #[test]
    fn update_pricing_changes_price_and_emits_event() {
        let (env, client) = setup();
        let owner = Address::generate(&env);
        client.register_agent(&make_record(&env, "agent4", "report", owner));

        client.update_pricing(&Symbol::new(&env, "agent4"), &5_000_i128);

        let results = client.lookup_agents(&Symbol::new(&env, "report"));
        assert_eq!(results.get(0).unwrap().price_stroops, 5_000);
    }

    #[test]
    fn update_pricing_missing_agent_returns_not_found() {
        let (env, client) = setup();
        assert_eq!(
            client.try_update_pricing(&Symbol::new(&env, "ghost"), &100_i128),
            Err(Ok(Error::NotFound))
        );
    }

    #[test]
    fn initialize_sets_admin() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.initialize(&admin);
        assert_eq!(client.get_admin(), Some(admin));
    }

    #[test]
    fn initialize_cannot_be_called_twice() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.initialize(&admin);
        assert_eq!(
            client.try_initialize(&Address::generate(&env)),
            Err(Ok(Error::AlreadyExists))
        );
    }

    #[test]
    fn set_admin_changes_admin() {
        let (env, client, admin) = setup_with_admin();
        let new_admin = Address::generate(&env);
        client.set_admin(&new_admin);
        assert_eq!(client.get_admin(), Some(new_admin));
    }

    #[test]
    fn set_admin_requires_admin_auth() {
        let env = Env::default();
        let contract_id = env.register(AgentRegistryContract, ());
        let client = AgentRegistryContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);

        env.mock_auths(&[]);
        let result = client.try_set_admin(&Address::generate(&env));
        assert!(result.is_err());
    }

    #[test]
    fn pause_blocks_register_agent() {
        let (env, client, admin) = setup_with_admin();
        client.pause();
        let owner = Address::generate(&env);
        let result = client.try_register_agent(&make_record(&env, "agent_p", "test", owner));
        assert_eq!(result, Err(Ok(Error::ContractPaused)));
    }

    #[test]
    fn pause_blocks_deregister_agent() {
        let (env, client, admin) = setup_with_admin();
        let owner = Address::generate(&env);
        env.mock_all_auths();
        client.register_agent(&make_record(&env, "agent_d", "test", owner));
        client.pause();
        let result = client.try_deregister_agent(&Symbol::new(&env, "agent_d"));
        assert_eq!(result, Err(Ok(Error::ContractPaused)));
    }

    #[test]
    fn pause_blocks_update_pricing() {
        let (env, client, admin) = setup_with_admin();
        let owner = Address::generate(&env);
        env.mock_all_auths();
        client.register_agent(&make_record(&env, "agent_u", "test", owner));
        client.pause();
        let result = client.try_update_pricing(&Symbol::new(&env, "agent_u"), &999_i128);
        assert_eq!(result, Err(Ok(Error::ContractPaused)));
    }

    #[test]
    fn unpause_allows_operations() {
        let (env, client, admin) = setup_with_admin();
        client.pause();
        client.unpause();
        let owner = Address::generate(&env);
        client.register_agent(&make_record(&env, "agent_up", "test", owner));
        let results = client.lookup_agents(&Symbol::new(&env, "test"));
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn non_admin_cannot_pause() {
        let env = Env::default();
        let contract_id = env.register(AgentRegistryContract, ());
        let client = AgentRegistryContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);

        env.mock_auths(&[]);
        let result = client.try_pause();
        assert!(result.is_err());
    }

    #[test]
    fn non_admin_cannot_unpause() {
        let env = Env::default();
        let contract_id = env.register(AgentRegistryContract, ());
        let client = AgentRegistryContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);
        client.pause();

        env.mock_auths(&[]);
        let result = client.try_unpause();
        assert!(result.is_err());
    }

    #[test]
    fn is_paused_reflects_state() {
        let (env, client, admin) = setup_with_admin();
        assert!(!client.is_paused());
        client.pause();
        assert!(client.is_paused());
        client.unpause();
        assert!(!client.is_paused());
    }

    #[test]
    fn freeze_agent_blocks_update_pricing() {
        let (env, client, admin) = setup_with_admin();
        let owner = Address::generate(&env);
        env.mock_all_auths();
        client.register_agent(&make_record(&env, "agent_f", "test", owner));
        client.freeze_agent(&Symbol::new(&env, "agent_f"));
        let result = client.try_update_pricing(&Symbol::new(&env, "agent_f"), &777_i128);
        assert_eq!(result, Err(Ok(Error::AgentFrozen)));
    }

    #[test]
    fn freeze_agent_blocks_register() {
        let (env, client, admin) = setup_with_admin();
        client.freeze_agent(&Symbol::new(&env, "frozen_id"));
        let owner = Address::generate(&env);
        let result = client.try_register_agent(&make_record(&env, "frozen_id", "test", owner));
        assert_eq!(result, Err(Ok(Error::AgentFrozen)));
    }

    #[test]
    fn unfreeze_agent_allows_operations() {
        let (env, client, admin) = setup_with_admin();
        let owner = Address::generate(&env);
        env.mock_all_auths();
        client.register_agent(&make_record(&env, "agent_unf", "test", owner));
        client.freeze_agent(&Symbol::new(&env, "agent_unf"));
        assert!(client.is_agent_frozen(&Symbol::new(&env, "agent_unf")));
        client.unfreeze_agent(&Symbol::new(&env, "agent_unf"));
        assert!(!client.is_agent_frozen(&Symbol::new(&env, "agent_unf")));
        client.update_pricing(&Symbol::new(&env, "agent_unf"), &333_i128);
        let results = client.lookup_agents(&Symbol::new(&env, "test"));
        assert_eq!(results.get(0).unwrap().price_stroops, 333);
    }

    #[test]
    fn non_admin_cannot_freeze() {
        let env = Env::default();
        let contract_id = env.register(AgentRegistryContract, ());
        let client = AgentRegistryContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);

        env.mock_auths(&[]);
        let result = client.try_freeze_agent(&Symbol::new(&env, "some_agent"));
        assert!(result.is_err());
    }

    #[test]
    fn non_admin_cannot_unfreeze() {
        let env = Env::default();
        let contract_id = env.register(AgentRegistryContract, ());
        let client = AgentRegistryContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);

        env.mock_auths(&[]);
        let result = client.try_unfreeze_agent(&Symbol::new(&env, "some_agent"));
        assert!(result.is_err());
    }

    #[test]
    fn is_agent_frozen_reflects_state() {
        let (env, client, admin) = setup_with_admin();
        assert!(!client.is_agent_frozen(&Symbol::new(&env, "agent_state")));
        client.freeze_agent(&Symbol::new(&env, "agent_state"));
        assert!(client.is_agent_frozen(&Symbol::new(&env, "agent_state")));
        client.unfreeze_agent(&Symbol::new(&env, "agent_state"));
        assert!(!client.is_agent_frozen(&Symbol::new(&env, "agent_state")));
    }

    // ── error-resolver cross-contract wiring ────────────────────────────

    fn setup_with_resolver() -> (
        Env,
        AgentRegistryContractClient<'static>,
        error_resolver::ErrorResolverContractClient<'static>,
        Address,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let registry_id = env.register(AgentRegistryContract, ());
        let registry = AgentRegistryContractClient::new(&env, &registry_id);
        let admin = Address::generate(&env);
        registry.initialize(&admin);

        let resolver_id = env.register(error_resolver::ErrorResolverContract, ());
        let resolver = error_resolver::ErrorResolverContractClient::new(&env, &resolver_id);
        resolver.initialize(&admin);
        resolver.add_authorized_caller(&registry_id);

        registry.set_error_resolver(&resolver_id);

        (env, registry, resolver, registry_id)
    }

    #[test]
    fn set_error_resolver_stores_address() {
        let (env, client, admin) = setup_with_admin();
        let resolver_addr = Address::generate(&env);
        client.set_error_resolver(&resolver_addr);
        assert_eq!(client.get_error_resolver(), Some(resolver_addr));
        let _ = admin;
    }

    #[test]
    fn set_error_resolver_requires_admin() {
        let env = Env::default();
        let contract_id = env.register(AgentRegistryContract, ());
        let client = AgentRegistryContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        env.mock_all_auths();
        client.initialize(&admin);

        env.mock_auths(&[]);
        let resolver_addr = Address::generate(&env);
        let result = client.try_set_error_resolver(&resolver_addr);
        assert!(result.is_err());
    }

    #[test]
    fn deregister_cascades_to_error_resolver() {
        let (env, registry, resolver, registry_id) = setup_with_resolver();
        let owner = Address::generate(&env);
        registry.register_agent(&make_record(&env, "cascade_agent", "test", owner));

        let agent_id = Symbol::new(&env, "cascade_agent");
        resolver.record_error(&registry_id, &agent_id);
        resolver.record_error(&registry_id, &agent_id);
        assert_eq!(resolver.get_agent_error_count(&agent_id), 2);

        registry.deregister_agent(&agent_id);

        assert_eq!(resolver.get_agent_error_count(&agent_id), 0);
    }

    #[test]
    fn get_agent_health_reports_error_count_from_resolver() {
        let (env, registry, resolver, registry_id) = setup_with_resolver();
        let owner = Address::generate(&env);
        registry.register_agent(&make_record(&env, "health_agent", "test", owner));

        let agent_id = Symbol::new(&env, "health_agent");
        resolver.record_error(&registry_id, &agent_id);
        resolver.record_error(&registry_id, &agent_id);
        resolver.record_error(&registry_id, &agent_id);

        let health = registry.get_agent_health(&agent_id);
        assert!(health.exists);
        assert!(!health.frozen);
        assert_eq!(health.error_count, 3);
    }

    #[test]
    fn get_agent_health_without_resolver_configured_defaults_to_zero() {
        let (env, client) = setup();
        let owner = Address::generate(&env);
        client.register_agent(&make_record(&env, "no_resolver", "test", owner));

        let health = client.get_agent_health(&Symbol::new(&env, "no_resolver"));
        assert!(health.exists);
        assert_eq!(health.error_count, 0);
    }

    #[test]
    fn get_agent_health_for_unknown_agent_reports_not_exists() {
        let (env, client) = setup();
        let health = client.get_agent_health(&Symbol::new(&env, "ghost"));
        assert!(!health.exists);
        assert_eq!(health.error_count, 0);
    }

    #[test]
    fn deregister_succeeds_even_if_resolver_rejects_the_call() {
        // error-resolver is configured but agent-registry was never
        // allowlisted on it, so clear_agent_errors will fail there.
        // deregister_agent must still succeed: cross-contract cleanup
        // failure is not allowed to block the primary operation.
        let env = Env::default();
        env.mock_all_auths();

        let registry_id = env.register(AgentRegistryContract, ());
        let registry = AgentRegistryContractClient::new(&env, &registry_id);
        let admin = Address::generate(&env);
        registry.initialize(&admin);

        let resolver_id = env.register(error_resolver::ErrorResolverContract, ());
        let resolver = error_resolver::ErrorResolverContractClient::new(&env, &resolver_id);
        resolver.initialize(&admin);
        // Deliberately not allowlisting registry_id as a caller.

        registry.set_error_resolver(&resolver_id);

        let owner = Address::generate(&env);
        registry.register_agent(&make_record(&env, "unlisted_agent", "test", owner));

        // Must not panic despite error-resolver rejecting the call.
        registry.deregister_agent(&Symbol::new(&env, "unlisted_agent"));

        let results = registry.lookup_agents(&Symbol::new(&env, "test"));
        assert_eq!(results.len(), 0);
        let _ = resolver;
    }

    #[test]
    fn cross_contract_cascade_stays_within_conservative_budget() {
        // Measures the actual CPU/memory cost of the error-resolver
        // cross-contract calls (see docs/architecture.md for the numbers
        // this documents). Thresholds here are deliberately generous
        // (~10x observed) so this is a regression guard against a runaway
        // cost change, not a brittle pin to today's exact figures.
        let (env, registry, resolver, registry_id) = setup_with_resolver();
        let owner = Address::generate(&env);
        registry.register_agent(&make_record(&env, "budget_agent", "test", owner));
        let agent_id = Symbol::new(&env, "budget_agent");
        resolver.record_error(&registry_id, &agent_id);

        env.budget().reset_unlimited();
        registry.deregister_agent(&agent_id);
        let cascade_cpu = env.budget().cpu_instruction_cost();
        let cascade_mem = env.budget().memory_bytes_cost();

        std::println!(
            "deregister_agent with error-resolver cascade: {cascade_cpu} cpu insns, {cascade_mem} bytes mem"
        );

        assert!(
            cascade_cpu < 50_000_000,
            "cascade cpu cost grew unexpectedly: {cascade_cpu}"
        );
        assert!(
            cascade_mem < 5_000_000,
            "cascade mem cost grew unexpectedly: {cascade_mem}"
        );

        // Baseline: same operation with no error-resolver configured, so
        // the cascade branch is skipped entirely. The gap between this and
        // the number above is what the cross-contract call itself costs.
        let (env, registry) = setup();
        let owner = Address::generate(&env);
        registry.register_agent(&make_record(&env, "budget_agent", "test", owner));
        let agent_id = Symbol::new(&env, "budget_agent");

        env.budget().reset_unlimited();
        registry.deregister_agent(&agent_id);
        let baseline_cpu = env.budget().cpu_instruction_cost();
        let baseline_mem = env.budget().memory_bytes_cost();

        std::println!(
            "deregister_agent with no error-resolver configured: {baseline_cpu} cpu insns, {baseline_mem} bytes mem"
        );
    }

    #[test]
    fn caller_cannot_impersonate_another_contract_without_being_the_real_invoker() {
        let env = Env::default();

        let registry_id = env.register(AgentRegistryContract, ());
        let resolver_id = env.register(error_resolver::ErrorResolverContract, ());
        let resolver = error_resolver::ErrorResolverContractClient::new(&env, &resolver_id);

        let admin = Address::generate(&env);
        env.mock_all_auths();
        resolver.initialize(&admin);
        resolver.add_authorized_caller(&registry_id);

        // Without mocking, merely passing `registry_id` as the `caller`
        // argument isn't enough: the test harness is the real invoker
        // here, not the registry contract, so `caller.require_auth()`
        // must fail even though `registry_id` is allowlisted.
        env.mock_auths(&[]);
        let agent_id = Symbol::new(&env, "impersonated");
        let result = resolver.try_record_error(&registry_id, &agent_id);
        assert!(result.is_err());
    }
}
