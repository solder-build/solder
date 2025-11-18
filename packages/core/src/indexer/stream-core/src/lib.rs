use std::{collections::{HashMap, HashSet}, fs, path::PathBuf, sync::Arc};

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use tokio::{
    fs as tokio_fs,
    sync::{Mutex, mpsc},
};
use yellowstone_grpc_proto::geyser::{SlotStatus, SubscribeUpdateTransactionInfo};
use yellowstone_vixen::{
    Runtime,
    config::VixenConfig,
    handler::{Handler, HandlerResult, Pipeline},
    vixen_core::{
        AccountUpdate, ParseResult, Parser as VixenParser, Prefilter, SlotUpdate, TransactionUpdate,
        instruction::InstructionUpdate,
    },
};
use yellowstone_vixen_core::Pubkey as VixenPubkey;
use yellowstone_vixen_yellowstone_fumarole_source::{FumaroleConfig, YellowstoneFumaroleSource};

mod idl;
use crate::idl::{DecodedEvent, DecodedInstruction, IdlConfig, IdlRegistry};

pub const DEFAULT_CHANNEL_CAPACITY: usize = 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct AppConfig {
    #[serde(flatten)]
    pub vixen: VixenConfig<FumaroleConfig>,
    #[serde(default)]
    pub pipeline: PipelineConfig,
    #[serde(default)]
    pub metrics: MetricsConfig,
}

#[derive(Debug, Deserialize)]
#[serde(default, rename_all = "kebab-case")]
pub struct PipelineConfig {
    pub slots: bool,
    pub enable_transactions: bool,
    #[serde(default)]
    pub event_subscriptions: Vec<EventSubscriptionConfig>,
    #[serde(default)]
    pub transaction_subscriptions: Vec<TransactionSubscriptionConfig>,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            slots: false,
            enable_transactions: false,
            event_subscriptions: Vec::new(),
            transaction_subscriptions: Vec::new(),
        }
    }
}

#[derive(Debug, Deserialize, Clone)]
#[serde(default, rename_all = "kebab-case")]
pub struct EventSubscriptionConfig {
    pub id: String,
    #[serde(flatten)]
    pub idl: IdlConfig,
    pub event_name: String,
}

impl Default for EventSubscriptionConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            idl: IdlConfig {
                program_id: String::new(),
                idl_path: None,
                idl_json: None,
            },
            event_name: String::new(),
        }
    }
}

#[derive(Debug, Deserialize, Clone)]
#[serde(default, rename_all = "kebab-case")]
pub struct TransactionSubscriptionConfig {
    pub id: String,
    #[serde(flatten)]
    pub idl: IdlConfig,
    #[serde(default)]
    pub instruction_name_filters: Vec<String>,
}

impl Default for TransactionSubscriptionConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            idl: IdlConfig {
                program_id: String::new(),
                idl_path: None,
                idl_json: None,
            },
            instruction_name_filters: Vec::new(),
        }
    }
}

#[derive(Debug, Default)]
struct ProgramSubscriptionSet {
    event_subscriptions: Vec<EventSubscription>,
    transaction_subscriptions: Vec<TransactionSubscription>,
}

#[derive(Debug, Clone)]
struct EventSubscription {
    id: String,
    event_name: String,
}

#[derive(Debug, Clone)]
struct TransactionSubscription {
    id: String,
    instruction_name_filters: Vec<String>,
}

