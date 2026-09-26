import * as IDB from 'idb-keyval/dist/index.js';

/* Small key/value store kept in IndexedDB.
 *
 * Pages that are not allowed to use IndexedDB (one opened straight from the
 * filesystem, private windows in some browsers, ...) get the same little store
 * backed by localStorage instead, so the features on top of it keep working.
 */

const localStorageStore = (db, store)=>{
	const storageKey = `${db}-${store}`;

	const read = ()=>{
		try {
			return JSON.parse(window.localStorage.getItem(storageKey)) || {};
		} catch (err) {
			console.error(`Unable to read ${storageKey}`, err);
			return {};
		}
	};

	const write = (items)=>{
		try {
			window.localStorage.setItem(storageKey, JSON.stringify(items));
		} catch (err) {
			console.error(`Unable to save ${storageKey}`, err);
		}
	};

	return {
		entries : async ()=>Object.entries(read()),
		keys    : async ()=>Object.keys(read()),
		values  : async ()=>Object.values(read()),
		clear   : async ()=>write({}),
		get     : async (key)=>read()[key],
		getMany : async (keys)=>keys.map((key)=>read()[key]),
		set     : async (key, value)=>{ const items = read(); items[key] = value; write(items); },
		setMany : async (entries)=>{ write({ ...read(), ...Object.fromEntries(entries) }); },
		update  : async (key, updateFn)=>{ const items = read(); items[key] = updateFn(items[key]); write(items); },
		del     : async (key)=>{ const items = read(); delete items[key]; write(items); },
		delMany : async (keys)=>{ const items = read(); keys.forEach((key)=>delete items[key]); write(items); }
	};
};

export function initCustomStore(db, store){
	const fallback = localStorageStore(db, store);

	//Resolved once: the real store, or null when this page can't have one
	let idbStore = null;
	const resolveStore = ()=>{
		if(!idbStore) {
			idbStore = (async ()=>{
				if(typeof indexedDB === 'undefined') return null;
				try {
					const candidate = IDB.createStore(db, store);
					await IDB.values(candidate); //Touching it is what fails when the database is blocked
					return candidate;
				} catch (err) {
					console.warn(`${db} is not available, using localStorage instead`, err);
					return null;
				}
			})();
		}
		return idbStore;
	};

	const withStore = async (indexedDBAction, localStorageAction)=>{
		const target = await resolveStore();
		return target ? indexedDBAction(target) : localStorageAction();
	};

	return {
		entries : ()=>withStore((target)=>IDB.entries(target), ()=>fallback.entries()),
		keys    : ()=>withStore((target)=>IDB.keys(target), ()=>fallback.keys()),
		values  : ()=>withStore((target)=>IDB.values(target), ()=>fallback.values()),
		clear   : ()=>withStore((target)=>IDB.clear(target), ()=>fallback.clear()),
		get     : (key)=>withStore((target)=>IDB.get(key, target), ()=>fallback.get(key)),
		getMany : (keys)=>withStore((target)=>IDB.getMany(keys, target), ()=>fallback.getMany(keys)),
		set     : (key, value)=>withStore((target)=>IDB.set(key, value, target), ()=>fallback.set(key, value)),
		setMany : (entries)=>withStore((target)=>IDB.setMany(entries, target), ()=>fallback.setMany(entries)),
		update  : (key, updateFn)=>withStore((target)=>IDB.update(key, updateFn, target), ()=>fallback.update(key, updateFn)),
		del     : (key)=>withStore((target)=>IDB.del(key, target), ()=>fallback.del(key)),
		delMany : (keys)=>withStore((target)=>IDB.delMany(keys, target), ()=>fallback.delMany(keys))
	};
};
