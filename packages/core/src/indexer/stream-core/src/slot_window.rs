use std::{path::PathBuf, sync::Arc};

use serde_json::json;
use tokio::{fs as tokio_fs, sync::Mutex};
use yellowstone_vixen::handler::{Handler, HandlerResult};
use yellowstone_vixen::vixen_core::SlotUpdate;

#[derive(Debug, Clone)]
pub struct SlotWindowTracker {
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
    pub fn new(window: u64, output_path: PathBuf, start_slot_override: Option<u64>) -> Self {
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
