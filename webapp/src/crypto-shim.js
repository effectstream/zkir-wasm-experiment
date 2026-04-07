/**
 * crypto-shim.js — Extends crypto-browserify with timingSafeEqual
 *
 * The level-private-state-provider uses crypto.timingSafeEqual which
 * crypto-browserify does not provide. We add a browser implementation.
 */
export * from 'crypto-browserify';
export { default } from 'crypto-browserify';

export function timingSafeEqual(a, b) {
    if (a.length !== b.length) {
        throw new RangeError('Input buffers must have the same byte length');
    }
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a[i] ^ b[i];
    }
    return result === 0;
}
