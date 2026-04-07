use js_sys::{Function, JsString, Promise, Uint8Array};
use transient_crypto::proofs::{ParamsProver, ParamsProverProvider};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

/// Wraps a JS object implementing `{ getParams(k: number): Promise<Uint8Array> }`
pub struct JsParamsProvider(pub JsValue);

fn try_to_string(jsv: JsValue) -> String {
    let res = js_sys::Reflect::get(&jsv, &"toString".into())
        .and_then(|f| f.dyn_into::<Function>())
        .and_then(|f| f.call0(&jsv))
        .and_then(|s| s.dyn_into::<JsString>());
    match res {
        Ok(s) => s.into(),
        Err(_) => "<failed to stringify>".into(),
    }
}

fn err(msg: impl Into<String>) -> std::io::Error {
    std::io::Error::other(msg.into())
}

impl ParamsProverProvider for JsParamsProvider {
    async fn get_params(&self, k: u8) -> std::io::Result<ParamsProver> {
        let get_params = js_sys::Reflect::get(&self.0, &"getParams".into())
            .map_err(|_| err("could not get property 'getParams' on ParamsProvider"))?
            .dyn_into::<Function>()
            .map_err(|_| err("property 'getParams' on ParamsProvider is not a function"))?;
        let promise = get_params
            .call1(&self.0, &JsValue::from(k))
            .map_err(|e| err(format!("error calling getParams: {}", try_to_string(e))))?
            .dyn_into::<Promise>()
            .map_err(|_| err("result of getParams was not a promise"))?;
        let res = JsFuture::from(promise)
            .await
            .map_err(|e| {
                err(format!(
                    "getParams promise resolved to error: {}",
                    try_to_string(e)
                ))
            })?
            .dyn_into::<Uint8Array>()
            .map_err(|_| err("result of getParams was not a Uint8Array"))?
            .to_vec();
        ParamsProver::read(&res[..])
    }
}

/// Wraps a JS object implementing `{ onProgress(name: string, current: number, total: number): void }`
pub struct JsProgressCallback(pub JsValue);

impl JsProgressCallback {
    pub fn is_valid(&self) -> bool {
        !self.0.is_undefined() && !self.0.is_null()
    }

    pub fn on_progress(&self, name: &str, current: u32, total: u32) {
        if !self.is_valid() {
            return;
        }
        let on_progress = js_sys::Reflect::get(&self.0, &"onProgress".into())
            .and_then(|f| f.dyn_into::<Function>());
        if let Ok(f) = on_progress {
            let _ = f.call3(
                &self.0,
                &JsValue::from(name),
                &JsValue::from(current),
                &JsValue::from(total),
            );
        }
    }
}
