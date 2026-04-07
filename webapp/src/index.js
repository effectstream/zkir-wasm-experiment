/**
 * index.js — Main entry point for the Compact Compiler + ZKIR Keygen webapp
 */

import { compileCompact } from './compiler.js';
import { generateKeys, createS3ParamsProvider, getCircuitK, jsonIrToBinary } from './keygen.js';

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

// UI Elements
const sourceInput = document.getElementById('source-input');
const compileBtn = document.getElementById('compile-btn');
const keygenBtn = document.getElementById('keygen-btn');
const logOutput = document.getElementById('log-output');
const resultOutput = document.getElementById('result-output');
const downloadSection = document.getElementById('download-section');

// State
let compiledResult = null;

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

// Load example
sourceInput.value = COUNTER_EXAMPLE;

// Compile handler
compileBtn.addEventListener('click', async () => {
    clearLog();
    compiledResult = null;
    keygenBtn.disabled = true;
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

// Keygen handler
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

        log('Done! Download links available.');
    } catch (err) {
        log(`ERROR: ${err.message}`);
    } finally {
        keygenBtn.disabled = false;
        keygenBtn.textContent = 'Generate Keys';
    }
});
