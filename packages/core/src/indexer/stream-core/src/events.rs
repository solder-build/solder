use serde::Serialize;
use serde_json::Value as JsonValue;

use crate::idl::{DecodedEvent, DecodedInstruction};

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
