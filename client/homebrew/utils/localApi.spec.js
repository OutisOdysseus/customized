/**
 * @jest-environment jsdom
 */
// eslint-disable-next-line import/no-unassigned-import
import 'fake-indexeddb/auto'; // IndexedDB implementation for the test environment
import { gzipSync, strToU8 } from 'fflate';
import { clear, createStore } from 'idb-keyval/dist/index.js';

import * as api from './localApi.js';
import localRequest from './localRequest.js';
import { findBrew, getLocalAccount, listBrews, newId, setLocalAccount, clearLocalAccount } from './localStore.js';

const brewStore = createStore('HOMEBREWERY-BREWS', 'BREWS');

const TEST_STYLES = { V3: { Blank: '/* blank theme */', '5ePHB': '/* phb theme */' }, Legacy: { '5ePHB': '/* legacy theme */' } };

const editPagePayload = (overrides = {})=>({
	title       : 'Test Brew',
	description : 'A brew written by the tests',
	text        : '# Test Brew\n\nHello **world**\n',
	style       : '.page { color: red; }',
	renderer    : 'V3',
	theme       : 'Blank',
	lang        : 'en',
	tags        : ['test'],
	systems     : ['5e'],
	pageCount   : 1,
	snippets    : '\\snippet test\nsome text\n',
	...overrides
});

beforeEach(async ()=>{
	await clear(brewStore);
	clearLocalAccount();
	api.setThemeStyles(TEST_STYLES);
});

