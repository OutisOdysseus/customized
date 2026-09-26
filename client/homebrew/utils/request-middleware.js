import request from 'superagent';

import { isStandalone } from './mode.js';

const addHeader = (request)=>request.set('Homebrewery-Version', global.version);

//When running without a server (see mode.js) all requests are answered from IndexedDB
const send = (method, path)=>{
	if(!isStandalone())
		return addHeader(request[method](path));

	//Required lazily so that the standalone build's storage code is never loaded by the server build
	const localRequest = require('./localRequest.js').default;
	return localRequest[method](path);
};

const requestMiddleware = {
	get    : (path)=>send('get', path),
	put    : (path)=>send('put', path),
	post   : (path)=>send('post', path),
	delete : (path)=>send('delete', path),
};

export default requestMiddleware;
