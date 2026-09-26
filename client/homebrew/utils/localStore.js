/* Browser storage for brews, used by the standalone (serverless) build.
 *
 * Brews are stored exactly like the server stores them: one record per brew,
 * keyed by its `editId`, with the metadata / css / text sections merged into a
 * single `text` string (see mergeBrewText() in localApi.js) so that a brew can
 * be split apart again by splitTextStyleAndMetadata() when it is loaded.
 *
 * Records live in IndexedDB, except on pages opened straight off the filesystem
 * (an opaque origin, where browsers block IndexedDB); there the same records are
 * kept in localStorage so the app still works without a server.
 */
import * as IDB from 'idb-keyval/dist/index.js';

const DB_NAME = 'HOMEBREWERY-BREWS';
const BREW_STORE = 'BREWS';

const ACCOUNT_KEY = 'HOMEBREWERY-LOCAL-ACCOUNT';

//Browsers refuse IndexedDB for pages opened straight off the filesystem (an opaque
//origin), so everything falls back to localStorage there
const FALLBACK_KEY = 'HOMEBREWERY-LOCAL-BREWS';

//The store is only built when IndexedDB is actually usable: opening a database
//is what fails (or throws outright) on pages that are not allowed to use one
let brewStore = null;
const getBrewStore = ()=>{
	if(!brewStore) brewStore = IDB.createStore(DB_NAME, BREW_STORE);
	return brewStore;
};

let store = null; // 'idb' or 'local', decided by the first read

const useLocalStorage = ()=>({
	list : ()=>{
		try {
			return JSON.parse(window.localStorage.getItem(FALLBACK_KEY)) || [];
		} catch (err) {
			console.error('Unable to read brews from localStorage', err);
			return [];
		}
	},
	write : (brews)=>{
		try {
			window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(brews));
		} catch (err) {
			console.error('Unable to save brews to localStorage', err);
			window.alert('Unable to save this brew: your browser storage is full.');
		}
	}
});

// Decides where brews are kept, once per page load
const resolveStore = async ()=>{
	if(store) return store;
	if(typeof indexedDB === 'undefined') {
		store = 'local';
		return store;
	}
	try {
		await IDB.values(getBrewStore());
		store = 'idb';
	} catch (err) {
		console.warn('IndexedDB is not available, brews are saved in localStorage instead', err);
		store = 'local';
	}
	return store;
};

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
const ID_LENGTH = 12; // Same length as server generated ids (7-14 characters)

const randomId = ()=>{
	const bytes = new Uint8Array(ID_LENGTH);
	if(typeof crypto !== 'undefined' && crypto.getRandomValues)
		crypto.getRandomValues(bytes);
	else
		for (let i = 0; i < ID_LENGTH; i++) bytes[i] = Math.floor(Math.random() * 256);

	return Array.from(bytes, (byte)=>ID_ALPHABET[byte % ID_ALPHABET.length]).join('');
};

const listBrews = async ()=>{
	if(await resolveStore() === 'local')
		return useLocalStorage().list();

	try {
		return await IDB.values(getBrewStore()) || [];
	} catch (err) {
		console.error('Unable to read brews from IndexedDB', err);
		return [];
	}
};

const saveBrew = async (brew)=>{
	if(await resolveStore() === 'local') {
		const brews = useLocalStorage().list().filter((existing)=>existing.editId !== brew.editId);
		brews.push(brew);
		useLocalStorage().write(brews);
		return brew;
	}

	await IDB.set(brew.editId, brew, getBrewStore());
	return brew;
};

const deleteBrewRecord = async (brew)=>{
	if(await resolveStore() === 'local') {
		useLocalStorage().write(useLocalStorage().list().filter((existing)=>existing.editId !== brew.editId));
		return;
	}

	await IDB.del(brew.editId, getBrewStore());
};

// Finds a brew by editId (and/or shareId)
const findBrew = async ({ editId, shareId })=>{
	const brews = await listBrews();
	if(editId) {
		const match = brews.find((brew)=>brew.editId === editId);
		if(match) return match;
	}
	if(shareId)
		return brews.find((brew)=>brew.shareId === shareId) || null;
	return null;
};

// Generates an id that is not used by any other brew
const newId = async (field = 'editId')=>{
	const brews = await listBrews();
	let id = randomId();
	while (brews.some((brew)=>brew[field] === id)) id = randomId();
	return id;
};

const getLocalAccount = ()=>{
	try {
		const username = window.localStorage.getItem(ACCOUNT_KEY);
		if(!username) return null;
		return { username, issued: window.localStorage.getItem(`${ACCOUNT_KEY}-ISSUED`) };
	} catch (err) {
		console.error('Unable to read the local account', err);
		return null;
	}
};

const setLocalAccount = (username)=>{
	window.localStorage.setItem(ACCOUNT_KEY, username);
	window.localStorage.setItem(`${ACCOUNT_KEY}-ISSUED`, new Date().toISOString());
};

const clearLocalAccount = ()=>{
	window.localStorage.removeItem(ACCOUNT_KEY);
	window.localStorage.removeItem(`${ACCOUNT_KEY}-ISSUED`);
};

export {
	listBrews,
	saveBrew,
	deleteBrewRecord,
	findBrew,
	newId,
	getLocalAccount,
	setLocalAccount,
	clearLocalAccount
};