describe('localApi', ()=>{
	it('creates a brew with the same defaults the server applies', async()=>{
		const account = { username: 'alice' };
		const brew = await api.createBrew(editPagePayload(), account);

		expect(brew.editId).toMatch(/^[a-zA-Z0-9-_]{7,14}$/);
		expect(brew.shareId).toMatch(/^[a-zA-Z0-9-_]{7,14}$/);
		expect(brew.editId).not.toEqual(brew.shareId);
		expect(brew.authors).toEqual(['alice']);
		expect(brew.version).toBe(1);
		expect(brew.published).toBe(false);
		expect(brew.views).toBe(0);
		expect(brew.gDrive).toBe(false);

		//The stored text holds the css and metadata sections
		expect(brew.text.startsWith('```metadata\n')).toBe(true);
		expect(brew.text).toContain('```css');
		expect(brew.text).toContain('.page { color: red; }');
		expect(brew.text.match(/```css/g)).toHaveLength(1);
		expect(brew.text.match(/```metadata/g)).toHaveLength(1);
	});

	it('loads a brew back with the sections split apart', async()=>{
		const saved = await api.createBrew(editPagePayload(), { username: 'alice' });
		const loaded = await findBrew({ editId: saved.editId });

		expect(loaded).toBeTruthy();
		const split = api.splitTextStyleAndMetadata ? null : null; // (split helper lives in shared/helpers)
		const { splitTextStyleAndMetadata } = require('../../../shared/helpers.js');
		splitTextStyleAndMetadata(loaded);

		expect(loaded.title).toBe('Test Brew');
		expect(loaded.renderer).toBe('V3');
		expect(loaded.theme).toBe('Blank');
		expect(loaded.tags).toEqual(['test']);
		expect(loaded.style.trim()).toBe('.page { color: red; }');
		expect(loaded.text).toBe('# Test Brew\n\nHello **world**\n');
		expect(loaded.snippets).toContain('\\snippet test');
	});

	it('updates a brew without duplicating the stored sections', async()=>{
		const saved = await api.createBrew(editPagePayload(), { username: 'alice' });

		const updated = await api.updateBrew(saved.editId, editPagePayload({ text: '# Second Title\n\nnew text\n', version: saved.version }), { username: 'alice' });

		expect(updated.version).toBe(2);
		expect(updated.editId).toBe(saved.editId);
		expect(updated.shareId).toBe(saved.shareId);
		expect(updated.text.match(/```css/g)).toHaveLength(1);
		expect(updated.text.match(/```metadata/g)).toHaveLength(1);
		expect(updated.text).toContain('# Second Title');

		const loaded = await findBrew({ editId: saved.editId });
		expect(loaded.text.match(/```css/g)).toHaveLength(1);
		expect(loaded.text).toContain('.page { color: red; }');
		expect(loaded.text).not.toContain('Hello **world**');
	});

	it('keeps other authors when one of them deletes a shared brew', async()=>{
		const saved = await api.createBrew(editPagePayload(), { username: 'alice' });
		await api.updateBrew(saved.editId, editPagePayload(), { username: 'bob' });

		const result = await api.deleteBrew(saved.editId, { username: 'bob' });
		expect(result).toEqual({ deleted: false });

		const after = await findBrew({ editId: saved.editId });
		expect(after.authors).toEqual(['alice']);
	});

	it('deletes the document once the last author removes themselves', async()=>{
		const saved = await api.createBrew(editPagePayload(), { username: 'alice' });
		const result = await api.deleteBrew(saved.editId, { username: 'alice' });

		expect(result).toEqual({ deleted: true });
		expect(await findBrew({ editId: saved.editId })).toBeNull();
	});

	it('builds a theme bundle from the static themes', async()=>{
		const bundle = await api.getThemeBundle('V3', '5ePHB');

		expect(bundle.name).toBe('5ePHB');
		//Oldest parent first
		expect(bundle.styles[0]).toContain('/* blank theme */');
		expect(bundle.styles[1]).toContain('/* phb theme */');
		expect(bundle.snippets).toEqual(['V3_Blank', 'V3_5ePHB']);
	});

	it('errors like the server does when a theme does not exist', async()=>{
		await expect(api.getThemeBundle('V3', 'nope123456')).rejects.toMatchObject({ status: 404, HBErrorCode: '09' });
	});

	it('only lists published brews on someone else\'s user page', async()=>{
		const mine = await api.createBrew(editPagePayload({ published: true }), { username: 'alice' });
		const priv = await api.createBrew(editPagePayload({ title: 'Private' }), { username: 'alice' });

		const own = await api.getUserBrews('alice', { username: 'alice' });
		expect(own.map((brew)=>brew.title).sort()).toEqual(['Private', 'Test Brew']);
		expect(own.every((brew)=>brew.editId)).toBe(true);
		expect(own.every((brew)=>brew.text === undefined)).toBe(true);

		const other = await api.getUserBrews('alice', { username: 'bob' });
		expect(other).toHaveLength(1);
		expect(other[0].shareId).toBe(mine.shareId);
		expect(other[0].editId).toBeUndefined();
		expect(other[0].stubbed).toBe(true);
	});

	it('searches the vault like the server does', async()=>{
		await api.createBrew(editPagePayload({ title: 'Published', published: true }), { username: 'alice' });
		await api.createBrew(editPagePayload({ title: 'Hidden' }), { username: 'alice' });

		const all = await api.searchVault({});
		expect(all.brews.map((brew)=>brew.title)).toEqual(['Published']);
		expect(all.page).toBe(1);

		const none = await api.searchVault({ title: 'nothing' });
		expect(none.brews).toHaveLength(0);

		const total = await api.vaultTotal({});
		expect(total.totalBrews).toBe(1);
	});

	it('remembers the signed in account', async()=>{
		expect(getLocalAccount()).toBeNull();

		api.login('alice');
		expect(getLocalAccount().username).toBe('alice');

		api.logout();
		expect(getLocalAccount()).toBeNull();
	});
});

describe('localRequest (the superagent shim)', ()=>{
	it('answers the endpoints the client calls', async()=>{
		const res = await localRequest.post('/api').send(editPagePayload());
		expect(res.status).toBe(200);
		expect(res.body.editId).toHaveLength(12);

		const updated = await localRequest.put(`/api/update/${res.body.editId}`)
			.set('Content-Encoding', 'gzip')
			.send(gzipSync(strToU8(JSON.stringify(editPagePayload({ text: 'updated' })))));
		expect(updated.body.version).toBe(2);
		expect(updated.ok).toBe(true);

		const theme = await localRequest.get('/api/theme/V3/5ePHB');
		expect(theme.body.snippets).toEqual(['V3_Blank', 'V3_5ePHB']);

		const notifications = await localRequest.get('/admin/notification/all');
		expect(notifications.body).toEqual([]);

		const deleted = await localRequest.delete(`/api/${res.body.editId}`);
		expect(deleted.status).toBe(204);
		expect(deleted.ok).toBe(true);
	});

	it('rejects like superagent, with the server error body attached', async()=>{
		const err = await localRequest.get('/api/theme/V3/nope123456').catch((e)=>e);

		expect(err.status).toBe(404);
		expect(err.response.status).toBe(404);
		expect(err.response.body.HBErrorCode).toBe('09');
		expect(err.response.body.message).toBe('Theme Not Found');
	});
});

describe('localStore', ()=>{
	it('generates unused ids', async()=>{
		const first = await newId('editId');
		await api.createBrew({ ...editPagePayload(), editId: first }, { username: 'alice' });

		const ids = new Set();
		for(let i = 0; i < 5; i++) ids.add(await newId('editId'));
		expect(ids.size).toBe(5);
		expect(ids.has(first)).toBe(false);
	});

	it('falls back to localStorage where IndexedDB is unavailable (file:// pages)', async()=>{
		const indexedDB = global.indexedDB;
		global.indexedDB = undefined; // What a browser reports on an opaque origin
		jest.resetModules();
		window.localStorage.clear();

		// eslint-disable-next-line global-require
		const fallbackApi = require('./localApi.js');

		const saved = await fallbackApi.createBrew(editPagePayload(), { username: 'alice' });
		expect(saved.editId).toHaveLength(12);
		expect(JSON.parse(window.localStorage.getItem('HOMEBREWERY-LOCAL-BREWS'))).toHaveLength(1);

		const loaded = await fallbackApi.getUserBrews('alice', { username: 'alice' });
		expect(loaded.map((brew)=>brew.title)).toEqual(['Test Brew']);

		await fallbackApi.deleteBrew(saved.editId, { username: 'alice' });
		expect(JSON.parse(window.localStorage.getItem('HOMEBREWERY-LOCAL-BREWS'))).toHaveLength(0);

		global.indexedDB = indexedDB;
		jest.resetModules();
	});

	it('lists every stored brew', async()=>{
		await api.createBrew(editPagePayload(), { username: 'alice' });
		await api.createBrew(editPagePayload(), { username: 'bob' });
		expect(await listBrews()).toHaveLength(2);
	});
});
