/**
 * index.js — Main entry point for the Compact Compiler + ZKIR Keygen webapp
 */

import { compileCompact } from './compiler.js';
import { generateKeys, createS3ParamsProvider, getCircuitK, jsonIrToBinary } from './keygen.js';
import { discoverWallets, connectWallet, buildProviders, loadContractModule, deploy, callCircuit, readLedgerState } from './deploy.js';

const COUNTER_EXAMPLE = `import CompactStandardLibrary;

export ledger c: Counter;

export circuit increment(amount: Uint<16>): [] {
  return c.increment(disclose(amount));
}

export circuit decrement(amount: Uint<16>): [] {
  return c.decrement(disclose(amount));
}

export circuit read(): Uint<64> {
  return c.read();
}

export circuit reset_to_default(): [] {
  return c.resetToDefault();
}`;

const SHIELDED_MINT_EXAMPLE = `// SPDX-License-Identifier: MIT
pragma language_version >= 0.18.0;

import CompactStandardLibrary;

// Shielded minting authority: mints a shielded coin to the caller's
// public key. domain_sep namespaces the token type; nonce is evolved
// so each mint produces a unique coin.
export circuit mint_shielded(
  domain_sep: Bytes<32>,
  amount: Uint<64>,
  nonce: Uint<128>,
): ShieldedCoinInfo {
  return mintShieldedToken(
    disclose(domain_sep),
    disclose(amount),
    evolveNonce(disclose(nonce), disclose(domain_sep)),
    left<ZswapCoinPublicKey, ContractAddress>(ownPublicKey())
  );
}`;

const UNSHIELDED_MINT_EXAMPLE = `// SPDX-License-Identifier: MIT
pragma language_version >= 0.18.0;

import CompactStandardLibrary;

// Unshielded minting authority: mints an unshielded token to a public
// user address. domain_sep namespaces the token type.
export circuit mint_unshielded(
  domainSep: Bytes<32>,
  amount: Uint<64>,
  recipient: UserAddress
): Bytes<32> {
  return mintUnshieldedToken(
    disclose(domainSep),
    disclose(amount),
    right<ContractAddress, UserAddress>(disclose(recipient))
  );
}`;

// Selectable editor templates, keyed by the <option> values in index.html.
const EXAMPLES = {
    counter: COUNTER_EXAMPLE,
    mint_shielded: SHIELDED_MINT_EXAMPLE,
    mint_unshielded: UNSHIELDED_MINT_EXAMPLE,
};

// UI Elements
const sourceInput = document.getElementById('source-input');
const exampleSelect = document.getElementById('example-select');
const compileBtn = document.getElementById('compile-btn');
const keygenBtn = document.getElementById('keygen-btn');
const logOutput = document.getElementById('log-output');
const logPanel = document.getElementById('log-panel');
const logToggle = document.getElementById('log-toggle');
const logToggleLabel = document.getElementById('log-toggle-label');
const resultOutput = document.getElementById('result-output');
const downloadSection = document.getElementById('download-section');

// Deploy UI elements
const deploySection = document.getElementById('deploy-section');
const networkSelect = document.getElementById('network-select');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const deployBtn = document.getElementById('deploy-btn');
const walletDot = document.getElementById('wallet-dot');
const walletLabel = document.getElementById('wallet-label');
const deployResult = document.getElementById('deploy-result');
const contractAddressEl = document.getElementById('contract-address');

// Interact UI elements
const interactSection = document.getElementById('interact-section');
const circuitsList = document.getElementById('circuits-list');
const readStateBtn = document.getElementById('read-state-btn');
const ledgerStateEl = document.getElementById('ledger-state');

// State
let compiledResult = null;
let generatedKeys = null;       // Map<string, {proverKey, verifierKey}>
let binaryZkirMap = null;       // Map<string, Uint8Array>
let connectedAPI = null;
let selectedWalletAPI = null;
let deployedProviders = null;    // MidnightProviders after deployment
let deployedCompiledContract = null;  // CompiledContract after deployment
let deployedAddress = null;      // contract address after deployment
let contractModule = null;       // dynamically loaded contract module

function log(msg) {
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logOutput.appendChild(line);
    logOutput.scrollTop = logOutput.scrollHeight;
}

function clearLog() {
    logOutput.innerHTML = '';
}

function showResult(html) {
    resultOutput.innerHTML = html;
}

