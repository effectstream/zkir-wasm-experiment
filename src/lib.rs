use js_sys::{Array, Map, Uint8Array};
use serialize::{tagged_deserialize, tagged_serialize};
use transient_crypto::proofs::Zkir as ZkirTrait;
use wasm_bindgen::prelude::*;
use zkir::IrSource;

mod provider;
use provider::{JsParamsProvider, JsProgressCallback};

/// Initialize panic hook for better error messages in the browser console.
#[wasm_bindgen]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// Result of key generation containing serialized prover and verifier keys.
#[wasm_bindgen]
#[derive(Debug)]
pub struct KeygenResult {
    prover_key: Vec<u8>,
    verifier_key: Vec<u8>,
}

#[wasm_bindgen]
impl KeygenResult {
    #[wasm_bindgen(getter, js_name = "proverKey")]
    pub fn prover_key(&self) -> Uint8Array {
        Uint8Array::from(&self.prover_key[..])
    }

    #[wasm_bindgen(getter, js_name = "verifierKey")]
    pub fn verifier_key(&self) -> Uint8Array {
        Uint8Array::from(&self.verifier_key[..])
    }
}

/// Generate prover and verifier keys for a single circuit from serialized binary .zkir data.
///
/// `zkir_bytes` - serialized IrSource (binary format, as produced by `tagged_serialize`)
/// `provider` - JS object implementing `{ getParams(k: number): Promise<Uint8Array> }`
#[wasm_bindgen]
pub async fn keygen(zkir_bytes: Uint8Array, provider: JsValue) -> Result<KeygenResult, JsError> {
    let ir: IrSource = tagged_deserialize(&mut &zkir_bytes.to_vec()[..])
        .map_err(|e| JsError::new(&format!("failed to deserialize zkir: {e}")))?;
    keygen_ir(&ir, &JsParamsProvider(provider)).await
}

/// Generate prover and verifier keys for a single circuit from JSON .zkir data.
///
/// `json` - JSON string of the .zkir circuit definition
/// `provider` - JS object implementing `{ getParams(k: number): Promise<Uint8Array> }`
#[wasm_bindgen(js_name = "keygenFromJson")]
pub async fn keygen_from_json(json: &str, provider: JsValue) -> Result<KeygenResult, JsError> {
    let ir = IrSource::load(json.as_bytes())
        .map_err(|e| JsError::new(&format!("failed to parse zkir JSON: {e}")))?;
    keygen_ir(&ir, &JsParamsProvider(provider)).await
}

/// Internal keygen implementation shared by `keygen` and `keygen_from_json`.
async fn keygen_ir(
    ir: &IrSource,
    params: &JsParamsProvider,
) -> Result<KeygenResult, JsError> {
    let (pk, vk) = ir
        .keygen(params)
        .await
        .map_err(|e| JsError::new(&format!("keygen failed: {e}")))?;

    let mut pk_buf = Vec::new();
    tagged_serialize(&pk, &mut pk_buf)
        .map_err(|e| JsError::new(&format!("failed to serialize prover key: {e}")))?;

    let mut vk_buf = Vec::new();
    tagged_serialize(&vk, &mut vk_buf)
        .map_err(|e| JsError::new(&format!("failed to serialize verifier key: {e}")))?;

    Ok(KeygenResult {
        prover_key: pk_buf,
        verifier_key: vk_buf,
    })
}

/// Batch key generation for multiple circuits (equivalent to `zkir compile-many`).
///
/// `entries` - JS Array of `{ name: string, zkir: Uint8Array }` objects
/// `provider` - JS object implementing `{ getParams(k: number): Promise<Uint8Array> }`
/// `progress` - Optional JS object implementing `{ onProgress(name: string, current: number, total: number): void }`
///
/// Returns a JS `Map<string, KeygenResult>`.
#[wasm_bindgen(js_name = "keygenMany")]
pub async fn keygen_many(
    entries: JsValue,
    provider: JsValue,
    progress: JsValue,
) -> Result<Map, JsError> {
    let entries = entries
        .dyn_into::<Array>()
        .map_err(|_| JsError::new("entries must be an Array"))?;

    let total = entries.length();
    let params = JsParamsProvider(provider);
    let progress_cb = JsProgressCallback(progress);
    let results = Map::new();

    for i in 0..total {
        let entry = entries.get(i);

        let name = js_sys::Reflect::get(&entry, &"name".into())
            .map_err(|_| JsError::new("entry missing 'name' property"))?
            .as_string()
            .ok_or_else(|| JsError::new("entry 'name' must be a string"))?;

        let zkir_bytes = js_sys::Reflect::get(&entry, &"zkir".into())
            .map_err(|_| JsError::new("entry missing 'zkir' property"))?
            .dyn_into::<Uint8Array>()
            .map_err(|_| JsError::new("entry 'zkir' must be a Uint8Array"))?;

        let ir: IrSource = tagged_deserialize(&mut &zkir_bytes.to_vec()[..])
            .map_err(|e| JsError::new(&format!("failed to deserialize zkir for '{name}': {e}")))?;

        let result = keygen_ir(&ir, &params).await?;

        results.set(&JsValue::from(&name), &JsValue::from(result));

        progress_cb.on_progress(&name, i + 1, total);
    }

    Ok(results)
}

/// Get the k value (circuit size parameter) from serialized binary .zkir data.
#[wasm_bindgen(js_name = "getCircuitK")]
pub fn get_circuit_k(zkir_bytes: Uint8Array) -> Result<u8, JsError> {
    let ir: IrSource = tagged_deserialize(&mut &zkir_bytes.to_vec()[..])
        .map_err(|e| JsError::new(&format!("failed to deserialize zkir: {e}")))?;
    Ok(ir.k())
}

/// Get the k value from JSON .zkir data.
#[wasm_bindgen(js_name = "getCircuitKFromJson")]
pub fn get_circuit_k_from_json(json: &str) -> Result<u8, JsError> {
    let ir = IrSource::load(json.as_bytes())
        .map_err(|e| JsError::new(&format!("failed to parse zkir JSON: {e}")))?;
    Ok(ir.k())
}

/// Convert JSON .zkir to serialized binary format.
#[wasm_bindgen(js_name = "jsonIrToBinary")]
pub fn json_ir_to_binary(json: &str) -> Result<Uint8Array, JsError> {
    let ir = IrSource::load(json.as_bytes())
        .map_err(|e| JsError::new(&format!("failed to parse zkir JSON: {e}")))?;
    let mut buf = Vec::new();
    tagged_serialize(&ir, &mut buf)
        .map_err(|e| JsError::new(&format!("failed to serialize: {e}")))?;
    Ok(Uint8Array::from(&buf[..]))
}
