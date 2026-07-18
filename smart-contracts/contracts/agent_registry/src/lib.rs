#![no_std]

mod events;

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

#[contracttype]
pub enum DataKey {
    Agent(Symbol),
    CapabilityIndex(Symbol),
    Status(Symbol),
}

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum Error {
    NotFound = 1,
    Unauthorized = 2,
    AlreadyExists = 3,
}

#[contract]
pub struct AgentRegistryContract;

#[contractimpl]
impl AgentRegistryContract {
    pub fn register_agent(env: Env, record: AgentRecord) -> Result<(), Error> {
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

        let timestamp = env.ledger().timestamp();
        env.events().publish(
            (symbol_short!("registry"), Symbol::new(&env, "registered")),
            events::AgentRegistered {
                agent_id: record.id.clone(),
                agent_type: record.capability.clone(),
                owner: record.owner.clone(),
                timestamp,
            },
        );

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

        let status_key = DataKey::Status(agent_id.clone());
        env.storage().persistent().remove(&status_key);

        env.events().publish(
            (symbol_short!("registry"), Symbol::new(&env, "removed")),
            events::AgentRemoved {
                agent_id,
            },
        );

        Ok(())
    }

    pub fn update_pricing(env: Env, agent_id: Symbol, new_price: i128) -> Result<(), Error> {
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

    pub fn update_status(env: Env, agent_id: Symbol, new_status: Symbol) -> Result<(), Error> {
        let agent_key = DataKey::Agent(agent_id.clone());
        let record: AgentRecord = env
            .storage()
            .persistent()
            .get(&agent_key)
            .ok_or(Error::NotFound)?;

        record.owner.require_auth();

        let status_key = DataKey::Status(agent_id.clone());
        let old_status: Symbol = env
            .storage()
            .persistent()
            .get(&status_key)
            .unwrap_or_else(|| Symbol::new(&env, "offline"));

        env.storage().persistent().set(&status_key, &new_status);

        env.events().publish(
            (symbol_short!("registry"), Symbol::new(&env, "status_chg")),
            events::AgentStatusChanged {
                agent_id,
                old_status,
                new_status,
            },
        );

        Ok(())
    }

    pub fn lookup_status(env: Env, agent_id: Symbol) -> Result<Symbol, Error> {
        let agent_key = DataKey::Agent(agent_id.clone());
        if !env.storage().persistent().has(&agent_key) {
            return Err(Error::NotFound);
        }
        let status_key = DataKey::Status(agent_id);
        let status: Symbol = env
            .storage()
            .persistent()
            .get(&status_key)
            .unwrap_or_else(|| Symbol::new(&env, "offline"));
        Ok(status)
    }
}

#[cfg(test)]
mod test {
    extern crate std;
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Events as _, Env, FromVal, Val};

    fn setup() -> (Env, AgentRegistryContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(AgentRegistryContract, ());
        let client = AgentRegistryContractClient::new(&env, &id);
        (env, client)
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

        // Register as owner (with mocked auth)
        env.mock_all_auths();
        client.register_agent(&make_record(&env, "agent3", "risk", owner.clone()));

        // Attempt deregister without satisfying owner auth
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
    fn register_agent_emits_event() {
        let (env, client) = setup();
        let owner = Address::generate(&env);
        let record = make_record(&env, "agent_evt", "research", owner.clone());
        
        client.register_agent(&record);

        let events = env.events().all();
        let last_event = events.last().unwrap();
        
        assert_eq!(last_event.0, client.address);
        
        let topics = last_event.1;
        let topic_1 = Symbol::from_val(&env, &topics.get(0).unwrap());
        let topic_2 = Symbol::from_val(&env, &topics.get(1).unwrap());
        
        assert_eq!(topic_1, symbol_short!("registry"));
        assert_eq!(topic_2, Symbol::new(&env, "registered"));

        let event_data = <events::AgentRegistered as FromVal<Env, Val>>::from_val(&env, &last_event.2);
        assert_eq!(event_data.agent_id, Symbol::new(&env, "agent_evt"));
        assert_eq!(event_data.agent_type, Symbol::new(&env, "research"));
        assert_eq!(event_data.owner, owner);
        assert_eq!(event_data.timestamp, env.ledger().timestamp());
    }

    #[test]
    fn deregister_agent_emits_event() {
        let (env, client) = setup();
        let owner = Address::generate(&env);
        client.register_agent(&make_record(&env, "agent_evt", "research", owner));
        
        client.deregister_agent(&Symbol::new(&env, "agent_evt"));

        let events = env.events().all();
        let last_event = events.last().unwrap();
        
        assert_eq!(last_event.0, client.address);
        
        let topics = last_event.1;
        let topic_1 = Symbol::from_val(&env, &topics.get(0).unwrap());
        let topic_2 = Symbol::from_val(&env, &topics.get(1).unwrap());
        
        assert_eq!(topic_1, symbol_short!("registry"));
        assert_eq!(topic_2, Symbol::new(&env, "removed"));

        let event_data = <events::AgentRemoved as FromVal<Env, Val>>::from_val(&env, &last_event.2);
        assert_eq!(event_data.agent_id, Symbol::new(&env, "agent_evt"));
    }

    #[test]
    fn update_status_works_and_emits_event() {
        let (env, client) = setup();
        let owner = Address::generate(&env);
        client.register_agent(&make_record(&env, "agent_status", "coding", owner));

        // Initial status lookup should return "offline"
        let status = client.lookup_status(&Symbol::new(&env, "agent_status"));
        assert_eq!(status, Symbol::new(&env, "offline"));

        // Call update_status
        client.update_status(&Symbol::new(&env, "agent_status"), &Symbol::new(&env, "online"));

        // Get events immediately after update_status
        let events = env.events().all();
        let last_event = events.last().unwrap();
        assert_eq!(last_event.0, client.address);
        
        let topics = last_event.1.clone();
        let topic_1 = Symbol::from_val(&env, &topics.get(0).unwrap());
        let topic_2 = Symbol::from_val(&env, &topics.get(1).unwrap());
        
        assert_eq!(topic_1, symbol_short!("registry"));
        assert_eq!(topic_2, Symbol::new(&env, "status_chg"));

        let event_data = <events::AgentStatusChanged as FromVal<Env, Val>>::from_val(&env, &last_event.2);
        assert_eq!(event_data.agent_id, Symbol::new(&env, "agent_status"));
        assert_eq!(event_data.old_status, Symbol::new(&env, "offline"));
        assert_eq!(event_data.new_status, Symbol::new(&env, "online"));

        // Verify status was indeed updated on-chain
        let updated_status = client.lookup_status(&Symbol::new(&env, "agent_status"));
        assert_eq!(updated_status, Symbol::new(&env, "online"));
    }

    #[test]
    fn lookup_status_missing_agent_returns_not_found() {
        let (env, client) = setup();
        assert_eq!(
            client.try_lookup_status(&Symbol::new(&env, "ghost")),
            Err(Ok(Error::NotFound))
        );
    }
}
