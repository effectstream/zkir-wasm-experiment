/**
 * deploy.js — Wallet connection and contract deployment for Midnight network
 *
 * Uses the DApp Connector API (window.midnight) to connect a wallet (e.g. Lace),
 * then deploys the just-compiled contract using the Midnight JS SDK.
 */

import { ZKConfigProvider } from '@midnight-ntwrk/midnight-js-types';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Transaction } from '@midnight-ntwrk/ledger-v8';
import { CompiledContract } from '@midnight-ntwrk/compact-js';

// ---------------------------------------------------------------------------
// Hex helpers (from midnight-wallet-dapp walletAdapter.ts)
// ---------------------------------------------------------------------------

function uint8ArrayToHex(bytes) {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

function hexToUint8Array(hex) {
    const cleaned = hex.replace(/^0x/, '');
    const matches = cleaned.match(/.{1,2}/g);
    if (!matches) return new Uint8Array();
    return new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
}

// ---------------------------------------------------------------------------
// In-memory ZKConfigProvider — serves ZKIR + keys we already have in memory
// ---------------------------------------------------------------------------

class InMemoryZKConfigProvider extends ZKConfigProvider {
    /**
     * @param {Map<string, Uint8Array>} binaryZkirMap  circuit name → binary ZKIR
     * @param {Map<string, {proverKey: Uint8Array, verifierKey: Uint8Array}>} keysMap
     */
    constructor(binaryZkirMap, keysMap) {
        super();
        this._zkir = binaryZkirMap;
        this._keys = keysMap;
    }

    async getZKIR(circuitId) {
        const data = this._zkir.get(circuitId);
        if (!data) throw new Error(`No ZKIR for circuit "${circuitId}"`);
        return data;
    }

    async getProverKey(circuitId) {
        const entry = this._keys.get(circuitId);
        if (!entry) throw new Error(`No prover key for circuit "${circuitId}"`);
        return entry.proverKey;
    }

    async getVerifierKey(circuitId) {
        const entry = this._keys.get(circuitId);
        if (!entry) throw new Error(`No verifier key for circuit "${circuitId}"`);
        return entry.verifierKey;
    }
}

// ---------------------------------------------------------------------------
// Wallet discovery & connection
// ---------------------------------------------------------------------------

/**
 * Discover available Midnight wallets injected on window.midnight.
 * @returns {Array<{name: string, icon: string, apiVersion: string, connect: Function}>}
 */
export function discoverWallets() {
    if (!window.midnight) return [];
    return Object.values(window.midnight);
}

/**
 * Connect to a wallet for a given network.
 * @param {object} initialAPI  — one of the entries from discoverWallets()
 * @param {string} networkId   — e.g. 'mainnet', 'preview', 'qanet'
 * @returns {Promise<object>} ConnectedAPI
 */
export async function connectWallet(initialAPI, networkId) {
    setNetworkId(networkId);
    return initialAPI.connect(networkId);
}

// ---------------------------------------------------------------------------
// Provider construction
// ---------------------------------------------------------------------------

/**
 * Build all MidnightProviders from a connected wallet + in-memory artifacts.
 *
 * @param {object} connectedAPI          — ConnectedAPI from wallet
 * @param {Map<string, Uint8Array>} binaryZkirMap  — circuit name → binary ZKIR
 * @param {Map<string, {proverKey, verifierKey}>} keysMap
 * @param {function} [onLog]             — optional log callback
 * @returns {Promise<object>} MidnightProviders
 */
export async function buildProviders(connectedAPI, binaryZkirMap, keysMap, onLog) {
    const log = onLog || (() => {});

    const config = await connectedAPI.getConfiguration();
    log(`Network: ${config.networkId}`);
    log(`Indexer: ${config.indexerUri}`);
    log(`Proof server: ${config.proverServerUri || '(not provided)'}`);

    // ZK config — serves artifacts from memory
    const zkConfigProvider = new InMemoryZKConfigProvider(binaryZkirMap, keysMap);

    // Proof provider — sends ZKIR+keys to the wallet's proof server
    if (!config.proverServerUri) {
        throw new Error('Wallet configuration does not include a proof server URI (proverServerUri)');
    }
    const proofProvider = httpClientProofProvider(config.proverServerUri, zkConfigProvider);

    // Public data — queries blockchain via indexer
    const publicDataProvider = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri);

    // Private state — IndexedDB-backed (browser)
    const shieldedAddress = await connectedAPI.getShieldedAddresses();
    const privateStateProvider = levelPrivateStateProvider({
        privateStoragePasswordProvider: () => 'Zkir-wasm-Deploy-1',
        accountId: shieldedAddress.shieldedAddress,
    });

    // Wallet provider — wraps DApp Connector for tx balancing
    const walletProvider = {
        getCoinPublicKey() {
            return shieldedAddress.shieldedCoinPublicKey;
        },
        getEncryptionPublicKey() {
            return shieldedAddress.shieldedEncryptionPublicKey;
        },
        async balanceTx(tx) {
            const serialized = uint8ArrayToHex(tx.serialize());
            log('Balancing transaction via wallet...');
            const result = await connectedAPI.balanceUnsealedTransaction(serialized);
            const resultBytes = hexToUint8Array(result.tx);
            return Transaction.deserialize('signature', 'proof', 'binding', resultBytes);
        },
    };

    // Midnight provider — wraps DApp Connector for tx submission
    const midnightProvider = {
        async submitTx(tx) {
            const serialized = uint8ArrayToHex(tx.serialize());
            log('Submitting transaction to network...');
            await connectedAPI.submitTransaction(serialized);
            const txId = tx.identifiers()[0];
            log(`Transaction submitted: ${txId}`);
            return txId;
        },
    };

    return {
        privateStateProvider,
        publicDataProvider,
        zkConfigProvider,
        proofProvider,
        walletProvider,
        midnightProvider,
    };
}

