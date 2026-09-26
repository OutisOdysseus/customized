/* A superagent-compatible shim that answers requests from localApi.js instead of
 * hitting the network. Every request made by the app in the standalone build
 * goes through here, so nothing outside this file needs to know that there is
 * no server.
 */
import { gunzipSync, strFromU8 } from 'fflate';

import * as localApi from './localApi.js';
import { getLocalAccount } from './localStore.js';

const parseUrl = (url)=>{
	const [path, search] = `${url}`.split('?');
	return { path, query: Object.fromEntries(new URLSearchParams(search || '').entries()) };
};

const decodeBody = (body)=>{
	if(body === undefined || body === null || body === '') return {};
	if(body instanceof Uint8Array || (typeof Uint8Array !== 'undefined' && ArrayBuffer.isView(body))) {
		try {
			return JSON.parse(strFromU8(gunzipSync(new Uint8Array(body))));
		} catch (err) {
			console.error('Unable to decompress the request body', err);
			return {};
		}
	}
	if(typeof body === 'string') {
		try {
			return JSON.parse(body);
		} catch (err) {
			return {};
		}
	}
	return body;
};

const routeRequest = async (method, path, query, body, account)=>{
	const pathMatch = (regexp)=>path.match(regexp);

	if(method === 'GET') {
		if(path === '/admin/notification/all') return { status: 200, body: [] };
		if(path === '/api/vault/total') return { status: 200, body: await localApi.vaultTotal(query) };
		if(path === '/api/vault') return { status: 200, body: await localApi.searchVault(query) };

		const theme = pathMatch(/^\/api\/theme\/([^/]+)\/([^/]+)$/);
		if(theme) return { status: 200, body: await localApi.getThemeBundle(decodeURIComponent(theme[1]), decodeURIComponent(theme[2])) };

		const user = pathMatch(/^\/api\/user\/([^/]+)$/);
		if(user) return { status: 200, body: await localApi.getUserBrews(decodeURIComponent(user[1]), account) };

		const remove = pathMatch(/^\/api\/remove\/(.+)$/);
		if(remove) {
			await localApi.deleteBrew(remove[1], account);
			return { status: 204, body: '' };
		}
	}

	if(method === 'POST') {
		if(path === '/api') return { status: 200, body: await localApi.createBrew(body, account) };
		if(path === '/local/login') return { status: 200, body: localApi.login(body?.username) };
	}

	if(method === 'PUT') {
		const review = pathMatch(/^\/api\/lock\/review\/request\/(.+)$/);
		if(review) return { status: 204, body: '' };

		const update = pathMatch(/^\/api\/(?:update\/)?([^/]+)$/);
		if(update) return { status: 200, body: await localApi.updateBrew(update[1], body, account) };
	}

	if(method === 'DELETE') {
		const remove = pathMatch(/^\/api\/(.+)$/);
		if(remove) {
			await localApi.deleteBrew(remove[1], account);
			return { status: 204, body: '' };
		}
	}

	throw localApi.apiError({ name: 'Not Found', message: `Unknown local endpoint: ${method} ${path}`, status: 404, HBErrorCode: '00' });
};

// Wraps an error so it looks like a failed superagent request
const wrapError = (error)=>{
	if(error?.response) return error;
	const status = error?.status || 500;
	const body = {
		name        : error?.name,
		message     : error?.message || `${error}`,
		status      : status,
		HBErrorCode : error?.HBErrorCode ?? '00'
	};
	Object.keys(error || {}).forEach((key)=>body[key] ??= error[key]);

	const wrapped = new Error(body.message);
	Object.assign(wrapped, error);
	wrapped.status = status;
	wrapped.response = { status, body, error: body, text: JSON.stringify(body), ok: false };
	return wrapped;
};

class LocalRequest {
	constructor(method, url){
		this.method = method;
		this.url = url;
		this.body = undefined;
	}

	set(key, value){
		this[key] = value; // Headers are not used by the local api; kept for parity with superagent
		return this;
	}

	send(body){
		this.body = body === undefined ? {} : body;
		return this;
	}

	execute(){
		if(!this.pending) {
			this.pending = (async ()=>{
				const { path, query } = parseUrl(this.url);
				const account = getLocalAccount();
				const response = await routeRequest(this.method, path, query, decodeBody(this.body), account);
				return {
					ok     : response.status >= 200 && response.status < 300,
					status : response.status,
					body   : response.body,
					text   : typeof response.body === 'string' ? response.body : JSON.stringify(response.body)
				};
			})().catch((err)=>{
				throw wrapError(err);
			});
		}
		return this.pending;
	}

	then(onFulfilled, onRejected){
		return this.execute().then(onFulfilled, onRejected);
	}

	catch(onRejected){
		return this.execute().catch(onRejected);
	}

	finally(onFinally){
		return this.execute().finally(onFinally);
	}

	end(callback){
		this.execute().then(
			(response)=>callback && callback(null, response),
			(error)=>callback && callback(error)
		);
		return this;
	}
}

const localRequest = {
	get    : (url)=>new LocalRequest('GET', url),
	post   : (url)=>new LocalRequest('POST', url),
	put    : (url)=>new LocalRequest('PUT', url),
	delete : (url)=>new LocalRequest('DELETE', url)
};

export default localRequest;
export { LocalRequest };
