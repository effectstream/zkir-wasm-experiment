/**
 * ws-shim.js — Browser shim for isomorphic-ws
 *
 * In the browser, WebSocket is globally available. The indexer provider
 * imports { WebSocket } from 'isomorphic-ws', so we re-export the global.
 */
const W = typeof WebSocket !== 'undefined' ? WebSocket : undefined;
export { W as WebSocket };
export default W;
