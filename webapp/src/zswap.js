/**
 * zswap.js — Atomic ZSwap create/complete flow via the DApp Connector API.
 *
 * Create  (party A): makeIntent([offered], [wanted→self], { intentId:'random', payFees:false })
 *                    → serialized, UNBALANCED transaction. Share the hex with a counterparty.
 * Complete(party B): balanceUnsealedTransaction(pastedTx, { payFees:true }) adds the missing
 *                    tokens + dust and pays fees, then submitTransaction() sends it.
 *
 * Wallet discovery/connection is reused from deploy.js. The wallet does all proving,
 * balancing, and submission — there is no ledger-level swap code here.
 */
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Transaction } from '@midnight-ntwrk/ledger-v8';

// Wallet discovery/connection are inlined here (rather than imported from
// deploy.js) so this page does NOT pull in @midnight-ntwrk/midnight-js-contracts.
// That package minifies incorrectly in this second webpack entry, throwing
// "ReferenceError: GetCurrentStatesForIdentity is not defined" at runtime — and
// the swap flow doesn't need it (everything goes through the wallet connector).

/** Discover Midnight wallets injected on window.midnight. */
function discoverWallets() {
    return window.midnight ? Object.values(window.midnight) : [];
}

/** Connect to a wallet for a given network. */
async function connectWallet(initialAPI, networkId) {
    setNetworkId(networkId);
    return initialAPI.connect(networkId);
}

// --- UI elements ---
const networkSelect = document.getElementById('network-select');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const walletDot = document.getElementById('wallet-dot');
const walletLabel = document.getElementById('wallet-label');
const dustBalanceEl = document.getElementById('dust-balance');
const tokenListEl = document.getElementById('token-list');
const knownTypesEl = document.getElementById('known-types');

const offerToken = document.getElementById('offer-token');
const offerAmount = document.getElementById('offer-amount');
const wantKind = document.getElementById('want-kind');
const wantType = document.getElementById('want-type');
const wantAmount = document.getElementById('want-amount');
const generateBtn = document.getElementById('generate-btn');
const offerOutput = document.getElementById('offer-output');
const copyBtn = document.getElementById('copy-btn');
const createResult = document.getElementById('create-result');

const pasteInput = document.getElementById('paste-input');
const completeBtn = document.getElementById('complete-btn');
const completeResult = document.getElementById('complete-result');

const logOutput = document.getElementById('log-output');

const swapFields = [offerToken, offerAmount, wantKind, wantType, wantAmount, generateBtn];

// --- state ---
let api = null;                                   // connected wallet API
let addresses = { shielded: null, unshielded: null };
let tokens = [];                                  // [{ kind, type, value: bigint }]

// --- helpers ---
function log(msg) {
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logOutput.appendChild(line);
    logOutput.scrollTop = logOutput.scrollHeight;
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
}

function isNativeType(type) {
    return /^(0x)?0+$/i.test(type);
}

function shortHex(type) {
    const h = type.startsWith('0x') ? type : '0x' + type;
    return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h;
}

function tokenLabel(kind, type) {
    if (kind === 'unshielded' && isNativeType(type)) return 'NIGHT (unshielded)';
    return `${shortHex(type)} (${kind})`;
}

function fmtBig(v) {
    try { return BigInt(v).toLocaleString(); } catch { return String(v); }
}

// SPECK → DUST (1 DUST = 10^15 SPECK), for the wallet dust readout.
const SPECK_PER_DUST = 10n ** 15n;
function fmtDust(specks) {
    let v;
    try { v = BigInt(specks); } catch { return String(specks); }
    const sign = v < 0n ? '-' : '';
    if (v < 0n) v = -v;
    const whole = (v / SPECK_PER_DUST).toLocaleString();
    const f = (v % SPECK_PER_DUST).toString().padStart(15, '0');
    let frac = f.slice(0, 6).replace(/0+$/, '');
    if (!frac && v % SPECK_PER_DUST !== 0n) {
        const s = f.search(/[1-9]/);
        frac = f.slice(0, s + 3).replace(/0+$/, '');
    }
    return sign + (frac ? `${whole}.${frac}` : whole);
}

function hexToBytes(hex) {
    const clean = hex.trim().replace(/^0x/i, '');
    const m = clean.match(/.{1,2}/g) || [];
    return new Uint8Array(m.map((b) => parseInt(b, 16)));
}

