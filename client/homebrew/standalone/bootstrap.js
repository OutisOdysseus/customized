/* Startup logic for the standalone (serverless) build.
 *
 * The server build renders a page per route (loading the brew, the user's
 * themes, the vault results, etc. on the server) and hands the result to the
 * client as props. The standalone build does that work in the browser instead:
 * it reads the route out of the location hash, loads whatever that route needs
 * from IndexedDB and then mounts the very same app.
 */
import _      from 'lodash';
import React  from 'react';

import { DEFAULT_BREW, DEFAULT_BREW_LOAD } from '../../../server/brewDefaults.js';
import { splitTextStyleAndMetadata }       from '../../../shared/helpers.js';
import packageJSON                         from '../../../package.json';

import { routeFromLocation, installHistoryShims, watchForNavigation } from '../utils/navigation.js';
import { setStandaloneMode }                                          from '../utils/mode.js';
import { findBrew, saveBrew, listBrews, getLocalAccount }             from '../utils/localStore.js';
import { getUserThemes, getUserBrews, setThemeStyles, plainId }       from '../utils/localApi.js';

import { loadThemeStyles }                        from './themeData.js';
import { welcome, welcomeLegacy, migrate, changelog, faq } from './bundledText.js';

import Homebrew from '../homebrew.jsx';

//Everything the app needs to build a link back to itself
const pageUrl = ()=>window.location.href.split('#')[0];

const errorProps = (error)=>{
	const status = error?.status || 500;
	return {
		url  : '/error',
		brew : {
			...error,
			title       : 'Error - Something went wrong!',
			text        : error?.errors?.map((e)=>e.message).join('\n\n') || error?.message || 'Unknown error!',
			status      : status,
			HBErrorCode : error?.HBErrorCode ?? '00',
			pureError   : { ...error, message: error?.message }
		}
	};
};

const notFoundProps = (id, accessType)=>errorProps({
	name        : 'BrewLoad Error',
	message     : 'Brew not found',
	status      : 404,
	HBErrorCode : '05',
	accessType,
	brewId      : id
});

//Brews coming out of storage get the same defaults the server applies when loading one
const splitBrew = (brew)=>{
	const split = _.defaults(_.cloneDeep(brew), DEFAULT_BREW_LOAD);
	splitTextStyleAndMetadata(split);
	return split;
};

//The markdown pages that ship with the app (welcome, faq, changelog, ...)
const contentPage = (text, title, renderer = 'V3')=>{
	const brew = { title, text, renderer, theme: '5ePHB' };
	splitTextStyleAndMetadata(brew);
	return brew;
};

const renderRoute = async (route, account)=>{
	const [path] = route.split('?');
	const [routeName, routeId] = path.split('/').filter(Boolean);

	switch(routeName) {
		case undefined:
			return { url: '/', brew: contentPage(welcome) };

		case 'legacy':
			return { url: '/legacy', brew: contentPage(welcomeLegacy, undefined, 'legacy') };

		case 'changelog':
			return { url: '/changelog', brew: contentPage(changelog, 'Changelog') };

		case 'faq':
			return { url: '/faq', brew: contentPage(faq, 'FAQ') };

		case 'migrate':
			return { url: '/migrate', brew: contentPage(migrate) };

		case 'vault':
			return { url: '/vault' };

		case 'edit': {
			const stored = await findBrew({ editId: plainId(routeId || '') });
			if(!stored) return notFoundProps(routeId, 'edit');
			return {
				url        : `/edit/${routeId}`,
				brew       : splitBrew(stored),
				userThemes : await getUserThemes(account)
			};
		}

		case 'share': {
			const stored = await findBrew({ shareId: plainId(routeId || '') });
			if(!stored) return notFoundProps(routeId, 'share');

			const brew = splitBrew(stored);

			//Keep track of views, but don't count the author's own visits (same as the server)
			if(!(brew.authors || []).includes(account?.username)) {
				stored.views = (stored.views || 0) + 1;
				stored.lastViewed = new Date();
				await saveBrew(stored);
				brew.views = stored.views;
			}

			return { url: `/share/${routeId}`, brew };
		}

		case 'new': {
			const userThemes = await getUserThemes(account);
			if(!routeId) return { url: '/new', userThemes };

			const stored = await findBrew({ shareId: plainId(routeId) });
			if(!stored) return notFoundProps(routeId, 'share');

			const source = splitBrew(stored);
			const clone = _.defaults({
				shareId  : source.shareId,
				title    : `CLONE - ${source.title}`,
				text     : source.text,
				style    : source.style,
				renderer : source.renderer,
				theme    : source.theme,
				tags     : source.tags,
				snippets : source.snippets
			}, DEFAULT_BREW);

			return { url: `/new/${routeId}`, brew: clone, userThemes };
		}

		case 'user': {
			const username = decodeURIComponent(routeId || '');
			return { url: `/user/${routeId}`, brews: await getUserBrews(username, account) };
		}

		case 'account': {
			if(!account)
				return errorProps({ name: 'Account Error', message: 'No valid account', status: 401, HBErrorCode: '50', page: 'Account Information Page' });

			const brews = await listBrews();
			const accountDetails = {
				username    : account.username,
				issued      : account.issued,
				googleId    : false,
				authCheck   : false,
				mongoCount  : brews.filter((brew)=>(brew.authors || []).includes(account.username)).length,
				googleCount : 0
			};

			return { url: '/account', brew: { title: 'Account Information Page', accountDetails } };
		}

		default:
			//Unknown routes fall through to the home page, like the server's catch-all redirect
			return { url: '/', brew: contentPage(welcome) };
	}
};

const buildProps = async ()=>{
	const route   = routeFromLocation();
	const [, query] = route.split('?');
	const account = getLocalAccount();

	const routeProps = await renderRoute(route, account)
		.catch((error)=>{
			console.error(error);
			return errorProps(error);
		});

	const url = `${routeProps.url || '/'}${query ? `?${query}` : ''}`;

	return {
		version       : packageJSON.version,
		account       : account,
		enable_v3     : true,
		enable_themes : true,
		config        : {
			local       : true,             // Shows the local login option in the navbar
			publicUrl   : pageUrl(),
			baseUrl     : `${pageUrl()}#`,  // Routes live after the hash, so share links need one too
			environment : 'standalone',
			deployment  : ''
		},
		...routeProps,
		url
	};
};

const bootStandalone = async ()=>{
	setStandaloneMode(true);
	setThemeStyles(loadThemeStyles());
	installHistoryShims();
	watchForNavigation();

	const container = document.getElementById('reactRoot');
	if(!container) return;

	let props;
	try {
		props = await buildProps();
	} catch (error) {
		console.error('Unable to start the Homebrewery', error);
		props = { ...errorProps(error), url: '/error' };
	}

	document.getElementById('standaloneLoading')?.remove();

	const { createRoot } = require('react-dom/client');
	createRoot(container).render(React.createElement(Homebrew, props));
};

export {
	bootStandalone,
	buildProps,
	errorProps
};