/** Create a download link element */
function downloadLink(filename, data, mimeType = 'application/octet-stream') {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const size = data.length || data.byteLength || 0;
    let sizeStr;
    if (size >= 1024 * 1024) sizeStr = `${(size / 1024 / 1024).toFixed(1)} MB`;
    else if (size >= 1024) sizeStr = `${(size / 1024).toFixed(1)} KB`;
    else sizeStr = `${size} B`;
    return `<a href="${url}" download="${filename}">${filename}</a> <span class="file-size">(${sizeStr})</span>`;
}

// ---------------------------------------------------------------------------
// Deploy state helpers
// ---------------------------------------------------------------------------

function enableDeploySection() {
    deploySection.classList.remove('disabled');
    connectBtn.disabled = false;
}

function disableDeploySection() {
    deploySection.classList.add('disabled');
    connectBtn.disabled = true;
    deployBtn.disabled = true;
}

function setWalletConnected(name) {
    walletDot.classList.add('connected');
    walletLabel.textContent = `Connected: ${name}`;
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = '';
    networkSelect.disabled = true;
    deployBtn.disabled = false;
}

function setWalletDisconnected() {
    walletDot.classList.remove('connected');
    walletLabel.textContent = 'No wallet connected';
    connectBtn.style.display = '';
    disconnectBtn.style.display = 'none';
    networkSelect.disabled = false;
    deployBtn.disabled = true;
    connectedAPI = null;
    selectedWalletAPI = null;
    deployedProviders = null;
    deployedCompiledContract = null;
    deployedAddress = null;
    contractModule = null;
    deployResult.style.display = 'none';
    contractAddressEl.textContent = '—';
    disableInteractSection();
}

function enableInteractSection() {
    interactSection.classList.remove('disabled');
    readStateBtn.disabled = false;
}

function disableInteractSection() {
    interactSection.classList.add('disabled');
    readStateBtn.disabled = true;
    circuitsList.innerHTML = '';
    ledgerStateEl.textContent = '';
}

/**
 * Human-readable placeholder hint for a circuit argument type.
 */
function argTypeLabel(typeInfo) {
    const name = typeInfo['type-name'] || 'value';
    if (name === 'Bytes' && typeInfo.length != null) {
        return `Bytes<${typeInfo.length}>: hex or utf8:text`;
    }
    return name;
}

/**
 * Parse a user-entered string into a circuit argument value based on type info.
 */
function parseArgValue(raw, typeInfo) {
    const typeName = typeInfo['type-name'] || typeInfo.type;
    if (typeName === 'Uint' || typeName === 'Int') {
        return BigInt(raw);
    }
    if (typeName === 'Boolean') {
        return raw === 'true' || raw === '1';
    }
    if (typeName === 'Bytes') {
        // Bytes<N> must be EXACTLY N bytes on-chain. typeInfo.length carries N.
        const len = typeInfo.length;
        const trimmed = raw.trim();

        // Convenience: "utf8:..." encodes text and right-pads to width (like Compact's pad()).
        if (trimmed.startsWith('utf8:')) {
            const enc = new TextEncoder().encode(trimmed.slice(5));
            if (len != null && enc.length > len) {
                throw new Error(`Bytes<${len}>: text is ${enc.length} bytes, exceeds ${len}`);
            }
            const out = new Uint8Array(len ?? enc.length);
            out.set(enc, 0);
            return out;
        }

        // Otherwise interpret as hex (optional 0x), byte-aligned.
        const hex = trimmed.replace(/^0x/i, '');
        if (hex.length % 2 !== 0) {
            throw new Error(`Bytes<${len}>: hex "${raw}" has an odd number of digits`);
        }
        if (hex.length && !/^[0-9a-fA-F]+$/.test(hex)) {
            throw new Error(`Bytes<${len}>: "${raw}" is not valid hex (prefix with "utf8:" to enter text)`);
        }
        const decoded = hex.length
            ? new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16)))
            : new Uint8Array(0);
        if (len == null) return decoded; // no declared width — pass through
        if (decoded.length > len) {
            throw new Error(`Bytes<${len}>: got ${decoded.length} bytes, expected ${len}`);
        }
        // Right-pad shorter input with zeros to the full declared width.
        const out = new Uint8Array(len);
        out.set(decoded, 0);
        return out;
    }
    // Default: try as bigint, fall back to string
    try { return BigInt(raw); } catch { return raw; }
}