function parseAmount(raw) {
    const v = BigInt(raw.trim()); // throws on non-integer
    if (v <= 0n) throw new Error('amount must be positive');
    return v;
}

function showCreate(ok, msg) {
    createResult.innerHTML = `<div class="${ok ? 'result-ok' : 'result-err'}">${escapeHtml(msg)}</div>`;
}
function showComplete(ok, msg) {
    completeResult.innerHTML = `<div class="${ok ? 'result-ok' : 'result-err'}">${escapeHtml(msg)}</div>`;
}

async function refreshDust() {
    if (!api || typeof api.getDustBalance !== 'function') return;
    try {
        const { balance, cap } = await api.getDustBalance();
        dustBalanceEl.textContent = `Dust: ${fmtDust(balance)} / ${fmtDust(cap)} DUST`;
        dustBalanceEl.style.display = '';
    } catch (e) {
        log(`Could not fetch dust balance: ${e.message}`);
    }
}

// --- connection state ---
function setConnected(name) {
    walletDot.classList.add('connected');
    walletLabel.textContent = `Connected: ${name}`;
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = '';
    networkSelect.disabled = true;
    swapFields.forEach((el) => { el.disabled = false; });
    updateCompleteBtn();
}

function setDisconnected() {
    walletDot.classList.remove('connected');
    walletLabel.textContent = 'No wallet connected';
    connectBtn.style.display = '';
    disconnectBtn.style.display = 'none';
    networkSelect.disabled = false;
    dustBalanceEl.style.display = 'none';
    tokenListEl.style.display = 'none';
    swapFields.forEach((el) => { el.disabled = true; });
    api = null;
    tokens = [];
    addresses = { shielded: null, unshielded: null };
    updateCompleteBtn();
}

// --- wallet connect ---
connectBtn.addEventListener('click', async () => {
    const wallets = discoverWallets();
    if (!wallets.length) {
        alert('No Midnight wallet detected. Please install the Lace wallet browser extension.');
        return;
    }
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting…';
    try {
        const networkId = networkSelect.value;
        log(`Connecting on ${networkId}…`);
        api = await connectWallet(wallets[0], networkId);

        if (typeof api.makeIntent !== 'function' || typeof api.balanceUnsealedTransaction !== 'function') {
            log('Warning: this wallet does not expose makeIntent / balanceUnsealedTransaction. ' +
                'Those need DApp Connector API v4+ — swap actions may fail.');
        }
        if (typeof api.hintUsage === 'function') {
            try {
                await api.hintUsage(['getShieldedBalances', 'getUnshieldedBalances', 'makeIntent', 'balanceUnsealedTransaction', 'submitTransaction']);
            } catch (_) { /* permission hinting is best-effort */ }
        }

        addresses.shielded = await api.getShieldedAddresses();
        try { addresses.unshielded = await api.getUnshieldedAddress(); } catch (_) { addresses.unshielded = null; }

        setConnected(wallets[0].name || 'wallet');
        log(`Connected: ${wallets[0].name || 'wallet'}`);
        await loadTokens();
        await refreshDust();
    } catch (err) {
        log(`Connection failed: ${err.message}`);
        alert('Failed to connect wallet: ' + err.message);
        setDisconnected();
    } finally {
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect Wallet';
    }
});

disconnectBtn.addEventListener('click', () => {
    setDisconnected();
    log('Wallet disconnected.');
});

// --- token listing ---
async function loadTokens() {
    const shielded = (await api.getShieldedBalances().catch(() => ({}))) || {};
    const unshielded = (await api.getUnshieldedBalances().catch(() => ({}))) || {};
    tokens = [
        ...Object.entries(shielded).map(([type, value]) => ({ kind: 'shielded', type, value: BigInt(value) })),
        ...Object.entries(unshielded).map(([type, value]) => ({ kind: 'unshielded', type, value: BigInt(value) })),
    ];

    tokenListEl.innerHTML = tokens.length
        ? tokens.map((t) => `<div class="token-row"><span>${tokenLabel(t.kind, t.type)}</span><span class="bal">${fmtBig(t.value)}</span></div>`).join('')
        : '<div class="token-row"><span class="muted">No tokens found in this wallet.</span></div>';
    tokenListEl.style.display = '';

    offerToken.innerHTML = tokens.length
        ? tokens.map((t, i) => `<option value="${i}">${tokenLabel(t.kind, t.type)} — ${fmtBig(t.value)}</option>`).join('')
        : '<option value="">(no tokens to offer)</option>';

    // Convenience autocomplete for the "want" token type.
    const types = [...new Set(tokens.map((t) => t.type))];
    knownTypesEl.innerHTML = types.map((t) => `<option value="${t}">`).join('');
}

