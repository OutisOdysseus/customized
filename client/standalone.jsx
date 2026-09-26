/* Entry point for the standalone (serverless) build.
 *
 * It renders the exact same app as the regular build, but the props the server
 * normally provides are assembled in the browser instead: the route is read
 * from the location hash, brews and themes come out of IndexedDB, and every api
 * call is answered locally (see homebrew/standalone/bootstrap.js).
 *
 * Build it with: npm run build:standalone, then open build/standalone/index.html
 */
import React from 'react';

import Homebrew           from './homebrew/homebrew.jsx';
import { bootStandalone } from './homebrew/standalone/bootstrap.js';

const Standalone = (props)=>React.createElement(Homebrew, props);

module.exports = Standalone;

//Start the app as soon as the bundle loads in a browser
//(never while the build tool is walking the dependency graph)
if(typeof window !== 'undefined' && typeof document !== 'undefined')
	bootStandalone();
