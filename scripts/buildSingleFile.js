/* Packs the standalone (serverless) build in ./build/standalone into ONE
 * self-contained html file that can be moved anywhere and opened by itself.
 *
 * Everything the app needs is embedded in the document: the stylesheet, the
 * app bundle, every theme, font and image (as data uris). Nothing is fetched
 * from disk or from the network, so the single file behaves exactly like the
 * standalone folder does — brews still live in the browser's IndexedDB — and
 * it keeps working when IndexedDB isn't available (a `file://` page, where
 * browsers block it) by falling back to localStorage.
 *
 * The generated page keeps the assets in one `window.__HOMEBREWERY_INLINED_ASSETS__`
 * map, which client/homebrew/utils/inlineAssets.js reads at runtime, so theme
 * css and brew html that point at `/assets/...` keep working.
 *
 * Usage: npm run build:single   (runs the standalone build first)
 */
import fs   from 'fs-extra';
import path from 'path';

const IN_DIR   = './build/standalone';
const OUT_FILE = './Homebrewery.html';

//Everything that normally sits next to index.html
const ASSET_DIRS = ['assets', 'fonts', 'icons', 'themes', 'homebrew'];

const MIME_TYPES = {
	'.png'   : 'image/png',
	'.jpg'   : 'image/jpeg',
	'.jpeg'  : 'image/jpeg',
	'.gif'   : 'image/gif',
	'.svg'   : 'image/svg+xml',
	'.webp'  : 'image/webp',
	'.ico'   : 'image/x-icon',
	'.woff'  : 'font/woff',
	'.woff2' : 'font/woff2',
	'.ttf'   : 'font/ttf',
	'.otf'   : 'font/otf',
	'.eot'   : 'application/vnd.ms-fontobject',
	'.css'  : 'text/css;charset=utf-8' // eslint-disable-line key-spacing
};

const mimeType = (file)=>MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';

const listFiles = async (dir)=>{
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const files = await Promise.all(entries.map((entry)=>{
		const target = path.join(dir, entry.name);
		if(entry.isDirectory()) return listFiles(target);
		return [path.relative(IN_DIR, target).split(path.sep).join('/')];
	}));
	return files.flat();
};

const toDataUri = async (file)=>{
	const contents = await fs.readFile(file);
	return `data:${mimeType(file)};base64,${contents.toString('base64')}`;
};

/* Turns the `url(...)`s of a stylesheet into the embedded copies, using the same
 * lookup as client/homebrew/utils/inlineAssets.js */
const resolveCssUrls = (css, map)=>{
	return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, target)=>{
		if(/^(data:|https?:|blob:|#)/i.test(target)) return match;
		const inlined = map[`/${target.replace(/^\.?\//, '')}`];
		return inlined ? `url(${inlined})` : match;
	});
};

//Any url that still points at a file would need the standalone folder to be next to the page
const reportMissingCssUrls = (css, label)=>{
	const missing = new Set();
	css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, target)=>{
		if(/^(\.{0,2}\/|\/)/.test(target)) missing.add(target);
		return match;
	});
	if(missing.size)
		console.warn(`\t⚠ ${label} still has ${missing.size} url(s) that won't load: ${Array.from(missing).slice(0, 5).join(', ')}`);
};

/* Scripts are inlined as-is, so the html parser must not find a sequence in them
 * that would end (or re-open) the script block. Both escapes below are no-ops in
 * javascript: `\/` is `/` inside strings and regular expressions, and `\!` is `!`. */
//Server-side paths the bundle still mentions (they are only used when a server is there)
const serverOnlyPath = (key)=>/^\/homebrew\//.test(key) || /^\/themes\/[^/]+\/[^/]+\/style\.css$/.test(key);

const checkBundleUrls = (bundles, map)=>{
	const missing = new Set();
	bundles.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, target)=>{
		if(/^(data:|https?:|blob:|#)/i.test(target)) return match;
		const key = `/${target.replace(/^\.?\//, '')}`;
		if(!map[key] && !serverOnlyPath(key)) missing.add(key);
		return match;
	});
	const real = Array.from(missing).filter((key)=>{
		try {
			return fs.statSync(`${IN_DIR}${key}`).isFile();
		} catch {
			return false;
		}
	});
	if(real.length)
		throw new Error(`${real.length} asset(s) in the app bundle were not embedded: ${real.slice(0, 5).join(', ')}`);
	if(missing.size)
		console.warn(`\t⚠ the app bundle names ${missing.size} file(s) that don't exist in the standalone build: ${Array.from(missing).slice(0, 5).join(', ')}`);
};

