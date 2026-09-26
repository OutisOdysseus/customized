/* Global jest setup.
 *
 * The jsdom test environment doesn't ship the encodings that some node
 * dependencies of the client bundle (superagent -> formidable -> }hash-wasm)
 * expect at import time, so they are polyfilled here.
 */
import { TextEncoder, TextDecoder } from 'util';

if(typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
if(typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder;

// fake-indexeddb clones records the way a browser would
if(typeof global.structuredClone === 'undefined')
	global.structuredClone = (value)=>JSON.parse(JSON.stringify(value));