/**
 * Format a circuit result value for display.
 */
function formatResult(val) {
    if (val === undefined || val === null) return '(void)';
    if (typeof val === 'bigint') return val.toString();
    if (val instanceof Uint8Array) return '0x' + Array.from(val).map(b => b.toString(16).padStart(2, '0')).join('');
    if (Array.isArray(val) && val.length === 0) return '(ok)';
    if (typeof val === 'object') return JSON.stringify(val, (_, v) => typeof v === 'bigint' ? v.toString() : v);
    return String(val);
}

/**
 * Build the circuit interaction UI from contract-info.json metadata.
 */
function buildCircuitUI(contractInfo) {
    circuitsList.innerHTML = '';

    const circuits = contractInfo.circuits || [];
    for (const circuit of circuits) {
        if (!circuit.proof) continue; // only provable circuits

        const card = document.createElement('div');
        card.className = 'circuit-card';

        // Circuit name
        const nameEl = document.createElement('span');
        nameEl.className = 'circuit-name';
        nameEl.textContent = circuit.name;
        card.appendChild(nameEl);

        // Argument inputs
        const inputs = [];
        for (const arg of (circuit.arguments || [])) {
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = `${arg.name} (${argTypeLabel(arg.type)})`;
            input.dataset.argName = arg.name;
            input.dataset.argType = JSON.stringify(arg.type);
            card.appendChild(input);
            inputs.push({ input, type: arg.type });
        }

        // Call button
        const callBtn = document.createElement('button');
        callBtn.className = 'btn-accent';
        callBtn.textContent = 'Call';
        callBtn.addEventListener('click', async () => {
            callBtn.disabled = true;
            callBtn.textContent = 'Calling...';
            resultEl.textContent = '';
            try {
                const args = inputs.map(({ input, type }) => parseArgValue(input.value, type));
                const res = await callCircuit(
                    deployedProviders, deployedCompiledContract, deployedAddress,
                    circuit.name, args, log
                );
                resultEl.textContent = formatResult(res.result);
            } catch (err) {
                resultEl.textContent = `Error: ${err.message}`;
                resultEl.style.color = '#f85149';
                log(`Circuit "${circuit.name}" failed: ${err.message}`);
            } finally {
                callBtn.disabled = false;
                callBtn.textContent = 'Call';
                resultEl.style.color = '';
            }
        });
        card.appendChild(callBtn);

        // Result display
        const resultEl = document.createElement('span');
        resultEl.className = 'circuit-result';
        card.appendChild(resultEl);

        circuitsList.appendChild(card);
    }
}

// Example picker — seed the editor with the default and swap templates on change.
exampleSelect.value = 'counter';
sourceInput.value = EXAMPLES[exampleSelect.value];
exampleSelect.addEventListener('change', () => {
    sourceInput.value = EXAMPLES[exampleSelect.value] ?? '';
});

// Log panel toggle
logToggle.addEventListener('click', () => {
    logPanel.classList.toggle('collapsed');
    logToggleLabel.textContent = logPanel.classList.contains('collapsed') ? 'expand' : 'collapse';
});