// --- create (party A): build an unbalanced offer ---
generateBtn.addEventListener('click', async () => {
    createResult.innerHTML = '';
    if (!api) { showCreate(false, 'Connect your wallet first.'); return; }
    if (typeof api.makeIntent !== 'function') {
        showCreate(false, 'This wallet does not support makeIntent (needs DApp Connector API v4+).');
        return;
    }

    const offer = tokens[Number(offerToken.value)];
    if (!offer) { showCreate(false, 'Select a token to offer.'); return; }

    const wType = wantType.value.trim();
    if (!wType) { showCreate(false, 'Enter the token type you want to receive.'); return; }

    let offerVal, wantVal;
    try { offerVal = parseAmount(offerAmount.value); } catch { showCreate(false, 'Offer amount must be a positive integer.'); return; }
    try { wantVal = parseAmount(wantAmount.value); } catch { showCreate(false, 'Want amount must be a positive integer.'); return; }

    const kind = wantKind.value; // 'shielded' | 'unshielded'
    const recipient = kind === 'shielded'
        ? addresses.shielded?.shieldedAddress
        : addresses.unshielded?.unshieldedAddress;
    if (!recipient) { showCreate(false, `Wallet did not provide a ${kind} address to receive into.`); return; }

    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating…';
    try {
        log(`Creating ZSwap — offer ${fmtBig(offerVal)} ${tokenLabel(offer.kind, offer.type)} → want ${fmtBig(wantVal)} ${tokenLabel(kind, wType)}`);
        const { tx } = await api.makeIntent(
            [{ kind: offer.kind, type: offer.type, value: offerVal }],
            [{ kind, type: wType, value: wantVal, recipient }],
            { intentId: 'random', payFees: false },
        );
        offerOutput.value = tx;
        copyBtn.disabled = false;
        log('Unbalanced ZSwap created.');
        showCreate(true, 'Unbalanced ZSwap created — copy the box below and send it to a counterparty to complete.');
    } catch (err) {
        log(`Create failed: ${err.message}`);
        showCreate(false, err.message);
    } finally {
        generateBtn.disabled = false;
        generateBtn.textContent = 'Generate ZSwap';
    }
});

copyBtn.addEventListener('click', async () => {
    if (!offerOutput.value) return;
    try {
        await navigator.clipboard.writeText(offerOutput.value);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    } catch (_) {
        offerOutput.select();
        document.execCommand('copy');
    }
});

// --- complete (party B): balance the offer and submit ---
function updateCompleteBtn() {
    const hasPaste = pasteInput.value.trim().length > 0;
    completeBtn.style.display = hasPaste ? '' : 'none';
    completeBtn.disabled = !(hasPaste && api);
}

pasteInput.addEventListener('input', updateCompleteBtn);

completeBtn.addEventListener('click', async () => {
    completeResult.innerHTML = '';
    const tx = pasteInput.value.trim();
    if (!tx) return;
    if (!api) { showComplete(false, 'Connect your wallet first.'); return; }
    if (typeof api.balanceUnsealedTransaction !== 'function') {
        showComplete(false, 'This wallet does not support balanceUnsealedTransaction (needs DApp Connector API v4+).');
        return;
    }

    completeBtn.disabled = true;
    completeBtn.textContent = 'Completing…';
    try {
        log('Balancing ZSwap (adding the missing tokens + dust, paying fees)…');
        const balanced = await api.balanceUnsealedTransaction(tx, { payFees: true });
        log('Submitting to the network…');
        await api.submitTransaction(balanced.tx);

        let txId = '';
        try {
            txId = Transaction.deserialize('signature', 'proof', 'binding', hexToBytes(balanced.tx)).identifiers()[0];
        } catch (_) { /* id is best-effort */ }

        log(`ZSwap submitted${txId ? `: ${txId}` : ''}.`);
        showComplete(true, `ZSwap completed and submitted${txId ? ` — tx ${txId}` : ''}.`);
        await refreshDust();
    } catch (err) {
        log(`Complete failed: ${err.message}`);
        showComplete(false, err.message);
    } finally {
        completeBtn.disabled = false;
        completeBtn.textContent = 'Complete ZSwap';
        updateCompleteBtn();
    }
});

// --- init ---
setDisconnected();