const escapeForInlineScript = (js)=>{
	return js.replace(/<\/script/gi, '\\x3c/script').replace(/<!--/g, '\\x3c!--');
};

/* The app stylesheet is kept as one string: the page fills its <style> from it and
 * the brew renderer puts the same text into the iframe it renders in. */
const writeStyleLoader = ()=>`(function(){
	var style = document.getElementById('homebreweryStyles');
	if(style) style.textContent = window.__HOMEBREWERY_APP_CSS__;
})();`;

const packIntoHtml = async (html, bundles)=>{
	/* The app bundle carries the compiled themes, whose fonts/images are named as
	 * relative paths; every one of them has to be in the map, or the single file
	 * would be missing that picture. */
	const map = {};

	console.log('\tembedding assets');
	const files = (await Promise.all(ASSET_DIRS.map((dir)=>listFiles(`${IN_DIR}/${dir}`)))).flat();
	for (const file of files){
		//Stylesheets are handled below: their urls are rewritten before embedding
		if(file.endsWith('.css')) continue;
		map[`/${file}`] = await toDataUri(`${IN_DIR}/${file}`);
	}

	console.log('\tembedding stylesheets');
	const appCss = resolveCssUrls(await fs.readFile(`${IN_DIR}/bundle.css`, 'utf8'), map);
	reportMissingCssUrls(appCss, 'bundle.css');
	if(/<\/style/i.test(appCss))
		throw new Error('The app stylesheet contains a `</style` sequence');

	checkBundleUrls(bundles, map);

	//The app stylesheet is filled in from the map at load, so it is only stored once
	const assetScript = [
		`window.__HOMEBREWERY_INLINED_ASSETS__ = ${escapeForInlineScript(JSON.stringify(map))};`,
		`window.__HOMEBREWERY_APP_CSS__ = ${escapeForInlineScript(JSON.stringify(appCss))};`,
		writeStyleLoader()
	].join('\n');

	const favicon = map['/assets/favicon.ico'];
	//Every replacement is made with a function: the scripts are full of `$&` and
	//friends, which a string replacement would happily interpolate
	const packed = html
		.replace(/<link[^>]*href=["']bundle\.css["'][^>]*>/i, ()=>'<style id="homebreweryStyles"></style>')
		.replace(/<link[^>]*rel=["']icon["'][^>]*>/i, ()=>`<link rel="icon" href="${favicon}" type="image/x-icon" />`)
		.replace(/<script src=["']bundle\.js["']><\/script>/i, ()=>[
			`<script>${escapeForInlineScript(assetScript)}</script>`,
			`<script>${escapeForInlineScript(bundles)}</script>`
		].join('\n\t\t'));

	//The html parser has to see exactly the two script blocks that were written
	const closers = (packed.match(/<\/script/gi) || []).length;
	if(closers !== 2)
		throw new Error(`The packed page has ${closers} script closers instead of 2`);

	return packed;
};

(async ()=>{
	console.log('\nPacking the standalone build into a single html file\n');

	if(!await fs.pathExists(`${IN_DIR}/index.html`) || !await fs.pathExists(`${IN_DIR}/bundle.js`))
		throw new Error(`No standalone build found in ${IN_DIR}; run \`npm run build:standalone\` first`);

	const html = await packIntoHtml(
		await fs.readFile(`${IN_DIR}/index.html`, 'utf8'),
		await fs.readFile(`${IN_DIR}/bundle.js`, 'utf8')
	);

	await fs.outputFile(OUT_FILE, html);

	const size = (await fs.stat(OUT_FILE)).size;
	console.log(`\nSingle-file build ready: ${OUT_FILE} (${(size / 1024 / 1024).toFixed(1)} MB)`);
	console.log('\tDouble-click it, or drop it on a browser tab. Every asset is inside the file,');
	console.log('\tso it works on its own; brews are saved in the browser\'s IndexedDB (or in');
	console.log('\tlocalStorage where IndexedDB is unavailable, such as page opened from disk).\n');
})().catch((err)=>{
	console.error(err);
	process.exit(1);
});
