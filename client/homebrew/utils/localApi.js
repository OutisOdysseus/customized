/* A miniature, in-browser version of the Homebrewery API.
 *
 * Every endpoint that the client calls on the real server is implemented here
 * on top of IndexedDB, so the standalone build can create, load, update, delete
 * and search brews without any server. The behaviour intentionally mirrors
 * server/homebrew.api.js (id handling, text merging, theme bundles, vault
 * searches, error codes) so that the app looks and behaves the same.
 */
import _      from 'lodash';
import yaml   from 'js-yaml';
import Themes from '../../../themes/themes.json';

import Markdown from 'naturalcrit/markdown.js';
import { brewSnippetsToJSON, splitTextStyleAndMetadata } from '../../../shared/helpers.js';
import { DEFAULT_BREW } from '../../../server/brewDefaults.js';

import { listBrews, saveBrew, deleteBrewRecord, findBrew, newId, setLocalAccount, clearLocalAccount } from './localStore.js';
import { resolveCssUrls } from './inlineAssets.js';

const MAX_TITLE_LENGTH = 100;
const MAX_THEME_DEPTH = 10;

// Static theme css, injected by the standalone bootstrap (see themeData.js)
let staticThemeStyles = {};

const setThemeStyles = (themeStyles)=>{
	staticThemeStyles = themeStyles || {};
};

const getStaticThemeStyles = (renderer, themeName)=>staticThemeStyles?.[renderer]?.[themeName] || '';

/* The pages that put a theme on the outside of the app (the brew lists) load it
 * as a stylesheet from /themes/... . When there is no server those files are
 * precompiled into the bundle instead, so the same css is handed back here to be
 * injected inline; an empty string means 'use the stylesheet link'. */
const themeStyleSheet = (renderer, themeName)=>resolveCssUrls(getStaticThemeStyles(renderer, themeName));

const isStaticTheme = (renderer, themeName)=>Themes[renderer]?.[themeName] !== undefined;

// Errors carry the same shape the server sends, so error banners work unchanged
const apiError = ({ name = 'BrewLoad Error', message = 'Brew not found', status = 404, HBErrorCode = '05', ...rest })=>{
	const error = new Error(message);
	error.name = name;
	error.status = status;
	error.HBErrorCode = HBErrorCode;
	Object.assign(error, rest);
	return error;
};

//The client stores its ids as `<googleId><id>` for google drive brews; we only ever have local ids
const plainId = (id)=>id.length > 12 ? id.slice(-12) : id;

const getGoodBrewTitle = (text)=>{
	const tokens = Markdown.marked.lexer(text);
	return (tokens.find((token)=>token.type === 'heading' || token.type === 'paragraph')?.text || 'No Title')
		.slice(0, MAX_TITLE_LENGTH);
};

// Merges the metadata / css / text sections back into a single text block, exactly
// like the server does before storing a brew
const mergeBrewText = (brew)=>{
	let text = brew.text;
	if(brew.style !== undefined) {
		text = '```css\n' +
			`${brew.style || ''}\n` +
			'```\n\n' +
			`${text}`;
	}
	const metadata = _.pick(brew, ['title', 'description', 'tags', 'systems', 'renderer', 'theme']);
	const snippetsArray = brewSnippetsToJSON('brew_snippets', brew.snippets, null, false).snippets;
	metadata.snippets = snippetsArray.length > 0 ? snippetsArray : undefined;
	text = '```metadata\n' +
		`${yaml.dump(metadata)}\n` +
		'```\n\n' +
		`${text}`;
	return text;
};

// Fields that the client sends for validation only and that are not worth storing
const stripTransientProps = (brew)=>{
	delete brew.patches;
	delete brew.hash;
	delete brew.textBin;
	return brew;
};

const createBrew = async (incoming, account)=>{
	const brew = _.cloneDeep(incoming || {});

	delete brew.editId;
	delete brew.shareId;
	delete brew.googleId;

	if(!brew.title)
		brew.title = getGoodBrewTitle(brew.text);

	brew.authors = account ? [account.username] : [];
	brew.text = mergeBrewText(brew);

	_.defaults(brew, DEFAULT_BREW);

	brew.title = (brew.title || '').trim();
	brew.description = (brew.description || '').trim();

	brew.editId = await newId('editId');
	brew.shareId = await newId('shareId');
	brew.createdAt = new Date();
	brew.updatedAt = new Date();
	brew.lastViewed = new Date();
	brew.version = 1;

	stripTransientProps(brew);
	return saveBrew(brew);
};

