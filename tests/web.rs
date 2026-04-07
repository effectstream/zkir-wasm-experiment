use wasm_bindgen::prelude::*;
use wasm_bindgen_test::*;

// Tests run in Node.js by default. Use `run_in_browser` for browser-specific tests.
// wasm_bindgen_test_configure!(run_in_browser);

use js_sys::{Array, Object, Uint8Array};
use midnight_zkir_keygen_wasm::*;

/// Helper: create a mock ParamsProvider that rejects (for error-path testing)
fn mock_failing_provider() -> JsValue {
    let obj = Object::new();
    let get_params = js_sys::Function::new_with_args(
        "_k",
        "return Promise.reject(new Error('mock: no SRS params available'))",
    );
    js_sys::Reflect::set(&obj, &"getParams".into(), &get_params).unwrap();
    obj.into()
}

// ---- Step 1: Deserialization tests ----

#[wasm_bindgen_test]
fn test_json_ir_to_binary_basic() {
    let json = include_str!("fixtures/basic.zkir");
    let bytes = json_ir_to_binary(json).expect("jsonIrToBinary should succeed for basic.zkir");
    assert!(bytes.length() > 0, "serialized binary should be non-empty");
}

#[wasm_bindgen_test]
fn test_get_circuit_k_from_json() {
    let json = include_str!("fixtures/basic.zkir");
    let k = get_circuit_k_from_json(json).expect("getCircuitKFromJson should succeed");
    // basic.zkir is minimal (1 input, 1 assert), k should be small
    assert!(k <= 20, "k value for basic circuit should be reasonable, got {k}");
}

#[wasm_bindgen_test]
fn test_json_ir_to_binary_roundtrip() {
    let json = include_str!("fixtures/basic.zkir");
    let binary = json_ir_to_binary(json).expect("jsonIrToBinary should succeed");
    let k_json = get_circuit_k_from_json(json).expect("getCircuitKFromJson should succeed");
    let k_binary = get_circuit_k(binary).expect("getCircuitK should succeed");
    assert_eq!(k_json, k_binary, "k value should match between JSON and binary");
}

// ---- Step 2: Error handling tests ----

#[wasm_bindgen_test]
fn test_invalid_json_returns_error() {
    let result = json_ir_to_binary("not valid json{{{");
    assert!(result.is_err(), "invalid JSON should return an error");
}

#[wasm_bindgen_test]
fn test_invalid_binary_returns_error() {
    let bad_bytes = Uint8Array::new_with_length(4);
    bad_bytes.copy_from(&[0, 1, 2, 3]);
    let result = get_circuit_k(bad_bytes);
    assert!(result.is_err(), "invalid binary should return an error");
}

#[wasm_bindgen_test]
fn test_keygen_from_json_invalid_json() {
    // Note: we can't easily test the async keygen without a real provider,
    // but we can verify JSON parsing fails synchronously before provider is called
    let result = json_ir_to_binary("{\"version\": {\"major\": 99, \"minor\": 0}}");
    assert!(result.is_err(), "unsupported version should return an error");
}

// ---- Step 3: keygen with mock provider (error path) ----

#[wasm_bindgen_test]
async fn test_keygen_from_json_with_failing_provider() {
    let json = include_str!("fixtures/basic.zkir");
    let provider = mock_failing_provider();
    let result = keygen_from_json(json, provider).await;
    assert!(result.is_err(), "keygen should fail when provider rejects");
    let err_msg = format!("{:?}", result.unwrap_err());
    assert!(
        err_msg.contains("mock: no SRS params available") || err_msg.contains("getParams"),
        "error should mention the provider failure, got: {err_msg}"
    );
}

// ---- Step 4: keygenMany entry validation ----

#[wasm_bindgen_test]
async fn test_keygen_many_empty_array() {
    let entries = Array::new();
    let provider = mock_failing_provider(); // won't be called for empty array
    let result = keygen_many(entries.into(), provider, JsValue::UNDEFINED).await;
    assert!(result.is_ok(), "keygenMany with empty array should succeed");
    let map = result.unwrap();
    assert_eq!(map.size(), 0, "result map should be empty");
}

#[wasm_bindgen_test]
async fn test_keygen_many_invalid_entry() {
    let entries = Array::new();
    // Entry without 'name' property
    let bad_entry = Object::new();
    js_sys::Reflect::set(&bad_entry, &"zkir".into(), &Uint8Array::new_with_length(0).into())
        .unwrap();
    entries.push(&bad_entry);
    let provider = mock_failing_provider();
    let result = keygen_many(entries.into(), provider, JsValue::UNDEFINED).await;
    assert!(result.is_err(), "keygenMany should fail on invalid entry");
}

// ---- Step 5: Progress callback ----

#[wasm_bindgen_test]
async fn test_keygen_many_progress_callback_on_empty() {
    let entries = Array::new();
    let provider = mock_failing_provider();

    // Create a progress callback that records calls
    let progress = Object::new();
    let on_progress = js_sys::Function::new_with_args(
        "name, current, total",
        "if (!globalThis._progressCalls) globalThis._progressCalls = []; globalThis._progressCalls.push({name, current, total})",
    );
    js_sys::Reflect::set(&progress, &"onProgress".into(), &on_progress).unwrap();

    let result = keygen_many(entries.into(), provider, progress.into()).await;
    assert!(result.is_ok(), "keygenMany with empty array should succeed");
    // No progress calls expected for empty array
}