fn load_idl_for_config(
    idl_registry: &mut IdlRegistry,
    idl: &IdlConfig,
    config_path: Option<&PathBuf>,
    loaded: &mut HashSet<String>,
) {
    if idl.program_id.is_empty() || loaded.contains(&idl.program_id) {
        return;
    }

    if let Some(path) = &idl.idl_path {
        let resolved_path = if let Some(config_path) = config_path {
            if path.is_absolute() {
                path.clone()
            } else {
                config_path
                    .parent()
                    .map(|parent| parent.join(path))
                    .unwrap_or_else(|| path.clone())
            }
        } else {
            path.clone()
        };

        match idl_registry.load_from_file(&idl.program_id, &resolved_path) {
            Ok(_) => {
                loaded.insert(idl.program_id.clone());
                return;
            }
            Err(e) => {
                tracing::warn!(
                    "Failed to load IDL from {}: {}",
                    resolved_path.display(),
                    e
                );
            }
        }
    }

    if let Some(json) = &idl.idl_json {
        match idl_registry.load_from_str(&idl.program_id, json) {
            Ok(_) => {
                loaded.insert(idl.program_id.clone());
            }
            Err(e) => {
                tracing::warn!("Failed to load IDL JSON for {}: {}", idl.program_id, e);
            }
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(default, rename_all = "kebab-case")]
pub struct MetricsConfig {
    pub slot_window_enabled: bool,
    pub slot_window_size: u64,
    pub slot_window_output: Option<PathBuf>,
    pub slot_window_start_slot: Option<u64>,
}

impl Default for MetricsConfig {
    fn default() -> Self {
        Self {
            slot_window_enabled: false,
            slot_window_size: 100,
            slot_window_output: None,
            slot_window_start_slot: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SlotEvent {
    pub slot: u64,
    pub parent: Option<u64>,
    pub status: String,
    pub dead_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RawAccountEvent {
    pub program: String,
    pub slot: u64,
    pub is_startup: bool,
    pub account: Option<AccountInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AccountInfo {
    pub pubkey: String,
    pub owner: String,
    pub lamports: u64,
    pub rent_epoch: u64,
    pub executable: bool,
    pub write_version: u64,
    pub txn_signature: Option<String>,
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RawInstructionEvent {
    pub program: String,
    pub slot: u64,
    pub signature: String,
    pub accounts: Vec<String>,
    pub data: String,
    pub is_vote: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parsed: Option<DecodedInstruction>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    Account { event: RawAccountEvent },
    Instruction { event: RawInstructionEvent },
    Event { event: RawEventEvent },
    Slot { event: SlotEvent },
    Transaction { event: RawTransactionEvent },
}

#[derive(Debug, Clone, Serialize)]
pub struct RawEventEvent {
    pub program: String,
    pub slot: u64,
    pub signature: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<u32>,
    pub parsed: DecodedEvent,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscription_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RawTransactionEvent {
    pub slot: u64,
    pub signature: String,
    pub is_vote: bool,
    pub index: u64,
    pub message: TxMessage,
    pub meta: TxMeta,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parsed_instructions: Vec<DecodedInstruction>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parsed_events: Vec<ParsedEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscription_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TxMessage {
    pub header: TxMessageHeader,
    pub account_keys: Vec<String>,
    pub recent_blockhash: String,
    pub instructions: Vec<TxCompiledInstruction>,
    pub versioned: bool,
    pub address_table_lookups: Vec<TxMessageAddressTableLookup>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TxMessageHeader {
    pub num_required_signatures: u32,
    pub num_readonly_signed_accounts: u32,
    pub num_readonly_unsigned_accounts: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct TxMessageAddressTableLookup {
    pub account_key: String,
    pub writable_indexes: Vec<u8>,
    pub readonly_indexes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TxCompiledInstruction {
    pub program_id_index: u32,
    pub accounts: Vec<u8>,
    pub data_base64: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TxMeta {
    pub fee: u64,
    pub pre_balances: Vec<u64>,
    pub post_balances: Vec<u64>,
    pub log_messages: Vec<String>,
    pub compute_units_consumed: Option<u64>,
    pub cost_units: Option<u64>,
    pub err_base64: Option<String>,
    pub pre_token_balances: Vec<TokenBalance>,
    pub post_token_balances: Vec<TokenBalance>,
    pub loaded_writable_addresses: Vec<String>,
    pub loaded_readonly_addresses: Vec<String>,
    pub return_data: Option<ReturnData>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ParsedEvent {
    pub index: u32,
    pub name: String,
    pub params: JsonValue,
}

#[derive(Debug, Clone, Serialize)]
pub struct TokenBalance {
    pub account_index: u32,
    pub mint: String,
    pub owner: String,
    pub program_id: String,
    pub ui_amount: Option<f64>,
    pub decimals: u32,
    pub amount: String,
    pub ui_amount_string: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReturnData {
    pub program_id: String,
    pub data_base64: String,
}

struct PipelineOutputs {
    builder: yellowstone_vixen::builder::RuntimeBuilder<YellowstoneFumaroleSource>,
    slot_window_tracker: Option<SlotWindowTracker>,
}

pub async fn run_with_sender(config: AppConfig, config_path: Option<&PathBuf>, sender: mpsc::Sender<StreamEvent>) -> Result<()> {
    let AppConfig {
        vixen,
        pipeline,
        metrics,
    } = config;

    let PipelineOutputs {
        mut builder,
        slot_window_tracker,
    } = build_pipelines(&pipeline, config_path, sender.clone(), &metrics)?;

    if let Some(tracker) = slot_window_tracker {
        builder = builder.slot(Pipeline::new(SlotMetricsPassthroughParser, [tracker]));
    }

    let runtime = builder.build(vixen);

    runtime
        .try_run_async()
        .await
        .map_err(|e| anyhow!("runtime terminated: {e}"))
}

fn build_pipelines(
    pipeline: &PipelineConfig,
    config_path: Option<&PathBuf>,
    sender: mpsc::Sender<StreamEvent>,
    metrics: &MetricsConfig,
) -> Result<PipelineOutputs> {
    let mut builder = Runtime::<YellowstoneFumaroleSource>::builder();

    let mut idl_registry = IdlRegistry::new();
    let mut loaded_programs = HashSet::new();
    let mut program_subscriptions: HashMap<String, ProgramSubscriptionSet> = HashMap::new();

    for subscription in &pipeline.event_subscriptions {
        load_idl_for_config(
            &mut idl_registry,
            &subscription.idl,
            config_path,
            &mut loaded_programs,
        );

        if subscription.idl.program_id.is_empty() {
            continue;
        }

        let entry = program_subscriptions
            .entry(subscription.idl.program_id.clone())
            .or_default();
        entry.event_subscriptions.push(EventSubscription {
            id: subscription.id.clone(),
            event_name: subscription.event_name.clone(),
        });
    }

    for subscription in &pipeline.transaction_subscriptions {
        load_idl_for_config(
            &mut idl_registry,
            &subscription.idl,
            config_path,
            &mut loaded_programs,
        );

        if subscription.idl.program_id.is_empty() {
            continue;
        }

        let entry = program_subscriptions
            .entry(subscription.idl.program_id.clone())
            .or_default();
        entry.transaction_subscriptions.push(TransactionSubscription {
            id: subscription.id.clone(),
            instruction_name_filters: subscription.instruction_name_filters.clone(),
        });
    }

    if pipeline.slots {
        let handler = SlotEventForwarder::new(sender.clone());
        builder = builder.slot(Pipeline::new(SlotPassthroughParser, [handler]));
    }

    for (program_id, subscriptions) in &program_subscriptions {
        if !pipeline.enable_transactions {
            continue;
        }

        if subscriptions.event_subscriptions.is_empty()
            && subscriptions.transaction_subscriptions.is_empty()
        {
            continue;
        }

        let parser = RawTransactionPassthroughParser::new(program_id)?;
        let instruction_decoder = idl_registry.get_instruction_decoder(program_id).cloned();
        let event_decoder = idl_registry.get_event_decoder(program_id).cloned();
        let instruction_forwarder = Some(RawInstructionForwarder::new(
            sender.clone(),
            instruction_decoder,
            event_decoder,
            subscriptions.event_subscriptions.clone(),
        ));
        let handler = RawTransactionForwarder::new(
            sender.clone(),
            instruction_forwarder,
            subscriptions.transaction_subscriptions.clone(),
        );
        builder = builder.transaction(Pipeline::new(parser, [handler]));
    }

    let slot_window_tracker = if metrics.slot_window_enabled {
        let output_path = metrics
            .slot_window_output
            .clone()
            .unwrap_or_else(|| PathBuf::from("slot_window_metrics.json"));
        let window = metrics.slot_window_size.max(1);
        let start_slot = metrics.slot_window_start_slot;
        Some(SlotWindowTracker::new(window, output_path, start_slot))
    } else {
        None
    };

    Ok(PipelineOutputs {
        builder,
        slot_window_tracker,
    })
}

#[derive(Debug, Clone, Copy)]
struct SlotPassthroughParser;

impl VixenParser for SlotPassthroughParser {
    type Input = SlotUpdate;
    type Output = SlotUpdate;

    fn id(&self) -> std::borrow::Cow<'static, str> {
        "slot::passthrough".into()
    }

    fn prefilter(&self) -> Prefilter {
        Prefilter::builder().slots().build().unwrap()
    }

    fn parse(
        &self,
        update: &Self::Input,
    ) -> impl std::future::Future<Output = ParseResult<Self::Output>> + Send {
        let cloned = update.clone();
        async move { Ok(cloned) }
    }
}

#[derive(Debug, Clone, Copy)]
struct SlotMetricsPassthroughParser;

impl VixenParser for SlotMetricsPassthroughParser {
    type Input = SlotUpdate;
    type Output = SlotUpdate;

    fn id(&self) -> std::borrow::Cow<'static, str> {
        "slot::metrics-passthrough".into()
    }

    fn prefilter(&self) -> Prefilter {
        Prefilter::builder().slots().build().unwrap()
    }

    fn parse(
        &self,
        update: &Self::Input,
    ) -> impl std::future::Future<Output = ParseResult<Self::Output>> + Send {
        let cloned = update.clone();
        async move { Ok(cloned) }
    }
}

#[derive(Debug, Clone)]
struct RawAccountPassthroughParser {
    program_id: VixenPubkey,
    program_id_str: String,
}

impl RawAccountPassthroughParser {
    fn new(program_address: &str) -> Result<Self> {
        let program_id = parse_pubkey(program_address)?;
        Ok(Self {
            program_id,
            program_id_str: program_address.to_string(),
        })
    }
}

impl VixenParser for RawAccountPassthroughParser {
    type Input = AccountUpdate;
    type Output = AccountUpdate;

    fn id(&self) -> std::borrow::Cow<'static, str> {
        format!("raw_account::{}", self.program_id_str).into()
    }

    fn prefilter(&self) -> Prefilter {
        Prefilter::builder()
            .account_owners([self.program_id.as_ref() as &[u8]])
            .build()
            .unwrap()
    }

    fn parse(
        &self,
        update: &Self::Input,
    ) -> impl std::future::Future<Output = ParseResult<Self::Output>> + Send {
        let cloned = update.clone();
        async move { Ok(cloned) }
    }
}

#[derive(Debug, Clone)]
struct RawAccountForwarder {
    sender: mpsc::Sender<StreamEvent>,
    program_id: String,
}

impl RawAccountForwarder {
    fn new(sender: mpsc::Sender<StreamEvent>, program_id: String) -> Self {
        Self { sender, program_id }
    }
}

impl Handler<AccountUpdate> for RawAccountForwarder {
    fn handle(
        &self,
        update: &AccountUpdate,
    ) -> impl std::future::Future<Output = HandlerResult<()>> + Send {
        let sender = self.sender.clone();
        let event = build_account_event(self.program_id.clone(), update.clone());
        async move {
            sender
                .send(StreamEvent::Account { event })
                .await
                .map_err(|e| Box::new(e) as _)
        }
    }
}

#[derive(Debug, Clone)]
struct RawInstructionForwarder {
    sender: mpsc::Sender<StreamEvent>,
    instruction_decoder: Option<crate::idl::InstructionDecoder>,
    event_decoder: Option<crate::idl::EventDecoder>,
    event_subscriptions: Vec<EventSubscription>,
}

impl RawInstructionForwarder {
    async fn forward_instruction(&self, update: &InstructionUpdate, instruction_index: Option<u32>) -> HandlerResult<()> {
        use base64::Engine;

        let sender = self.sender.clone();
        let instruction_decoder = self.instruction_decoder.clone();
        let event_decoder = self.event_decoder.clone();

        let main_data = update.data.clone();
        let program = update.program;
        let slot = update.shared.slot;
        let signature = encode_base58(&update.shared.signature);
        let inner_data: Vec<(Vec<u8>, VixenPubkey)> = update
            .inner
            .iter()
            .map(|inner| (inner.data.clone(), inner.program))
            .collect();
        let accounts = update.accounts.clone();
        let is_vote = update.shared.is_vote;

        if !self.event_subscriptions.is_empty() {
            if let Some(decoder) = event_decoder.as_ref() {
                match decoder.decode_from_instruction_data(&main_data) {
                    Ok(events) => {
                        for decoded_event in events {
                            for subscription in self
                                .event_subscriptions
                                .iter()
                                .filter(|sub| sub.event_name == decoded_event.name)
                            {
                                let event = RawEventEvent {
                                    program: encode_base58(program.as_ref()),
                                    slot,
                                    signature: signature.clone(),
                                    index: instruction_index,
                                    parsed: decoded_event.clone(),
                                    subscription_id: Some(subscription.id.clone()),
                                };
                                if sender.send(StreamEvent::Event { event }).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                    Err(_) => {}
                }
            }
        }

        let decoded = instruction_decoder.as_ref().and_then(|d| d.decode(&main_data).ok());

        if let Some(decoded_inst) = decoded {
            let event = RawInstructionEvent {
                program: encode_base58(program.as_ref()),
                slot,
                signature: signature.clone(),
                accounts: accounts.iter().map(|a| encode_base58(a.as_ref())).collect(),
                data: base64::engine::general_purpose::STANDARD.encode(&main_data),
                is_vote,
                parsed: Some(decoded_inst),
            };
            sender
                .send(StreamEvent::Instruction { event })
                .await
                .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;
        }

        if !self.event_subscriptions.is_empty() {
            if let Some(decoder) = event_decoder.as_ref() {
                for (inner_data_bytes, inner_program) in inner_data {
                    if let Ok(events) = decoder.decode_from_instruction_data(&inner_data_bytes) {
                        for decoded_event in events {
                            for subscription in self
                                .event_subscriptions
                                .iter()
                                .filter(|sub| sub.event_name == decoded_event.name)
                            {
                                let event = RawEventEvent {
                                    program: encode_base58(inner_program.as_ref()),
                                    slot,
                                    signature: signature.clone(),
                                    index: instruction_index,
                                    parsed: decoded_event.clone(),
                                    subscription_id: Some(subscription.id.clone()),
                                };
                                if sender.send(StreamEvent::Event { event }).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(())
    }
}

impl RawInstructionForwarder {
    fn decode_instruction_only(&self, update: &InstructionUpdate) -> Option<DecodedInstruction> {
        let decoder = self.instruction_decoder.as_ref()?;
        decoder.decode(&update.data).ok()
    }

    fn decode_events_only(&self, update: &InstructionUpdate, instruction_index: u32) -> Vec<ParsedEvent> {
        let mut events = Vec::new();
        let decoder = match self.event_decoder.as_ref() {
            Some(decoder) => decoder,
            None => return events,
        };

        match decoder.decode_from_instruction_data(&update.data) {
            Ok(decoded_events) => {
                for event in decoded_events {
                    events.push(ParsedEvent {
                        index: instruction_index,
                        name: event.name,
                        params: event.params,
                    });
                }
            }
            Err(_) => {}
        }

        for inner in &update.inner {
            if let Ok(decoded_events) = decoder.decode_from_instruction_data(&inner.data) {
                for event in decoded_events {
                    events.push(ParsedEvent {
                        index: instruction_index,
                        name: event.name,
                        params: event.params,
                    });
                }
            }
        }

        events
    }

    fn new(
        sender: mpsc::Sender<StreamEvent>,
        instruction_decoder: Option<crate::idl::InstructionDecoder>,
        event_decoder: Option<crate::idl::EventDecoder>,
        event_subscriptions: Vec<EventSubscription>,
    ) -> Self {
        Self {
            sender,
            instruction_decoder,
            event_decoder,
            event_subscriptions,
        }
    }
}

impl Handler<InstructionUpdate> for RawInstructionForwarder {
    fn handle(
        &self,
        update: &InstructionUpdate,
    ) -> impl std::future::Future<Output = HandlerResult<()>> + Send {
        let forwarder = self.clone();
        async move { forwarder.forward_instruction(update, None).await }
    }
}

#[derive(Debug, Clone)]
struct RawTransactionPassthroughParser {
    program_id: VixenPubkey,
    program_id_str: String,
}

impl RawTransactionPassthroughParser {
    fn new(program_address: &str) -> Result<Self> {
        let program_id = parse_pubkey(program_address)?;
        Ok(Self {
            program_id,
            program_id_str: program_address.to_string(),
        })
    }
}

impl VixenParser for RawTransactionPassthroughParser {
    type Input = TransactionUpdate;
    type Output = TransactionUpdate;

    fn id(&self) -> std::borrow::Cow<'static, str> {
        format!("raw_transaction::{}", self.program_id_str).into()
    }

    fn prefilter(&self) -> Prefilter {
        Prefilter::builder()
            .transaction_accounts_include([self.program_id.as_ref() as &[u8]])
            .build()
            .unwrap()
    }

    fn parse(
        &self,
        update: &Self::Input,
    ) -> impl std::future::Future<Output = ParseResult<Self::Output>> + Send {
        let cloned = update.clone();
        async move { Ok(cloned) }
    }
}

#[derive(Debug, Clone)]
struct RawTransactionForwarder {
    sender: mpsc::Sender<StreamEvent>,
    instruction_forwarder: Option<RawInstructionForwarder>,
    transaction_subscriptions: Vec<TransactionSubscription>,
}

impl RawTransactionForwarder {
    fn new(
        sender: mpsc::Sender<StreamEvent>,
        instruction_forwarder: Option<RawInstructionForwarder>,
        transaction_subscriptions: Vec<TransactionSubscription>,
    ) -> Self {
        Self {
            sender,
            instruction_forwarder,
            transaction_subscriptions,
        }
    }
}

impl Handler<TransactionUpdate> for RawTransactionForwarder {
    fn handle(
        &self,
        update: &TransactionUpdate,
    ) -> impl std::future::Future<Output = HandlerResult<()>> + Send {
        let sender = self.sender.clone();
        let instruction_forwarder = self.instruction_forwarder.clone();
        let transaction_subscriptions = self.transaction_subscriptions.clone();
        let update = update.clone();
        async move {
            let mut parsed_instructions = Vec::new();
            let mut parsed_events = Vec::new();

            if let Some(forwarder) = instruction_forwarder.clone() {
                match InstructionUpdate::parse_from_txn(&update) {
                    Ok(instruction_trees) => {
                        for (idx, instruction) in instruction_trees
                            .iter()
                            .flat_map(|tree| tree.visit_all())
                            .enumerate()
                        {
                            if let Err(err) = forwarder
                                .forward_instruction(&instruction, Some(idx as u32))
                                .await
                            {
                                tracing::warn!(
                                    "failed to forward instruction events for transaction: {err}"
                                );
                            }
                            if let Some(decoded) = forwarder.decode_instruction_only(&instruction) {
                                parsed_instructions.push(decoded);
                            }
                            parsed_events.extend(
                                forwarder.decode_events_only(&instruction, idx as u32),
                            );
                        }
                    }
                    Err(err) => {
                        tracing::warn!("failed to parse instructions from transaction: {err}");
                    }
                }
            }

            if transaction_subscriptions.is_empty() {
                return Ok(());
            }

            for subscription in transaction_subscriptions {
                let instructions = if subscription.instruction_name_filters.is_empty() {
                    parsed_instructions.clone()
                } else {
                    parsed_instructions
                        .iter()
                        .cloned()
                        .filter(|ix| subscription
                            .instruction_name_filters
                            .iter()
                            .any(|filter| filter.eq_ignore_ascii_case(&ix.name)))
                        .collect()
                };

                if !instructions.is_empty()
                    || subscription.instruction_name_filters.is_empty()
                {
                    let event = build_transaction_event(
                        &update,
                        instructions,
                        parsed_events.clone(),
                        Some(subscription.id.clone()),
                    );
                    sender
                        .send(StreamEvent::Transaction { event })
                        .await
                        .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;
                }
            }

            Ok(())
        }
    }
}

#[derive(Debug, Clone)]
struct SlotEventForwarder {
    sender: mpsc::Sender<StreamEvent>,
}

impl SlotEventForwarder {
    fn new(sender: mpsc::Sender<StreamEvent>) -> Self {
        Self { sender }
    }
}

impl Handler<SlotUpdate> for SlotEventForwarder {
    fn handle(
        &self,
        update: &SlotUpdate,
    ) -> impl std::future::Future<Output = HandlerResult<()>> + Send {
        let sender = self.sender.clone();
        let update = update.clone();
        async move {
            let payload = StreamEvent::Slot {
                event: SlotEvent {
                    slot: update.slot,
                    parent: update.parent,
                    status: slot_status_name(update.status),
                    dead_error: update.dead_error.clone(),
                },
            };
            sender.send(payload).await.map_err(|e| Box::new(e) as _)
        }
    }
}

fn build_account_event(program: String, update: AccountUpdate) -> RawAccountEvent {
    use base64::Engine;

    let account = update.account.as_ref().map(|acc| AccountInfo {
        pubkey: encode_base58(&acc.pubkey),
        owner: encode_base58(&acc.owner),
        lamports: acc.lamports,
        rent_epoch: acc.rent_epoch,
        executable: acc.executable,
        write_version: acc.write_version,
        txn_signature: acc.txn_signature.as_ref().map(|sig| encode_base58(sig)),
        data: base64::engine::general_purpose::STANDARD.encode(&acc.data),
    });

    RawAccountEvent {
        program,
        slot: update.slot,
        is_startup: update.is_startup,
        account,
    }
}

fn build_transaction_event(
    update: &TransactionUpdate,
    parsed_instructions: Vec<DecodedInstruction>,
    parsed_events: Vec<ParsedEvent>,
    subscription_id: Option<String>,
) -> RawTransactionEvent {
    use base64::Engine;

    let SubscribeUpdateTransactionInfo {
        signature,
        is_vote,
        transaction,
        meta,
        index,
    } = update.transaction.clone().unwrap_or_default();

    let sig_b58 = encode_base58(&signature);

    let message = transaction.and_then(|t| t.message).unwrap_or_default();
    let header = message.header.unwrap_or_default();

    let tx_message = TxMessage {
        header: TxMessageHeader {
            num_required_signatures: header.num_required_signatures,
            num_readonly_signed_accounts: header.num_readonly_signed_accounts,
            num_readonly_unsigned_accounts: header.num_readonly_unsigned_accounts,
        },
        account_keys: message
            .account_keys
            .into_iter()
            .map(|k| encode_base58(&k))
            .collect(),
        recent_blockhash: encode_base58(&message.recent_blockhash),
        instructions: message
            .instructions
            .into_iter()
            .map(|ix| TxCompiledInstruction {
                program_id_index: ix.program_id_index,
                accounts: ix.accounts,
                data_base64: base64::engine::general_purpose::STANDARD.encode(ix.data),
            })
            .collect(),
        versioned: message.versioned,
        address_table_lookups: message
            .address_table_lookups
            .into_iter()
            .map(|l| TxMessageAddressTableLookup {
                account_key: encode_base58(&l.account_key),
                writable_indexes: l.writable_indexes,
                readonly_indexes: l.readonly_indexes,
            })
            .collect(),
    };

    let meta = meta.unwrap_or_default();
    let err_base64 = meta
        .err
        .as_ref()
        .and_then(|e| {
            if e.err.is_empty() {
                None
            } else {
                Some(base64::engine::general_purpose::STANDARD.encode(&e.err))
            }
        });
    let return_data = meta.return_data.as_ref().map(|rd| ReturnData {
        program_id: encode_base58(&rd.program_id),
        data_base64: base64::engine::general_purpose::STANDARD.encode(rd.data.clone()),
    });

    let pre_token_balances = meta
        .pre_token_balances
        .into_iter()
        .map(|tb| TokenBalance {
            account_index: tb.account_index,
            mint: tb.mint,
            owner: tb.owner,
            program_id: tb.program_id,
            ui_amount: tb.ui_token_amount.as_ref().map(|a| a.ui_amount),
            decimals: tb.ui_token_amount.as_ref().map(|a| a.decimals).unwrap_or(0),
            amount: tb
                .ui_token_amount
                .as_ref()
                .map(|a| a.amount.clone())
                .unwrap_or_default(),
            ui_amount_string: tb
                .ui_token_amount
                .as_ref()
                .map(|a| a.ui_amount_string.clone())
                .unwrap_or_default(),
        })
        .collect();

    let post_token_balances = meta
        .post_token_balances
        .into_iter()
        .map(|tb| TokenBalance {
            account_index: tb.account_index,
            mint: tb.mint,
            owner: tb.owner,
            program_id: tb.program_id,
            ui_amount: tb.ui_token_amount.as_ref().map(|a| a.ui_amount),
            decimals: tb.ui_token_amount.as_ref().map(|a| a.decimals).unwrap_or(0),
            amount: tb
                .ui_token_amount
                .as_ref()
                .map(|a| a.amount.clone())
                .unwrap_or_default(),
            ui_amount_string: tb
                .ui_token_amount
                .as_ref()
                .map(|a| a.ui_amount_string.clone())
                .unwrap_or_default(),
        })
        .collect();

    let tx_meta = TxMeta {
        fee: meta.fee,
        pre_balances: meta.pre_balances,
        post_balances: meta.post_balances,
        log_messages: meta.log_messages,
        compute_units_consumed: meta.compute_units_consumed,
        cost_units: meta.cost_units,
        err_base64,
        pre_token_balances,
        post_token_balances,
        loaded_writable_addresses: meta
            .loaded_writable_addresses
            .into_iter()
            .map(|k| encode_base58(&k))
            .collect(),
        loaded_readonly_addresses: meta
            .loaded_readonly_addresses
            .into_iter()
            .map(|k| encode_base58(&k))
            .collect(),
        return_data,
    };

    RawTransactionEvent {
        slot: update.slot,
        signature: sig_b58,
        is_vote,
        index,
        message: tx_message,
        meta: tx_meta,
        parsed_instructions,
        parsed_events,
        subscription_id,
    }
}

fn slot_status_name(code: i32) -> String {
    SlotStatus::try_from(code)
        .map(|s| format!("{s:?}"))
        .unwrap_or_else(|_| format!("Unknown({code})"))
}

fn encode_base58(bytes: &[u8]) -> String {
    bs58::encode(bytes).into_string()
}

fn parse_pubkey(s: &str) -> Result<VixenPubkey> {
    let decoded = bs58::decode(s)
        .into_vec()
        .map_err(|e| anyhow!("failed to decode base58 pubkey: {e}"))?;
    if decoded.len() != 32 {
        return Err(anyhow!("pubkey must be 32 bytes, got {}", decoded.len()));
    }
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&decoded);
    Ok(VixenPubkey::new(bytes))
}

#[derive(Debug, Clone)]
struct SlotWindowTracker {
    inner: Arc<SlotWindowTrackerInner>,
}

#[derive(Debug)]
struct SlotWindowTrackerInner {
    window: u64,
    output_path: PathBuf,
    start_slot_override: Option<u64>,
    state: Mutex<SlotWindowState>,
}

#[derive(Debug, Default)]
struct SlotWindowState {
    start_slot: Option<u64>,
    start_time_wall: Option<std::time::SystemTime>,
    start_time_monotonic: Option<std::time::Instant>,
    processed: u64,
    done: bool,
}

impl SlotWindowTracker {
    fn new(window: u64, output_path: PathBuf, start_slot_override: Option<u64>) -> Self {
        Self {
            inner: Arc::new(SlotWindowTrackerInner {
                window,
                output_path,
                start_slot_override,
                state: Mutex::new(SlotWindowState::default()),
            }),
        }
    }
}

impl Handler<SlotUpdate> for SlotWindowTracker {
    fn handle(
        &self,
        update: &SlotUpdate,
    ) -> impl std::future::Future<Output = HandlerResult<()>> + Send {
        let inner = Arc::clone(&self.inner);
        let slot = update.slot;
        let is_dead = update.dead_error.clone();
        async move {
            let mut state = inner.state.lock().await;

            if state.done {
                return Ok(());
            }

            if let Some(min_slot) = inner.start_slot_override {
                if slot < min_slot {
                    return Ok(());
                }
            }

            if state.start_slot.is_none() {
                state.start_slot = Some(slot);
                state.start_time_wall = Some(std::time::SystemTime::now());
                state.start_time_monotonic = Some(std::time::Instant::now());
                state.processed = 0;
            }

            state.processed += 1;
            let processed = state.processed;
            let start_slot = state.start_slot.unwrap_or(slot);

            if processed >= inner.window {
                state.done = true;
                let wall_start = state
                    .start_time_wall
                    .unwrap_or_else(std::time::SystemTime::now);
                let monotonic_start = state
                    .start_time_monotonic
                    .unwrap_or_else(std::time::Instant::now);
                drop(state);

                let wall_end = std::time::SystemTime::now();
                let duration = monotonic_start.elapsed();
                let duration_secs = duration.as_secs_f64();
                let start_secs = wall_start
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs_f64())
                    .unwrap_or(0.0);
                let end_secs = wall_end
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs_f64())
                    .unwrap_or(0.0);

                let payload = json!({
                    "start_slot": start_slot,
                    "end_slot": slot,
                    "slots_processed": processed,
                    "duration_seconds": duration_secs,
                    "start_time": start_secs,
                    "end_time": end_secs,
                    "last_dead_error": is_dead,
                });

                let data = serde_json::to_vec_pretty(&payload)
                    .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;
                tokio_fs::write(&inner.output_path, data)
                    .await
                    .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;
            }

            Ok(())
        }
    }
}

pub fn load_config(path: &PathBuf) -> Result<AppConfig> {
    let raw = fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    let cfg = toml::from_str(&raw).with_context(|| format!("parsing {}", path.display()))?;
    Ok(cfg)
}

pub fn parse_config_str(raw: &str) -> Result<AppConfig> {
    let cfg = toml::from_str(raw).context("parsing Vixen TOML config")?;
    Ok(cfg)
}