// ---------------------------------------------------------------------------
// Dynamic contract module loading
// ---------------------------------------------------------------------------

/**
 * Load the compiler-generated contract module (index.js) dynamically.
 *
 * The generated code imports @midnight-ntwrk/compact-runtime. We replace the
 * import with a reference to the globally-available runtime to support loading
 * from a Blob URL.
 *
 * @param {string} contractJs — the generated contract source code
 * @returns {Promise<object>} the contract module exports (Contract class, ledger, etc.)
 */
export async function loadContractModule(contractJs) {
    // Make compact-runtime available globally so the Blob-loaded module can reference it
    if (!window.__compactRuntime) {
        window.__compactRuntime = await import(
            /* webpackIgnore: false */ '@midnight-ntwrk/compact-runtime'
        );
    }

    // Replace the import statement with a global reference
    const transformed = contractJs.replace(
        /import\s+\*\s+as\s+__compactRuntime\s+from\s+['"]@midnight-ntwrk\/compact-runtime['"];?/,
        'const __compactRuntime = window.__compactRuntime;'
    );

    const blob = new Blob([transformed], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    try {
        return await import(/* webpackIgnore: true */ url);
    } finally {
        URL.revokeObjectURL(url);
    }
}

// ---------------------------------------------------------------------------
// Contract deployment
// ---------------------------------------------------------------------------

/**
 * Deploy a compiled contract to the network.
 *
 * @param {object} providers       — MidnightProviders from buildProviders()
 * @param {object} contractModule  — dynamic module from loadContractModule()
 * @param {string} contractName    — name for the compiled contract (e.g. 'UserContract')
 * @param {function} [onLog]       — optional log callback
 * @returns {Promise<{contractAddress: string, txId: string}>}
 */
export async function deploy(providers, contractModule, contractName, onLog) {
    const log = onLog || (() => {});

    log('Creating compiled contract...');
    const compiledContract = CompiledContract.make(
        contractName || 'Contract',
        contractModule.Contract
    ).pipe(CompiledContract.withVacantWitnesses);

    log('Deploying contract (proving, balancing, submitting)...');
    const deployed = await deployContract(providers, { compiledContract });

    const contractAddress = deployed.deployTxData.public.contractAddress;
    log(`Contract deployed at: ${contractAddress}`);

    return {
        contractAddress,
        compiledContract,
        deployed,
    };
}

// ---------------------------------------------------------------------------
// Circuit calling
// ---------------------------------------------------------------------------

/**
 * Call a circuit on a deployed contract.
 *
 * @param {object} providers         — MidnightProviders
 * @param {object} compiledContract  — CompiledContract from deploy()
 * @param {string} contractAddress   — deployed contract address
 * @param {string} circuitId         — circuit name (e.g. 'increment')
 * @param {Array}  args              — circuit arguments
 * @param {function} [onLog]
 * @returns {Promise<{result: *, txId: string}>}
 */
export async function callCircuit(providers, compiledContract, contractAddress, circuitId, args, onLog) {
    const log = onLog || (() => {});

    log(`Calling circuit "${circuitId}"...`);

    const options = {
        compiledContract,
        contractAddress,
        circuitId,
    };
    if (args && args.length > 0) {
        options.args = args;
    }

    const callTxData = await submitCallTx(providers, options);

    const txId = callTxData.public.txId;
    log(`Circuit "${circuitId}" executed. TX: ${txId}`);

    return {
        result: callTxData.private.result,
        txId,
        callTxData,
    };
}

// ---------------------------------------------------------------------------
// Ledger state reading
// ---------------------------------------------------------------------------

/**
 * Read the current public ledger state of a deployed contract.
 *
 * @param {object} publicDataProvider  — from providers
 * @param {object} contractModule      — dynamic module with ledger() export
 * @param {string} contractAddress     — deployed contract address
 * @returns {Promise<object|null>} parsed ledger state, or null if not found
 */
export async function readLedgerState(publicDataProvider, contractModule, contractAddress) {
    const contractState = await publicDataProvider.queryContractState(contractAddress);
    if (!contractState) return null;
    // ContractState.data is a ChargedState, which ledger() accepts directly
    return contractModule.ledger(contractState.data);
}
