use std::{fs, path::PathBuf};

use anyhow::{Context, Result};
use serde::Deserialize;
use serde::de;
use serde_json::Value as JsonValue;
use yellowstone_vixen::config::VixenConfig;
use yellowstone_vixen_yellowstone_fumarole_source::FumaroleConfig;
use yellowstone_vixen_yellowstone_grpc_source::YellowstoneGrpcConfig;

use crate::idl::IdlConfig;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct AppConfigFumarole {
    #[serde(flatten)]
    pub vixen: VixenConfig<FumaroleConfig>,
    #[serde(default)]
    pub pipeline: PipelineConfig,
    #[serde(default)]
    pub metrics: MetricsConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct AppConfigGrpc {
    #[serde(flatten)]
    pub vixen: VixenConfig<YellowstoneGrpcConfig>,
    #[serde(default)]
    pub pipeline: PipelineConfig,
    #[serde(default)]
    pub metrics: MetricsConfig,
}

#[derive(Debug)]
pub enum AppConfig {
    Fumarole(AppConfigFumarole),
    Grpc(AppConfigGrpc),
}

impl<'de> Deserialize<'de> for AppConfig {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = JsonValue::deserialize(deserializer)?;
        let source_kind = value
            .get("source-kind")
            .or_else(|| value.get("source_kind"))
            .and_then(|v| v.as_str())
            .unwrap_or(SourceKind::Fumarole.label());
        let kind = SourceKind::from_label(source_kind)
            .ok_or_else(|| de::Error::custom(format!("unsupported source-kind '{source_kind}'")))?;

        match kind {
            SourceKind::Grpc => serde_json::from_value::<AppConfigGrpc>(value)
                .map(AppConfig::Grpc)
                .map_err(de::Error::custom),
            SourceKind::Fumarole => serde_json::from_value::<AppConfigFumarole>(value)
                .map(AppConfig::Fumarole)
                .map_err(de::Error::custom),
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum SourceKind {
    Fumarole,
    Grpc,
}

impl SourceKind {
    fn from_label(label: &str) -> Option<Self> {
        match label.trim().to_ascii_lowercase().as_str() {
            "" | "fumarole" => Some(SourceKind::Fumarole),
            "grpc" | "dragonmouth" | "yellowstone-grpc" | "geyser" => Some(SourceKind::Grpc),
            _ => None,
        }
    }

    const fn label(self) -> &'static str {
        match self {
            SourceKind::Fumarole => "fumarole",
            SourceKind::Grpc => "grpc",
        }
    }
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

pub fn load_config(path: &PathBuf) -> Result<AppConfig> {
    let raw = fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    let cfg = toml::from_str(&raw).with_context(|| format!("parsing {}", path.display()))?;
    Ok(cfg)
}

pub fn parse_config_str(raw: &str) -> Result<AppConfig> {
    let cfg = toml::from_str(raw).context("parsing Vixen TOML config")?;
    Ok(cfg)
}
