use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
};

use anyhow::{Result, anyhow};
use clap::Args;
use serde::de::DeserializeOwned;
use tokio::sync::mpsc;
use yellowstone_vixen::{
    Runtime, builder::RuntimeBuilder, config::VixenConfig, handler::Pipeline, sources::SourceTrait,
};
use yellowstone_vixen_yellowstone_fumarole_source::YellowstoneFumaroleSource;
use yellowstone_vixen_yellowstone_grpc_source::YellowstoneGrpcSource;

use crate::config::{AppConfig, MetricsConfig, PipelineConfig};
use crate::events::StreamEvent;
use crate::forwarders::{
    EventSubscription, ProgramSubscriptionSet, RawInstructionForwarder, RawTransactionForwarder,
    RawTransactionPassthroughParser, SlotEventForwarder, SlotMetricsPassthroughParser,
    SlotPassthroughParser, TransactionSubscription,
};
use crate::idl::{IdlConfig, IdlRegistry};
use crate::slot_window::SlotWindowTracker;

pub async fn run_with_sender(
    config: AppConfig,
    config_path: Option<&PathBuf>,
    sender: mpsc::Sender<StreamEvent>,
) -> Result<()> {
    match config {
        AppConfig::Fumarole(inner) => {
            run_with_source::<YellowstoneFumaroleSource>(
                inner.vixen,
                inner.pipeline,
                inner.metrics,
                config_path,
                sender,
            )
            .await
        }
        AppConfig::Grpc(inner) => {
            run_with_source::<YellowstoneGrpcSource>(
                inner.vixen,
                inner.pipeline,
                inner.metrics,
                config_path,
                sender,
            )
            .await
        }
    }
}

pub struct PipelineOutputs<S: SourceTrait> {
    pub builder: RuntimeBuilder<S>,
    pub slot_window_tracker: Option<SlotWindowTracker>,
}

async fn run_with_source<S>(
    vixen: VixenConfig<S::Config>,
    pipeline: PipelineConfig,
    metrics: MetricsConfig,
    config_path: Option<&PathBuf>,
    sender: mpsc::Sender<StreamEvent>,
) -> Result<()>
where
    S: SourceTrait,
    S::Config: Args + DeserializeOwned + std::fmt::Debug,
{
    let PipelineOutputs {
        mut builder,
        slot_window_tracker,
    } = build_pipelines(
        Runtime::<S>::builder(),
        &pipeline,
        config_path,
        sender.clone(),
        &metrics,
    )?;

    if let Some(tracker) = slot_window_tracker {
        builder = builder.slot(Pipeline::new(SlotMetricsPassthroughParser, [tracker]));
    }

    let runtime = builder.build(vixen);

    runtime
        .try_run_async()
        .await
        .map_err(|e| anyhow!("runtime terminated: {e}"))
}

pub fn build_pipelines<S: SourceTrait>(
    mut builder: RuntimeBuilder<S>,
    pipeline: &PipelineConfig,
    config_path: Option<&PathBuf>,
    sender: mpsc::Sender<StreamEvent>,
    metrics: &MetricsConfig,
) -> Result<PipelineOutputs<S>> {
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
        entry
            .transaction_subscriptions
            .push(TransactionSubscription {
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
                tracing::warn!("Failed to load IDL from {}: {}", resolved_path.display(), e);
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