const updateBrew = async (id, incoming, account)=>{
	const stored = await findBrew({ editId: plainId(id) });
	if(!stored) throw apiError({ message: 'Brew not found', status: 404, HBErrorCode: '05', brewId: plainId(id) });

	// The stored text holds the metadata / css sections; split them out again before
	// merging in the client's (already split) version of the brew
	splitTextStyleAndMetadata(stored);
	const brew = _.assign(stored, _.cloneDeep(incoming || {}));

	brew.title = (brew.title || '').trim();
	brew.description = (brew.description || '').trim();
	brew.text = mergeBrewText(brew);

	brew.updatedAt = new Date();
	brew.version = (brew.version || 1) + 1;

	if(account) {
		brew.authors = _.uniq(_.concat(brew.authors || [], account.username));
		brew.invitedAuthors = _.uniq(_.filter(brew.invitedAuthors, (author)=>account.username !== author));
	}

	stripTransientProps(brew);
	return saveBrew(brew);
};

const deleteBrew = async (id, account)=>{
	const brew = await findBrew({ editId: plainId(id) });
	if(!brew) throw apiError({ message: 'Brew not found', status: 404, HBErrorCode: '05', brewId: plainId(id) });

	if(account)
		brew.authors = _.pull(brew.authors || [], account.username);

	// The document is only removed once no authors are left, like the server does
	if((brew.authors || []).length === 0) {
		await deleteBrewRecord(brew);
		return { deleted: true };
	}

	await saveBrew(brew);
	return { deleted: false };
};

const getThemeBundle = async (renderer, themeId)=>{
	/* Collects the theme and all of its parent themes, returning an object
	   containing an array of css and an array of snippets, in render order */
	let themeRenderer = _.upperFirst(renderer);
	let id = themeId;
	let currentTheme;
	const completeStyles = [];
	const completeSnippets = [];
	let themeName;
	let themeAuthor;

	for (let depth = 0; id && depth < MAX_THEME_DEPTH; depth++) {
		if(!isStaticTheme(themeRenderer, id)) {
			//=== User Themes ===//
			const stored = await findBrew({ shareId: plainId(id) });
			if(!stored)
				throw apiError({ name: 'ThemeLoad Error', message: 'Theme Not Found', status: 404, HBErrorCode: '09', brewId: id });

			currentTheme = _.cloneDeep(stored);
			splitTextStyleAndMetadata(currentTheme);

			if(!(currentTheme.tags || []).some((tag)=>tag === 'meta:theme' || tag === 'meta:Theme'))
				throw apiError({ name: 'Invalid Theme Selected', message: 'Selected theme does not have the meta:theme tag', status: 422, HBErrorCode: '10', brewId: id });

			themeName ??= currentTheme.title;
			themeAuthor ??= currentTheme.authors?.[0];

			if(currentTheme?.snippets) completeSnippets.push({ name: currentTheme.title, snippets: currentTheme.snippets });
			if(currentTheme?.style) completeStyles.push(`/* From Brew: ${id} */\n\n${currentTheme.style}`);

			id = currentTheme.theme;
			themeRenderer = _.upperFirst(currentTheme.renderer);
		} else {
			//=== Static Themes ===//
			themeName ??= id;
			completeSnippets.push(`${themeRenderer}_${id}`); // The client loads the snippets by name
			completeStyles.push(`/* From Theme ${id} */\n\n${getStaticThemeStyles(themeRenderer, id)}`);

			id = Themes[themeRenderer][id].baseTheme;
		}
	}

	return {
		// Reverse the order of the arrays so they are listed oldest parent to youngest child.
		styles   : completeStyles.reverse(),
		snippets : completeSnippets.reverse(),
		name     : themeName,
		author   : themeAuthor
	};
};

const sanitizeBrew = (brew, accessType)=>{
	brew = _.cloneDeep(brew);
	delete brew.text;
	delete brew.textBin;
	delete brew.version;
	delete brew.googleId;
	if(accessType !== 'edit')
		delete brew.editId;
	return brew;
};

