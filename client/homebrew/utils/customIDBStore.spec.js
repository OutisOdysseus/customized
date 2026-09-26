/**
 * @jest-environment jsdom
 */
import 'fake-indexeddb/auto'; // IndexedDB implementation for the test environment

import { initCustomStore } from './customIDBStore.js';

const DB = 'HOMEBREWERY-TEST-DB';
const STORE = 'HISTORY';

const reset = ()=>{
	window.localStorage.clear();
	window.indexedDB = global.indexedDB;
	jest.resetModules();
};

afterEach(reset);

describe('the custom key/value store', ()=>{
	it('reads and writes through IndexedDB', async()=>{
		const store = initCustomStore(DB, STORE);

		await store.set('brew-1', { text: 'first' });
		await store.set('brew-2', { text: 'second' });

		expect(await store.get('brew-1')).toEqual({ text: 'first' });
		expect(await store.keys()).toEqual(['brew-1', 'brew-2']);
		expect(await store.getMany(['brew-2', 'brew-1'])).toEqual([{ text: 'second' }, { text: 'first' }]);

		await store.update('brew-1', (item)=>({ ...item, text: 'edited' }));
		expect(await store.get('brew-1')).toEqual({ text: 'edited' });

		await store.del('brew-2');
		expect(await store.values()).toEqual([{ text: 'edited' }]);

		await store.clear();
		expect(await store.entries()).toEqual([]);

		expect(window.localStorage.getItem(`${DB}-${STORE}`)).toBeNull();
	});

	it('falls back to localStorage where IndexedDB is not available', async()=>{
		window.indexedDB = undefined; //What a page opened from the filesystem sees
		jest.resetModules();

		const { initCustomStore: freshStore } = require('./customIDBStore.js');
		const store = freshStore(DB, STORE);

		const warn = jest.spyOn(console, 'warn').mockImplementation(()=>{});
		await store.setMany([['brew-1', { text: 'first' }], ['brew-2', { text: 'second' }]]);
		warn.mockRestore();

		expect(await store.get('brew-1')).toEqual({ text: 'first' });
		expect(await store.keys()).toEqual(['brew-1', 'brew-2']);
		expect(await store.getMany(['brew-2'])).toEqual([{ text: 'second' }]);

		await store.update('brew-1', (item)=>({ ...item, text: 'edited' }));
		await store.delMany(['brew-2']);

		expect(JSON.parse(window.localStorage.getItem(`${DB}-${STORE}`))).toEqual({ 'brew-1': { text: 'edited' } });

		await store.clear();
		expect(await store.values()).toEqual([]);
	});
});
