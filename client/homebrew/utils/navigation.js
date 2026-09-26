/* URL helpers that hide the difference between the server build and the
 * standalone (serverless) build.
 *
 * The server build renders one page per route, so routes look like normal paths
 * (`/edit/abc123`). The standalone build is a single static file, so the same
 * routes are kept in the location hash (`index.html#/edit/abc123`); a hash
 * change is picked up by watchForNavigation(), which reloads the document so
 * that the app boots on the new route exactly like a normal page load would.
 *
 * Every module that creates a link, reads the current route or changes the URL
 * should go through these helpers so that both builds keep working.
 */
import { isStandalone } from './mode.js';
import { inlineAsset } from './inlineAssets.js';

const DEFAULT_ROUTE = '/';

// The route (path + query) that the app should render for the current document
const routeFromLocation = ()=>{
	if(!isStandalone()) return `${window.location.pathname}${window.location.search}`;
	const hash = window.location.hash || '';
	return hash.startsWith('#') ? (hash.slice(1) || DEFAULT_ROUTE) : DEFAULT_ROUTE;
};

const normalize = (path)=>(`${path}`.startsWith('/') ? path : `/${path}`);

// Use for every in-app <a href>. Never points at a static file that does not exist.
const href = (path)=>isStandalone() ? `#${normalize(path)}` : path;

// Use for assets that the server normally serves from the site root (`/themes`, `/homebrew`, ...).
// In the single-file build the same asset is embedded in the page as a data uri.
const assetUrl = (path)=>isStandalone() ? (inlineAsset(path) || `.${normalize(path)}`) : path;

// Full page load to a route
const navigate = (path)=>{
	if(!isStandalone()) {
		window.location.href = path;
		return;
	}
	const target = `#${normalize(path)}`;
	if(window.location.hash === target)
		window.location.reload();  // Already there; reload like assigning location would
	else
		window.location.hash = target;  // watchForNavigation() reloads the page
};

// Change the URL without navigating (used to keep the URL in sync with state)
const replaceRoute = (path)=>{
	try {
		window.history.replaceState(null, null, isStandalone() ? `#${normalize(path)}` : path);
	} catch (e) {
		console.warn('Unable to update the URL', e);
	}
};

// Update (or remove) the query parameters of the *current* route, wherever they live
const updateUrlQuery = (mutate)=>{
	const route = routeFromLocation();
	const [path, search] = route.split('?');
	const urlParams = new URLSearchParams(search || '');
	mutate(urlParams);
	const query = urlParams.toString();
	replaceRoute(`${path}${query ? `?${query}` : ''}`);
};

/* Routes are not real paths in the standalone build, so anything that reaches
   for the history api directly (to keep a filter or a brew id in the URL) is
   redirected to the hash instead. */
const installHistoryShims = ()=>{
	if(!isStandalone() || window.__homebreweryHistoryShimmed) return;
	window.__homebreweryHistoryShimmed = true;

	for (const method of ['pushState', 'replaceState']) {
		const original = window.history[method].bind(window.history);
		window.history[method] = (state, title, url)=>{
			if(url === undefined || url === null) return original(state, title, url);

			let next;
			try {
				next = new URL(url, window.location.href);
			} catch {
				return original(state, title, url);
			}

			const current = new URL(window.location.href);
			// Same document, so the route lives in the hash and only its query changed
			const route = (next.origin === current.origin && next.pathname === current.pathname)
				? `${routeFromLocation().split('?')[0]}${next.search}`
				: `${next.pathname}${next.search}`;

			return original(state, title, `${current.pathname}${current.search}#${normalize(route)}`);
		};
	}
};

// Standalone builds only change routes by changing the hash, so watch for it and
// reload; the bootstrap will then render the new route.
const watchForNavigation = ()=>{
	if(!isStandalone()) return;
	let currentRoute = routeFromLocation();
	window.addEventListener('hashchange', ()=>{
		if(routeFromLocation() === currentRoute) return;
		currentRoute = routeFromLocation();
		window.location.reload();
	});
};

export {
	href,
	DEFAULT_ROUTE,
	navigate,
	normalize,
	assetUrl,
	replaceRoute,
	updateUrlQuery,
	routeFromLocation,
	installHistoryShims,
	watchForNavigation
};