// ---------------------------------------------------------------------------
// Compile handler
// ---------------------------------------------------------------------------
compileBtn.addEventListener('click', async () => {
    clearLog();
    compiledResult = null;
    generatedKeys = null;
    binaryZkirMap = null;
    keygenBtn.disabled = true;
    disableDeploySection();
    disableInteractSection();
    setWalletDisconnected();
    downloadSection.innerHTML = '';
    resultOutput.innerHTML = '';
    compileBtn.disabled = true;
    compileBtn.textContent = 'Compiling...';

    try {
        log('Starting compilation...');
        const startTime = performance.now();

        const result = await compileCompact(sourceInput.value, {
            filename: 'contract.compact',
            onLog: (stream, text) => log(`[${stream}] ${text}`),
        });

        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        log(`Compilation completed in ${elapsed}s`);

        compiledResult = result;

        // Build the output file tree
        const circuits = [...result.zkir.keys()].sort();
        let html = '<h3>Output</h3>';
        html += '<div class="file-tree">';

        // compiler/
        html += '<div class="tree-folder">compiler/</div>';
        if (result.contractInfo) {
            const json = JSON.stringify(result.contractInfo, null, 2);
            html += `<div class="tree-file indent-1">${downloadLink('contract-info.json', json, 'application/json')}</div>`;
        }

        // contract/
        html += '<div class="tree-folder">contract/</div>';
        if (result.contractJs) {
            html += `<div class="tree-file indent-1">${downloadLink('index.js', result.contractJs, 'application/javascript')}</div>`;
        }
        if (result.contractDts) {
            html += `<div class="tree-file indent-1">${downloadLink('index.d.ts', result.contractDts, 'application/typescript')}</div>`;
        }

        // keys/ (placeholder — generated after keygen)
        html += '<div class="tree-folder">keys/ <span class="file-size">(click Generate Keys)</span></div>';
        html += '<div id="keys-tree"></div>';

        // zkir/
        html += '<div class="tree-folder">zkir/</div>';
        for (const name of circuits) {
            const json = result.zkir.get(name);
            html += `<div class="tree-file indent-1">${downloadLink(`${name}.zkir`, json, 'application/json')}`;

            // Also generate .bzkir
            try {
                const bzkir = await jsonIrToBinary(json);
                html += ` ${downloadLink(`${name}.bzkir`, bzkir)}`;
            } catch (e) {
                // binary conversion not critical
            }

            // Show k value
            try {
                const k = await getCircuitK(json);
                html += ` <span class="file-size">k=${k}</span>`;
            } catch (e) {}

            html += '</div>';
        }

        html += '</div>';
        showResult(html);
        keygenBtn.disabled = false;
        log('Ready for key generation.');
    } catch (err) {
        log(`ERROR: ${err.message}`);
        showResult(`<pre style="color: #f85149;">${err.message}</pre>`);
    } finally {
        compileBtn.disabled = false;
        compileBtn.textContent = 'Compile';
    }
});

// ---------------------------------------------------------------------------
// Keygen handler
// ---------------------------------------------------------------------------
keygenBtn.addEventListener('click', async () => {
    if (!compiledResult) return;

    keygenBtn.disabled = true;
    keygenBtn.textContent = 'Generating Keys...';

    try {
        log('Starting key generation...');
        log('SRS parameters will be downloaded from S3 (may take a moment for first circuit)');

        const provider = createS3ParamsProvider(null, (msg) => log(msg));
        const startTime = performance.now();

        const keys = await generateKeys(compiledResult.zkir, provider, (name, current, total) => {
            log(`[${current}/${total}] Generating keys for ${name}...`);
        });

        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        log(`Key generation completed in ${elapsed}s`);

        // Store keys for deployment
        generatedKeys = keys;

        // Build binary ZKIR map for deployment
        binaryZkirMap = new Map();
        for (const [name, json] of compiledResult.zkir.entries()) {
            try {
                const binary = await jsonIrToBinary(json);
                binaryZkirMap.set(name, binary);
            } catch (e) {
                log(`Warning: could not convert ${name}.zkir to binary: ${e.message}`);
            }
        }

        // Populate the keys/ section in the file tree
        const keysTree = document.getElementById('keys-tree');
        if (keysTree) {
            let html = '';
            const sortedKeys = [...keys.entries()].sort((a, b) => a[0].localeCompare(b[0]));
            for (const [name, { proverKey, verifierKey }] of sortedKeys) {
                html += `<div class="tree-file indent-1">`;
                html += downloadLink(`${name}.prover`, proverKey);
                html += ` ${downloadLink(`${name}.verifier`, verifierKey)}`;
                html += `</div>`;
            }
            keysTree.innerHTML = html;
        }

        // Update the keys/ folder label to remove the hint
        const keysFolders = document.querySelectorAll('.tree-folder');
        for (const el of keysFolders) {
            if (el.textContent.includes('click Generate Keys')) {
                el.innerHTML = 'keys/';
                break;
            }
        }

        // Enable deploy section
        enableDeploySection();

        log('Done! Download links available. You can now deploy to a network.');
    } catch (err) {
        log(`ERROR: ${err.message}`);
    } finally {
        keygenBtn.disabled = false;
        keygenBtn.textContent = 'Generate Keys';
    }
});

