use std::borrow::Cow;

use anyhow::{Result, anyhow};
use tokio::sync::mpsc;
use yellowstone_grpc_proto::geyser::{SlotStatus, SubscribeUpdateTransactionInfo};
use yellowstone_vixen::handler::{Handler, HandlerResult};
use yellowstone_vixen::vixen_core::{
    AccountUpdate, ParseResult, Parser as VixenParser, Prefilter, SlotUpdate, TransactionUpdate,
    instruction::InstructionUpdate,
};
use yellowstone_vixen_core::Pubkey as VixenPubkey;

use crate::events::{
    AccountInfo, ParsedEvent, RawAccountEvent, RawEventEvent, RawInstructionEvent,
    RawTransactionEvent, ReturnData, SlotEvent, StreamEvent, TokenBalance, TxCompiledInstruction,
    TxMessage, TxMessageAddressTableLookup, TxMessageHeader, TxMeta,
};
use crate::idl::{DecodedInstruction, EventDecoder, InstructionDecoder};

#[derive(Debug, Clone, Copy)]
pub struct SlotPassthroughParser;

impl VixenParser for SlotPassthroughParser {
    type Input = SlotUpdate;
    type Output = SlotUpdate;

    fn id(&self) -> Cow<'static, str> {
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
pub struct SlotMetricsPassthroughParser;

impl VixenParser for SlotMetricsPassthroughParser {
    type Input = SlotUpdate;
    type Output = SlotUpdate;

    fn id(&self) -> Cow<'static, str> {
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
pub struct RawAccountPassthroughParser {
    program_id: VixenPubkey,
    program_id_str: String,
}

impl RawAccountPassthroughParser {
    #[allow(dead_code)]
    pub fn new(program_address: &str) -> Result<Self> {
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

    fn id(&self) -> Cow<'static, str> {
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
pub struct RawAccountForwarder {
    sender: mpsc::Sender<StreamEvent>,
    program_id: String,
}

impl RawAccountForwarder {
    #[allow(dead_code)]
    pub fn new(sender: mpsc::Sender<StreamEvent>, program_id: String) -> Self {
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
pub struct RawInstructionForwarder {
    sender: mpsc::Sender<StreamEvent>,
    instruction_decoder: Option<InstructionDecoder>,
    event_decoder: Option<EventDecoder>,
    event_subscriptions: Vec<EventSubscription>,
}

impl RawInstructionForwarder {
    pub fn new(
        sender: mpsc::Sender<StreamEvent>,
        instruction_decoder: Option<InstructionDecoder>,
        event_decoder: Option<EventDecoder>,
        event_subscriptions: Vec<EventSubscription>,
    ) -> Self {
        Self {
            sender,
            instruction_decoder,
            event_decoder,
            event_subscriptions,
        }
    }

    pub fn decode_instruction_only(
        &self,
        update: &InstructionUpdate,
    ) -> Option<DecodedInstruction> {
        let decoder = self.instruction_decoder.as_ref()?;
        decoder.decode(&update.data).ok()
    }

    pub fn decode_events_only(
        &self,
        update: &InstructionUpdate,
        instruction_index: u32,
    ) -> Vec<ParsedEvent> {
        let mut events = Vec::new();
        let decoder = match self.event_decoder.as_ref() {
            Some(decoder) => decoder,
            None => return events,
        };

        if let Ok(decoded_events) = decoder.decode_from_instruction_data(&update.data) {
            for event in decoded_events {
                events.push(ParsedEvent {
                    index: instruction_index,
                    name: event.name,
                    params: event.params,
                });
            }
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

    async fn forward_instruction(
        &self,
        update: &InstructionUpdate,
        instruction_index: Option<u32>,
    ) -> HandlerResult<()> {
        use base64::Engine as _;

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
                if let Ok(events) = decoder.decode_from_instruction_data(&main_data) {
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
            }
        }

        let decoded = instruction_decoder
            .as_ref()
            .and_then(|d| d.decode(&main_data).ok());

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
pub struct RawTransactionPassthroughParser {
    program_id: VixenPubkey,
    program_id_str: String,
}

impl RawTransactionPassthroughParser {
    pub fn new(program_address: &str) -> Result<Self> {
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

    fn id(&self) -> Cow<'static, str> {
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
pub struct RawTransactionForwarder {
    sender: mpsc::Sender<StreamEvent>,
    instruction_forwarder: Option<RawInstructionForwarder>,
    transaction_subscriptions: Vec<TransactionSubscription>,
}

impl RawTransactionForwarder {
    pub fn new(
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
                            parsed_events
                                .extend(forwarder.decode_events_only(&instruction, idx as u32));
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
                        .filter(|ix| {
                            subscription
                                .instruction_name_filters
                                .iter()
                                .any(|filter| filter.eq_ignore_ascii_case(&ix.name))
                        })
                        .collect()
                };

                if !instructions.is_empty() || subscription.instruction_name_filters.is_empty() {
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
pub struct SlotEventForwarder {
    sender: mpsc::Sender<StreamEvent>,
}

impl SlotEventForwarder {
    pub fn new(sender: mpsc::Sender<StreamEvent>) -> Self {
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

#[derive(Debug, Clone)]
pub(crate) struct EventSubscription {
    pub id: String,
    pub event_name: String,
}

#[derive(Debug, Clone)]
pub(crate) struct TransactionSubscription {
    pub id: String,
    pub instruction_name_filters: Vec<String>,
}

fn build_account_event(program: String, update: AccountUpdate) -> RawAccountEvent {
    use base64::Engine as _;

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
    use base64::Engine as _;

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
    let err_base64 = meta.err.as_ref().and_then(|e| {
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

#[derive(Debug, Clone, Default)]
pub(crate) struct ProgramSubscriptionSet {
    pub event_subscriptions: Vec<EventSubscription>,
    pub transaction_subscriptions: Vec<TransactionSubscription>,
}
