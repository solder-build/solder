use std::path::PathBuf;

use anyhow::{Result, anyhow};
use clap::{Parser as ClapParser, ValueEnum};
use solder::{DEFAULT_CHANNEL_CAPACITY, StreamEvent, load_config, run_with_sender};
use tokio::sync::mpsc;
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

#[derive(ClapParser, Debug)]
#[command(
    name = "solder",
    version,
    about = "Index Solana data via Yellowstone Vixen + Fumarole"
)]
struct Cli {
    #[arg(short, long, value_name = "PATH", default_value = "Vixen.toml")]
    config: PathBuf,

    #[arg(long, value_enum, default_value_t = OutputFormat::Pretty)]
    output: OutputFormat,

    #[arg(long, default_value = "info")]
    log_level: String,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum OutputFormat {
    Pretty,
    Json,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    init_tracing(&cli.log_level)?;

    let config = load_config(&cli.config)?;
    let (sender, mut receiver) = mpsc::channel(DEFAULT_CHANNEL_CAPACITY);
    let output_format = cli.output;

    println!("config: {:?}", config);

    let printer = tokio::spawn(async move {
        while let Some(event) = receiver.recv().await {
            if let Err(err) = print_event(&event, output_format) {
                eprintln!("failed to print event: {err}");
            }
        }
    });

    if let Err(err) = run_with_sender(config, Some(&cli.config), sender).await {
        eprintln!("runtime terminated with error: {err}");
    }

    let _ = printer.await;
    Ok(())
}

fn print_event(event: &StreamEvent, format: OutputFormat) -> Result<()> {
    match format {
        OutputFormat::Pretty => {
            match event {
                StreamEvent::Account { event } => {
                    let (pubkey, data_len) = event
                        .account
                        .as_ref()
                        .map(|acc| (acc.pubkey.as_str(), acc.data.len()))
                        .unwrap_or(("<none>", 0));
                    println!(
                        "[ACCOUNT] slot={} program={} pubkey={} data_len={}",
                        event.slot, event.program, pubkey, data_len
                    );
                }
                StreamEvent::Instruction { event } => {
                    println!(
                        "[INSTRUCTION] slot={} program={} signature={} accounts={} data_len={}",
                        event.slot,
                        event.program,
                        event.signature,
                        event.accounts.join(","),
                        event.data.len()
                    );
                }
                StreamEvent::Event { event } => {
                    let index_str = event
                        .index
                        .map(|i| format!(" index={}", i))
                        .unwrap_or_default();
                    println!(
                        "[EVENT] slot={} program={} signature={} name={}{} params={}",
                        event.slot,
                        event.program,
                        event.signature,
                        event.parsed.name,
                        index_str,
                        serde_json::to_string(&event.parsed.params)
                            .unwrap_or_else(|_| "{}".to_string())
                    );
                }
                StreamEvent::Transaction { event } => {
                    let parsed_names: Vec<_> = event
                        .parsed_instructions
                        .iter()
                        .map(|ix| ix.name.as_str())
                        .collect();
                    let parsed_event_entries: Vec<_> = event
                        .parsed_events
                        .iter()
                        .map(|ev| format!("{}@{}", ev.name, ev.index))
                        .collect();
                    println!(
                        "[TRANSACTION] slot={} signature={} is_vote={} instruction_count={} parsed_instructions={:?} parsed_events={:?}",
                        event.slot,
                        event.signature,
                        event.is_vote,
                        event.message.instructions.len(),
                        parsed_names,
                        parsed_event_entries
                    );
                }
                StreamEvent::Slot { event } => {
                    println!(
                        "[SLOT] slot={} status={} parent={:?}",
                        event.slot, event.status, event.parent
                    );
                }
            }
            Ok(())
        }
        OutputFormat::Json => {
            let json = serde_json::to_string(event)?;
            println!("{}", json);
            Ok(())
        }
    }
}

fn init_tracing(level: &str) -> Result<()> {
    let filter = EnvFilter::try_from_default_env()
        .or_else(|_| EnvFilter::try_new(level))
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .try_init()
        .map_err(|err| anyhow!("failed to initialize tracing: {err}"))
}