// ---------------------------------------------------------------------------
// Connect Wallet handler
// ---------------------------------------------------------------------------
connectBtn.addEventListener('click', async () => {
    const wallets = discoverWallets();
    if (wallets.length === 0) {
        log('No Midnight wallet detected. Install the Lace wallet extension.');
        alert('No Midnight wallet detected. Please install the Lace wallet browser extension.');
        return;
    }

    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';

    try {
        // Use the first available wallet
        selectedWalletAPI = wallets[0];
        const networkId = networkSelect.value;

        log(`Connecting to ${selectedWalletAPI.name} on ${networkId}...`);
        connectedAPI = await connectWallet(selectedWalletAPI, networkId);
        log(`Connected to ${selectedWalletAPI.name}`);

        // Show balances
        try {
            const shieldedBalances = await connectedAPI.getShieldedBalances();
            const unshieldedBalances = await connectedAPI.getUnshieldedBalances();
            const shieldedTotal = Object.values(shieldedBalances).reduce((sum, val) => sum + val, 0n);
            const unshieldedTotal = Object.values(unshieldedBalances).reduce((sum, val) => sum + val, 0n);
            log(`Balances — Shielded: ${shieldedTotal}, Unshielded: ${unshieldedTotal}`);
        } catch (e) {
            log(`Could not fetch balances: ${e.message}`);
        }

        setWalletConnected(selectedWalletAPI.name);
    } catch (err) {
        log(`Wallet connection failed: ${err.message}`);
        alert('Failed to connect wallet: ' + err.message);
    } finally {
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect Wallet';
    }
});

// ---------------------------------------------------------------------------
// Disconnect handler
// ---------------------------------------------------------------------------
disconnectBtn.addEventListener('click', () => {
    setWalletDisconnected();
    log('Wallet disconnected.');
});

// ---------------------------------------------------------------------------
// Deploy handler
// ---------------------------------------------------------------------------
deployBtn.addEventListener('click', async () => {
    if (!connectedAPI || !compiledResult || !generatedKeys || !binaryZkirMap) return;

    deployBtn.disabled = true;
    deployBtn.textContent = 'Deploying...';

    try {
        log('Loading contract module...');
        contractModule = await loadContractModule(compiledResult.contractJs);
        log('Contract module loaded.');

        log('Building providers...');
        const providers = await buildProviders(connectedAPI, binaryZkirMap, generatedKeys, log);

        const contractName = compiledResult.contractInfo?.circuits?.[0]
            ? 'UserContract'
            : 'Contract';

        const result = await deploy(providers, contractModule, contractName, log);

        // Store for interaction
        deployedProviders = providers;
        deployedCompiledContract = result.compiledContract;
        deployedAddress = result.contractAddress;

        // Show result
        contractAddressEl.textContent = result.contractAddress;
        deployResult.style.display = '';

        // Enable interaction section
        if (compiledResult.contractInfo) {
            buildCircuitUI(compiledResult.contractInfo);
        }
        enableInteractSection();

        log('Deployment complete! You can now interact with the contract.');
    } catch (err) {
        log(`Deployment failed: ${err.message}`);
        console.error('Deploy error:', err);
    } finally {
        deployBtn.disabled = false;
        deployBtn.textContent = 'Deploy Contract';
    }
});

// ---------------------------------------------------------------------------
// Read Ledger State handler
// ---------------------------------------------------------------------------
readStateBtn.addEventListener('click', async () => {
    if (!deployedProviders || !contractModule || !deployedAddress) return;

    readStateBtn.disabled = true;
    readStateBtn.textContent = 'Reading...';
    ledgerStateEl.textContent = '';

    try {
        log('Reading ledger state...');
        const state = await readLedgerState(
            deployedProviders.publicDataProvider, contractModule, deployedAddress
        );

        if (!state) {
            ledgerStateEl.textContent = '(no state found)';
            log('No contract state found on-chain.');
        } else {
            // The ledger object uses getter properties (not enumerable).
            // Extract them via Object.getOwnPropertyDescriptors.
            const entries = {};
            const descriptors = Object.getOwnPropertyDescriptors(state);
            for (const [key, desc] of Object.entries(descriptors)) {
                if (desc.get) {
                    try {
                        const val = state[key];
                        entries[key] = typeof val === 'bigint' ? val.toString() : val;
                    } catch (e) {
                        entries[key] = `(error: ${e.message})`;
                    }
                }
            }

            ledgerStateEl.textContent = JSON.stringify(entries);
            log(`Ledger state: ${ledgerStateEl.textContent}`);
        }
    } catch (err) {
        ledgerStateEl.textContent = `Error: ${err.message}`;
        log(`Failed to read state: ${err.message}`);
    } finally {
        readStateBtn.disabled = false;
        readStateBtn.textContent = 'Read Ledger State';
    }
});
