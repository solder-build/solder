use std::sync::OnceLock;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{
    ErrorStrategy, ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode,
};
use napi_derive::napi;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use vixen_indexer::{run_with_sender, AppConfig, DEFAULT_CHANNEL_CAPACITY};

static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();

type EventTsfn = ThreadsafeFunction<String, ErrorStrategy::CalleeHandled>;

fn get_runtime() -> napi::Result<&'static tokio::runtime::Runtime> {
    if let Some(rt) = RUNTIME.get() {
        return Ok(rt);
    }

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| Error::from_reason(format!("failed to create tokio runtime: {e}")))?;

    RUNTIME
        .set(runtime)
        .map_err(|_| Error::from_reason("tokio runtime already initialised".to_string()))?;

    Ok(RUNTIME.get().expect("runtime just initialised"))
}

#[napi]
pub struct Indexer {
    runner: Option<tokio::task::JoinHandle<()>>,
    forwarder: Option<tokio::task::JoinHandle<()>>,
    tsfn: Option<EventTsfn>,
    event_tsfn: Option<EventTsfn>,
    transaction_tsfn: Option<EventTsfn>,
}

#[napi]
impl Indexer {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            runner: None,
            forwarder: None,
            tsfn: None,
            event_tsfn: None,
            transaction_tsfn: None,
        }
    }

    #[napi]
    pub fn on_event(&mut self, callback: JsFunction) -> napi::Result<()> {
        let tsfn: EventTsfn =
            callback.create_threadsafe_function(0, |ctx: ThreadSafeCallContext<String>| {
                let js_string = ctx.env.create_string(&ctx.value)?;
                Ok(vec![js_string.into_unknown()])
            })?;
        self.event_tsfn = Some(tsfn);
        Ok(())
    }

    #[napi]
    pub fn on_transaction(&mut self, callback: JsFunction) -> napi::Result<()> {
        let tsfn: EventTsfn =
            callback.create_threadsafe_function(0, |ctx: ThreadSafeCallContext<String>| {
                let js_string = ctx.env.create_string(&ctx.value)?;
                Ok(vec![js_string.into_unknown()])
            })?;
        self.transaction_tsfn = Some(tsfn);
        Ok(())
    }

    #[napi]
    pub fn start(&mut self, config_json: serde_json::Value, callback: JsFunction) -> napi::Result<()> {
        if self.runner.is_some() {
            return Err(Error::from_reason("indexer already running".to_string()));
        }

        let config: AppConfig = serde_json::from_value(config_json)
            .map_err(|e| Error::from_reason(format!("invalid config object: {e}")))?;
        let runtime = get_runtime()?;

        let (sender, mut receiver) = mpsc::channel(DEFAULT_CHANNEL_CAPACITY);

        let tsfn: EventTsfn =
            callback.create_threadsafe_function(0, |ctx: ThreadSafeCallContext<String>| {
                let js_string = ctx.env.create_string(&ctx.value)?;
                Ok(vec![js_string.into_unknown()])
            })?;

        let tsfn_forward = tsfn.clone();
        let event_tsfn_forward = self.event_tsfn.clone();
        let transaction_tsfn_forward = self.transaction_tsfn.clone();
        let forwarder = runtime.spawn(async move {
            while let Some(event) = receiver.recv().await {
                let payload = match serde_json::to_string(&event) {
                    Ok(json) => json.clone(),
                    Err(err) => {
                        let error_payload = json!({
                            "type": "error",
                            "error": err.to_string(),
                        })
                        .to_string();
                        let _ = tsfn_forward.call(Ok(error_payload.clone()), ThreadsafeFunctionCallMode::Blocking);
                        continue;
                    }
                };

                // Always call the main callback for backward compatibility
                let status =
                    tsfn_forward.call(Ok(payload.clone()), ThreadsafeFunctionCallMode::Blocking);

                if status != Status::Ok {
                    continue;
                }

                // Route to specific callbacks based on event type
                if let Ok(parsed) = serde_json::from_str::<Value>(&payload) {
                    if let Some(event_type) = parsed.get("type").and_then(|t| t.as_str()) {
                        match event_type {
                            "event" => {
                                if let Some(ref event_tsfn) = event_tsfn_forward {
                                    let _ = event_tsfn.call(Ok(payload.clone()), ThreadsafeFunctionCallMode::Blocking);
                                }
                            }
                            "transaction" => {
                                if let Some(ref transaction_tsfn) = transaction_tsfn_forward {
                                    let _ = transaction_tsfn.call(Ok(payload.clone()), ThreadsafeFunctionCallMode::Blocking);
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }

            let _ = tsfn_forward.abort();
            if let Some(tsfn) = event_tsfn_forward {
                let _ = tsfn.abort();
            }
            if let Some(tsfn) = transaction_tsfn_forward {
                let _ = tsfn.abort();
            }
        });

        let runner = runtime.spawn_blocking(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build();

            match rt {
                Ok(rt) => {
                    if let Err(err) = rt.block_on(run_with_sender(config, None, sender)) {
                        eprintln!("vixen-indexer runtime error: {err}");
                    }
                }
                Err(err) => {
                    eprintln!("failed to create worker runtime: {err}");
                }
            }
        });

        self.tsfn = Some(tsfn);
        self.forwarder = Some(forwarder);
        self.runner = Some(runner);

        Ok(())
    }

    #[napi]
    pub fn stop(&mut self) -> napi::Result<()> {
        self.cleanup();
        Ok(())
    }
}

impl Indexer {
    fn cleanup(&mut self) {
        if let Some(handle) = self.forwarder.take() {
            handle.abort();
        }
        if let Some(handle) = self.runner.take() {
            handle.abort();
        }
        if let Some(tsfn) = self.tsfn.take() {
            let _ = tsfn.abort();
        }
        if let Some(tsfn) = self.event_tsfn.take() {
            let _ = tsfn.abort();
        }
        if let Some(tsfn) = self.transaction_tsfn.take() {
            let _ = tsfn.abort();
        }
    }
}

impl Drop for Indexer {
    fn drop(&mut self) {
        self.cleanup();
    }
}

#[napi]
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