const matchesSearchText = (brew, text)=>{
	if(!text) return true;
	// The server uses Mongo's $text search; a plain substring match is the closest
	// locally available equivalent
	return (brew.title || '').toLowerCase().includes(text.toLowerCase());
};

const searchVault = async (query = {})=>{
	const title  = query.title || '';
	const author = query.author || '';
	const page   = Math.max(parseInt(query.page) || 1, 1);
	const count  = Math.max(parseInt(query.count) || 20, 10);
	const skip   = (page - 1) * count;
	const sort   = query.sort || 'title';
	const dir    = query.dir || 'asc';

	const rendererFilter = (brew)=>{
		if(query.legacy === 'true' && query.v3 !== 'true') return brew.renderer === 'legacy';
		if(query.v3 === 'true' && query.legacy !== 'true') return brew.renderer === 'V3';
		return true;
	};

	let brews = (await listBrews()).filter((brew)=>brew.published === true)
		.filter(rendererFilter)
		.filter((brew)=>matchesSearchText(brew, title))
		.filter((brew)=>!author || (brew.authors || []).includes(author));

	brews = _.orderBy(brews, [(brew)=>brew[sort]], [dir === 'asc' ? 'asc' : 'desc']);
	const pageOfBrews = brews.slice(skip, skip + count).map((brew)=>sanitizeBrew(brew, 'share'));

	return { brews: pageOfBrews, page };
};

const vaultTotal = async (query = {})=>{
	const { brews } = await searchVault({ ...query, page: 1, count: 100000 });
	return { totalBrews: brews.length };
};

// Brews shown on a user page (equivalent of the server's `/user/:username` middleware)
const getUserBrews = async (username, account)=>{
	if(!username) return [];

	const ownAccount = !!account && account.username === username;
	const brews = (await listBrews())
		.filter((brew)=>(brew.authors || []).includes(username))
		.filter((brew)=>ownAccount || brew.published === true)
		.map((brew)=>({
			googleId    : undefined, // Google Drive is not available offline
			title       : brew.title?.trim(),
			pageCount   : brew.pageCount,
			description : brew.description?.trim(),
			authors     : brew.authors,
			lang        : brew.lang,
			published   : brew.published,
			views       : brew.views,
			shareId     : brew.shareId,
			editId      : ownAccount ? brew.editId : undefined,
			createdAt   : brew.createdAt,
			updatedAt   : brew.updatedAt,
			lastViewed  : brew.lastViewed,
			thumbnail   : brew.thumbnail,
			tags        : brew.tags
		}))
		.map((brew)=>sanitizeBrew({ ...brew, stubbed: true }, ownAccount ? 'edit' : 'share')); //All stored brews are "stubbed"

	return brews;
};

// Brews tagged with `meta:theme`, in the shape the editor expects
const getUserThemes = async (account)=>{
	if(!account?.username) return {};

	const fields = ['title', 'tags', 'shareId', 'thumbnail', 'text', 'authors', 'renderer'];
	const userThemes = {};

	const brews = (await listBrews()).filter((brew)=>(brew.authors || []).includes(account.username));
	for (const stored of brews) {
		const brew = _.pick(stored, fields);
		const tags = brew.tags || [];
		if(!tags.some((tag)=>tag === 'meta:theme' || tag === 'meta:Theme')) continue;

		userThemes[brew.renderer] ??= {};
		userThemes[brew.renderer][brew.shareId] = {
			name         : brew.title,
			renderer     : brew.renderer,
			baseTheme    : brew.theme,
			baseSnippets : false,
			author       : brew.authors[0],
			path         : brew.shareId,
			thumbnail    : brew.thumbnail || './assets/naturalCritLogoWhite.svg'
		};
	}

	return userThemes;
};

const login = (username)=>{
	if(!username)
		throw apiError({ name: 'Login Error', message: 'Username required', status: 400, HBErrorCode: '00' });

	setLocalAccount(username);
	return username; // Stands in for the session token the server would hand out
};

const logout = ()=>{
	clearLocalAccount();
	return true;
};

export {
	login,
	logout,
	createBrew,
	updateBrew,
	deleteBrew,
	searchVault,
	vaultTotal,
	getUserBrews,
	getUserThemes,
	getThemeBundle,
	getStaticThemeStyles,
	themeStyleSheet,
	mergeBrewText,
	setThemeStyles,
	isStaticTheme,
	apiError,
	plainId
};
