#![no_std]

//! # Agent Registry Contract
//!
//! On-chain registry for AI agents with **batch-optimized** registration and
//! error-resolution paths to amortize base transaction fees.
//!
//! ## Gas model (approximate CPU instructions / CU)
//!
//! | Operation            | count=1   | count=10 (batched) | vs 10 separate txs |
//! |----------------------|-----------|--------------------|--------------------|
//! | `register_agent(s)`  | ~100,000  | ~600,000           | 1,000,000          |
//! | `resolve_error(s)`   | ~50,000   | ~320,000           | 500,000            |
//!
//! Shared per-transaction overhead (~40k CU) is paid once in a batch.
//! Marginal cost per extra item is lower than a full single-item invocation.
//! See `docs/gas_costs.md` for the full table and `estimate_gas` for budgeting.
//!
//! ## Batch semantics
//!
//! Both `register_agents` and `resolve_errors` are **atomic**:
//! 1. Validate every item (auth, existence, duplicates in-batch).
//! 2. Collect per-item results.
//! 3. Write storage **only if every item validated successfully**.
//!
//! Callers inspect the returned `Vec<BatchResult>` / `Vec<VoidBatchResult>`:
//! all-success means the batch committed; any failure means **no** writes occurred.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env,
    String, Symbol, Vec,
};

// ─── Gas budget constants (empirical, CU / CPU instructions) ─────────────────
// Stored as defaults in contract config; overridable via `set_gas_config`.

/// Fixed overhead charged once per transaction invocation.
pub const GAS_TX_OVERHEAD: u64 = 40_000;
/// Full cost of a single `register_agent` (includes overhead).
pub const GAS_REGISTER_AGENT: u64 = 100_000;
/// Marginal cost of each additional agent in a batch after the first.
/// Chosen so a batch of 10 ≈ 600_000 CU (issue #120 gas analysis).
pub const GAS_REGISTER_AGENT_MARGINAL: u64 = 55_556;
/// Full cost of a single error resolution (includes overhead).
pub const GAS_RESOLVE_ERROR: u64 = 50_000;
/// Marginal cost of each additional error resolution in a batch.
pub const GAS_RESOLVE_ERROR_MARGINAL: u64 = 30_000;

/// Default TTL threshold (ledgers remaining) below which we extend.
pub const TTL_THRESHOLD: u32 = 100_000;
/// Target TTL after extension (~31 days at 5s ledgers: 535_680).
pub const TTL_EXTEND_TO: u32 = 535_680;

// ─── Types ───────────────────────────────────────────────────────────────────

/// Input / stored agent record.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentRecord {
    pub id: Symbol,
    pub capability: Symbol,
    pub price_stroops: i128,
    pub endpoint: String,
    pub owner: Address,
}

/// Alias used by the batch API (`register_agents(agents: Vec<AgentParams>)`).
pub type AgentParams = AgentRecord;

/// How an on-chain error was closed.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Resolution {
    Fixed,
    Ignored,
    Escalated,
}

/// Persistent error entry that can be batch-resolved.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ErrorEntry {
    pub id: BytesN<32>,
    pub reporter: Address,
    pub message: String,
    pub resolved: bool,
    pub resolution: Resolution,
}

/// Empirical gas budget parameters (instance storage).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GasConfig {
    pub tx_overhead: u64,
    pub register_agent: u64,
    pub register_agent_marginal: u64,
    pub resolve_error: u64,
    pub resolve_error_marginal: u64,
}

impl GasConfig {
    pub fn default_config() -> Self {
        Self {
            tx_overhead: GAS_TX_OVERHEAD,
            register_agent: GAS_REGISTER_AGENT,
            register_agent_marginal: GAS_REGISTER_AGENT_MARGINAL,
            resolve_error: GAS_RESOLVE_ERROR,
            resolve_error_marginal: GAS_RESOLVE_ERROR_MARGINAL,
        }
    }
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Paused,
    Agent(Symbol),
    CapabilityIndex(Symbol),
    FrozenAgent(Symbol),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
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

