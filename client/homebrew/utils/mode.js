/* Tracks whether the app is running as a fully client-side "standalone" build.
 * The standalone build (see scripts/buildStandalone.js) has no server at all:
 * everything is a static file and all brews live in the browser's IndexedDB.
 *
 * Modules that normally talk to the server, or that point at server-rendered
 * routes, check this flag at call time (never at import time) so that a single
 * codebase can serve both the server build and the standalone build.
 */
let standaloneMode = false;

const setStandaloneMode = (enabled)=>{
	standaloneMode = !!enabled;
};

const isStandalone = ()=>standaloneMode;

export {
	setStandaloneMode,
	isStandalone
};
