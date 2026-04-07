/**
 * compiler.js — Browser wrapper for the Compact compiler WASM module
 */

let createSchemeModule = null;

const COMPACTC_PROGRAM = `
(import (except (chezscheme) errorf)
        (config-params)
        (passes)
        (utils))

(let ([args (command-line)])
  (let loop ([a (cdr args)] [skip-zk-flag #f] [zkir-v3-flag #f] [source #f] [target #f])
    (cond
      [(null? a)
       (unless (and source target)
         (display "Usage: compactc [--skip-zk] [--feature-zkir-v3] <source> <target>\\n"
                  (console-error-port))
         (exit 1))
       (parameterize ([skip-zk skip-zk-flag]
                      [feature-zkir-v3 zkir-v3-flag])
         (generate-everything source target))
       (exit 0)]
      [(string=? (car a) "--skip-zk")
       (loop (cdr a) #t zkir-v3-flag source target)]
      [(string=? (car a) "--feature-zkir-v3")
       (loop (cdr a) skip-zk-flag #t source target)]
      [(not source)
       (loop (cdr a) skip-zk-flag zkir-v3-flag (car a) target)]
      [(not target)
       (loop (cdr a) skip-zk-flag zkir-v3-flag source (car a))]
      [else
       (display (format "Unknown argument: ~a\\n" (car a)) (console-error-port))
       (exit 1)])))
`;

/**
 * Load the Emscripten-compiled Chez Scheme module (browser version).
 */
async function loadModule() {
    if (!createSchemeModule) {
        // Emscripten MODULARIZE output is a UMD script that assigns to
        // `var createSchemeModule`. Load it via a <script> tag so it
        // executes in the global scope and exposes window.createSchemeModule.
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'scheme.js';
            script.onload = () => {
                createSchemeModule = window.createSchemeModule;
                resolve();
            };
            script.onerror = () => reject(new Error('Failed to load scheme.js'));
            document.head.appendChild(script);
        });
    }
    return createSchemeModule;
}

/**
 * Compile Compact source code to ZKIR circuits and TypeScript contract.
 *
 * @param {string} sourceCode - The Compact source code
 * @param {object} [options] - Options
 * @param {string} [options.filename='input.compact'] - Source filename
 * @param {string} [options.standardLibrary] - Standard library source
 * @param {function} [options.onLog] - Callback for compiler output
 * @returns {Promise<{zkir: Map<string,string>, contractInfo: object, contractJs: string, contractDts: string}>}
 */
export async function compileCompact(sourceCode, options = {}) {
    const {
        filename = 'input.compact',
        standardLibrary,
        onLog,
    } = options;

    const factory = await loadModule();

    let stdout = '';
    let stderr = '';

    const Module = await factory({
        noInitialRun: true,
        print: (text) => {
            stdout += text + '\n';
            if (onLog) onLog('stdout', text);
        },
        printErr: (text) => {
            stderr += text + '\n';
            if (onLog) onLog('stderr', text);
        },
        locateFile: (path) => path, // Files served from same directory
    });

    const FS = Module.FS;

    // Set up virtual filesystem
    FS.mkdir('/work');
    FS.mkdir('/work/compiler');
    FS.mkdir('/work/output');

    // Write compiler program
    FS.writeFile('/compactc.ss', COMPACTC_PROGRAM);

    // Load standard library
    let stdLib = standardLibrary;
    if (!stdLib) {
        const resp = await fetch('standard-library.compact');
        stdLib = await resp.text();
    }
    FS.writeFile('/work/compiler/standard-library.compact', stdLib);

    // Write source file
    FS.writeFile(`/work/${filename}`, sourceCode);

    // Change to /work directory
    FS.chdir('/work');

    // Run compiler
    const args = [
        '--boot', '/petite.boot',
        '--boot', '/scheme.boot',
        '--boot', '/compactc-libs.boot',
        '--program', '/compactc.ss',
        '--skip-zk',
        `/work/${filename}`,
        '/work/output',
    ];

    let exitCode;
    try {
        exitCode = Module.callMain(args);
    } catch (e) {
        if (typeof e === 'number') exitCode = e;
        else if (e.status !== undefined) exitCode = e.status;
        else if (e.message?.includes('exit')) exitCode = 0;
        else throw new Error(`Compiler crashed: ${e.message}\n${stderr}`);
    }

    if (exitCode !== 0 && exitCode !== undefined) {
        throw new Error(`Compilation failed:\n${stderr || stdout}`);
    }

    // Read results
    const result = {
        zkir: new Map(),
        contractInfo: null,
        contractJs: '',
        contractDts: '',
    };

    try {
        const zkirFiles = FS.readdir('/work/output/zkir').filter(f => f.endsWith('.zkir'));
        for (const file of zkirFiles) {
            const name = file.replace(/\.zkir$/, '');
            const content = new TextDecoder().decode(FS.readFile(`/work/output/zkir/${file}`));
            result.zkir.set(name, content);
        }
    } catch (e) {}

    try {
        const raw = new TextDecoder().decode(FS.readFile('/work/output/compiler/contract-info.json'));
        result.contractInfo = JSON.parse(raw);
    } catch (e) {}

    try {
        result.contractJs = new TextDecoder().decode(FS.readFile('/work/output/contract/index.js'));
    } catch (e) {}

    try {
        result.contractDts = new TextDecoder().decode(FS.readFile('/work/output/contract/index.d.ts'));
    } catch (e) {}

    return result;
}