        append_capability_index(&env, &record.capability, &record.id);
        env.storage().persistent().set(&agent_key, &record);
        extend_ttl_for_key(&env, &agent_key);
        Ok(())
    }

    /// Batch-register agents in **one** transaction.
    ///
    /// * Validates every agent first (auth, not already registered, no in-batch
    ///   duplicate ids).
    /// * Returns a per-agent [`BatchResult`].
    /// * Writes storage only when **all** items validate (atomic all-or-nothing).
    /// * On success, extends TTL for every written key in a single pass.
    pub fn register_agents(env: Env, agents: Vec<AgentRecord>) -> Vec<BatchResult> {
        let mut results: Vec<BatchResult> = Vec::new(&env);
        let mut all_ok = true;

        // ── Phase 1: validate (no writes) ────────────────────────────────────
        for i in 0..agents.len() {
            let record = agents.get(i).unwrap();

            // Auth first — host will reject the whole invocation if any
            // required auth is missing; still checked per-item for clarity.
            record.owner.require_auth();

            if is_duplicate_in_batch(&agents, i, &record.id) {
                results.push_back(BatchResult::Err(Error::DuplicateInBatch));
                all_ok = false;
                continue;
            }

            let agent_key = DataKey::Agent(record.id.clone());
            if env.storage().persistent().has(&agent_key) {
                results.push_back(BatchResult::Err(Error::AlreadyExists));
                all_ok = false;
                continue;
            }

            results.push_back(BatchResult::Ok(record.id.clone()));
        }

        // ── Phase 2: abort without writing if any item failed ────────────────
        if !all_ok || agents.is_empty() {
            return results;
        }

        // ── Phase 3: commit all writes + batched TTL extension ───────────────
        let mut ttl_keys: Vec<DataKey> = Vec::new(&env);
        for i in 0..agents.len() {
            let record = agents.get(i).unwrap();
            let agent_key = DataKey::Agent(record.id.clone());
            append_capability_index(&env, &record.capability, &record.id);
            env.storage().persistent().set(&agent_key, &record);
            ttl_keys.push_back(agent_key);
        }
        extend_ttl_batch(&env, &ttl_keys);

        results
    }

    pub fn lookup_agents(env: Env, capability: Symbol) -> Vec<AgentRecord> {
        let cap_key = DataKey::CapabilityIndex(capability);
        let ids: Vec<Symbol> = env
            .storage()
            .persistent()
            .get(&cap_key)
            .unwrap_or_else(|| Vec::new(&env));

        // Touch / extend the index TTL when used.
        if env.storage().persistent().has(&cap_key) {
            extend_ttl_for_key(&env, &cap_key);
        }

        let mut records = Vec::new(&env);
        let mut ttl_keys: Vec<DataKey> = Vec::new(&env);
        for id in ids.iter() {
            let agent_key = DataKey::Agent(id.clone());
            if let Some(r) = env
                .storage()
                .persistent()
                .get::<DataKey, AgentRecord>(&agent_key)
            {
                ttl_keys.push_back(agent_key);
                records.push_back(r);
            }
        }
        // Batch-extend TTLs for every agent loaded in this lookup.
        extend_ttl_batch(&env, &ttl_keys);
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
        Ok(())
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
        extend_ttl_for_key(&env, &agent_key);

        env.events().publish(
            (symbol_short!("registry"), symbol_short!("price_upd")),
            (agent_id, new_price),
        );

        Ok(())
    }

    // ── Error reporting / batch resolution ───────────────────────────────────

    /// Report an operational error (creates an unresolved entry).
    pub fn report_error(
        env: Env,
        error_id: BytesN<32>,
        reporter: Address,
        message: String,
    ) -> Result<(), Error> {
        reporter.require_auth();

        let key = DataKey::Error(error_id.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyExists);
        }

        let entry = ErrorEntry {
            id: error_id,
            reporter,
            message,
            resolved: false,
            // Placeholder until resolve_errors overwrites with a real resolution.
            resolution: Resolution::Fixed,
        };
        env.storage().persistent().set(&key, &entry);
        extend_ttl_for_key(&env, &key);
        Ok(())
    }

    /// Resolve multiple errors in one transaction (atomic all-or-nothing).
    ///
    /// Validates every id first; writes only if all succeed. Per-item results
    /// are always returned so callers can see which ids failed validation.
    pub fn resolve_errors(
        env: Env,
        error_ids: Vec<BytesN<32>>,
        resolution: Resolution,
    ) -> Vec<VoidBatchResult> {
        let mut results: Vec<VoidBatchResult> = Vec::new(&env);
        let mut all_ok = true;

        // ── Phase 1: validate ────────────────────────────────────────────────
        for i in 0..error_ids.len() {
            let id = error_ids.get(i).unwrap();

            if is_duplicate_error_id(&error_ids, i, &id) {
                results.push_back(VoidBatchResult::Err(Error::DuplicateInBatch));
                all_ok = false;
                continue;
            }

            let key = DataKey::Error(id.clone());
            let entry: Option<ErrorEntry> = env.storage().persistent().get(&key);
            match entry {
                None => {
                    results.push_back(VoidBatchResult::Err(Error::NotFound));
                    all_ok = false;
                }
                Some(e) if e.resolved => {
                    results.push_back(VoidBatchResult::Err(Error::AlreadyResolved));
                    all_ok = false;
                }
                Some(_) => {
                    results.push_back(VoidBatchResult::Ok);
                }
            }
        }

        if !all_ok || error_ids.is_empty() {
            return results;
        }

        // ── Phase 2: commit ──────────────────────────────────────────────────
        let mut ttl_keys: Vec<DataKey> = Vec::new(&env);
        for i in 0..error_ids.len() {
            let id = error_ids.get(i).unwrap();
            let key = DataKey::Error(id.clone());
            let mut entry: ErrorEntry = env.storage().persistent().get(&key).unwrap();
            entry.resolved = true;
            entry.resolution = resolution.clone();
            env.storage().persistent().set(&key, &entry);
            ttl_keys.push_back(key);
        }
        extend_ttl_batch(&env, &ttl_keys);

        results
    }

    /// Fetch a single error entry (for tests / off-chain indexing).
    pub fn get_error(env: Env, error_id: BytesN<32>) -> Option<ErrorEntry> {
        env.storage().persistent().get(&DataKey::Error(error_id))
    }

    // ── Gas budget estimation ────────────────────────────────────────────────

    /// Estimate CPU instruction budget for a batch operation.
    ///
    /// `operation` is one of:
    /// - `"register_agent"` / `"register_agents"`
    /// - `"resolve_error"` / `"resolve_errors"`
    ///
    /// Returns `0` for unknown operations. Values come from [`GasConfig`]
    /// (defaults match the tables in `docs/gas_costs.md`).
    pub fn estimate_gas(env: Env, operation: String, count: u32) -> u64 {
        if count == 0 {
            return 0;
        }
        let cfg = gas_config(&env);

        let register_agent = String::from_str(&env, "register_agent");
        let register_agents = String::from_str(&env, "register_agents");
        let resolve_error = String::from_str(&env, "resolve_error");
        let resolve_errors = String::from_str(&env, "resolve_errors");

        if operation == register_agent || operation == register_agents {
            // First item pays full single-call cost; rest pay marginal.
            cfg.register_agent
                + cfg
                    .register_agent_marginal
                    .saturating_mul((count - 1) as u64)
        } else if operation == resolve_error || operation == resolve_errors {
            cfg.resolve_error
                + cfg
                    .resolve_error_marginal
                    .saturating_mul((count - 1) as u64)
        } else {
            0
        }
    }

    /// Override empirical gas parameters stored in instance config.
    pub fn set_gas_config(env: Env, config: GasConfig) {
        env.storage().instance().set(&DataKey::GasConfig, &config);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    /// Read the current gas configuration (defaults if never set).
    pub fn get_gas_config(env: Env) -> GasConfig {
        gas_config(&env)
    }
}

// ─── Unit tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, BytesN, Env};

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

    fn error_id(env: &Env, byte: u8) -> BytesN<32> {
        let mut arr = [0u8; 32];
        arr[0] = byte;
        BytesN::from_array(env, &arr)
    }

    // ── Existing single-item tests ───────────────────────────────────────────

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
        assert!(client.is_agent_frozen(Symbol::new(&env, "agent_unf")));
        client.unfreeze_agent(&Symbol::new(&env, "agent_unf"));
        assert!(!client.is_agent_frozen(Symbol::new(&env, "agent_unf")));
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
        assert!(!client.is_agent_frozen(Symbol::new(&env, "agent_state")));
        client.freeze_agent(&Symbol::new(&env, "agent_state"));
        assert!(client.is_agent_frozen(Symbol::new(&env, "agent_state")));
        client.unfreeze_agent(&Symbol::new(&env, "agent_state"));
        assert!(!client.is_agent_frozen(Symbol::new(&env, "agent_state")));
    }
}
