/* Builds the standalone (serverless) version of the Homebrewery into ./build/standalone
 *
 * The result is a folder of static files that can be opened directly from disk
 * (or served by any plain static file host) with no server and no database:
 * brews live in the browser's IndexedDB, so nothing here talks to a backend.
 *
 * Differences to the regular `npm run build`:
 *   - routes are read from the location hash (`index.html#/edit/abc123`), since a
 *     static file can't be reached at `/edit/abc123`
 *   - every theme's less is precompiled into themeStyles.json and bundled, instead
 *     of being loaded from `/themes/<renderer>/<theme>/style.css`
 *   - all asset urls are rewritten to be relative, so the folder can be moved or
 *     opened from the filesystem
 *
 * Usage: npm run build:standalone
 */
import fs   from 'fs-extra';
import Proj from './project.json' with { type: 'json' };
import vitreum from 'vitreum';
const { pack } = vitreum;

import lessTransform  from 'vitreum/transforms/less.js';
import assetTransform from 'vitreum/transforms/asset.js';
import babel          from '@babel/core';
import babelConfig    from '../babel.config.json' with { type : 'json' };
import less           from 'less';

const OUT_DIR = './build/standalone';

const isDev = !!process.argv.find((arg)=>arg === '--dev');

const babelify = async (code)=>(await babel.transformAsync(code, babelConfig)).code;

/* Every asset url in the css (fonts, paper textures, icons) is made relative to
 * the root of the standalone folder, so the whole thing can be opened straight
 * from the filesystem. */
const rewriteCssUrls = (css)=>{
	return css.replace(/url\((\s*)(["']?)([^"')]+)\2(\s*)\)/g, (match, space, quote, target, trailingSpace)=>{
		if(/^(data:|https?:|\/\/|#|\.\/)/i.test(target)) return match;
		const relative = target.replace(/^(\.\.\/)+/, '').replace(/^\/+/, '');
		return `url(./${relative})`;
	});
};

//Anything that still points somewhere else would need a server to resolve
const warnAboutCssUrls = (css, label)=>{
	const leftovers = new Set();
	css.replace(/url\((\s*)(["']?)([^"')]+)\2(\s*)\)/g, (match, space, quote, target)=>{
		if(!/^(data:|https?:|\/\/|#|\.\/)/i.test(target)) leftovers.add(target);
		return match;
	});
	if(leftovers.size)
		console.warn(`\t⚠ ${label} still references ${leftovers.size} url(s) that may not load: ${Array.from(leftovers).slice(0, 5).join(', ')}`);
};

const standaloneAssets = (dest)=>async (code, filename, opts)=>{
	const result = await assetTransform(dest)(code, filename, opts);
	// Files are copied next to the bundle, so they are referenced relatively
	return result.replace(/^module\.exports='\/(\.\.\/)*/, "module.exports='./");
};

const standaloneTransforms = {
	'.js'   : (code)=>babelify(code),
	'.jsx'  : (code)=>babelify(code),
	'.less' : lessTransform,
	'.md'   : (code)=>`module.exports=${JSON.stringify(code)};`, //The docs pages are markdown files
	'*'     : standaloneAssets(OUT_DIR)
};

//==== Themes: compile every static theme into a json the bundle can ship ====//
const compileThemes = async ()=>{
	const themes = JSON.parse(fs.readFileSync('./themes/themes.json').toString());
	const compiled = {};
	let count = 0;

	for (const renderer of Object.keys(themes)) {
		compiled[renderer] = {};
		for (const themeName of Object.keys(themes[renderer])) {
			const themePath = `${themes[renderer][themeName].path}`;
			const source = fs.readFileSync(`./themes/${renderer}/${themePath}/style.less`).toString();
			const { css } = await less.render(source, { compress: !isDev });
			compiled[renderer][themeName] = rewriteCssUrls(css);
			warnAboutCssUrls(compiled[renderer][themeName], `theme ${renderer}/${themePath}`);
			count++;

			//Kept as files too: the editor lists and the renderer's fallback load them by url
			await fs.outputFile(`${OUT_DIR}/themes/${renderer}/${themePath}/style.css`, compiled[renderer][themeName]);

			//Dropdown previews are loaded by url from the editor
			for (const image of ['dropdownPreview.png', 'dropdownTexture.png']) {
				const from = `./themes/${renderer}/${themePath}/${image}`;
				if(fs.existsSync(from))
					await fs.copy(from, `${OUT_DIR}/themes/${renderer}/${themePath}/${image}`);
			}
		}
	}

	//The bundle requires this file, so it has to exist before packing
	await fs.outputFile(`${OUT_DIR}/themeStyles.json`, JSON.stringify(compiled));
	console.log(`\tcompiled ${count} themes`);
};

//==== Assets that the app loads by url (fonts, textures, icons, ...) ====//
const copyAssets = async ()=>{
	await fs.copy('./themes/assets', `${OUT_DIR}/assets`);
	await fs.copy('./themes/fonts', `${OUT_DIR}/fonts`);
	await fs.copy('./client/icons', `${OUT_DIR}/icons`);

	//The favicon is referenced from index.html (the other icons are `require`d from
	//js, and get copied next to the bundle by the packer)
	await fs.copy('./client/homebrew/favicon.ico', `${OUT_DIR}/assets/favicon.ico`);
	console.log('\tcopied assets');
};

//==== CodeMirror themes are loaded by url from the editor ====//
const copyEditorThemes = async ()=>{
	await fs.copy('./node_modules/codemirror/theme', `${OUT_DIR}/homebrew/cm-themes`);
	await fs.copy('./themes/codeMirror/customThemes', `${OUT_DIR}/homebrew/cm-themes`);
	await fs.copy('./themes/codeMirror', `${OUT_DIR}/homebrew/codeMirror`);
};

const writeIndexHtml = async ()=>{
	const html = `<!DOCTYPE html>
<html>
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1, height=device-height, interactive-widget=resizes-visual" />
		<link href="//fonts.googleapis.com/css?family=Open+Sans:400,300,600,700" rel="stylesheet" type="text/css" />
		<link href="bundle.css" type="text/css" rel="stylesheet" />
		<link rel="icon" href="assets/favicon.ico" type="image/x-icon" />
		<meta name="twitter:card" content="summary">
		<title>The Homebrewery - NaturalCrit</title>
		<style>
			#standaloneLoading {
				position         : fixed;
				top              : 0;
				right            : 0;
				bottom           : 0;
				left             : 0;
				display          : flex;
				align-items      : center;
				justify-content  : center;
				font-family      : 'Open Sans', sans-serif;
				font-size        : 20px;
				color            : #4a4a4a;
				background-color : #f2f0ec;
			}
		</style>
	</head>
	<body>
		<main id="reactRoot"></main>
		<div id="standaloneLoading">Loading the Homebrewery&hellip;</div>
		<script src="bundle.js"></script>
	</body>
</html>
`;
	await fs.outputFile(`${OUT_DIR}/index.html`, html);
};

(async ()=>{
	console.log('\nBuilding the standalone (serverless) Homebrewery\n');

	await fs.emptyDir(OUT_DIR);

	await compileThemes();
	await copyAssets();
	await copyEditorThemes();

	const bundles = await pack('./client/standalone.jsx', {
		paths      : ['./shared', './'],
		libs       : Proj.libs,
		dev        : false,
		transforms : standaloneTransforms
	});

	const css = rewriteCssUrls(await lessTransform.generate({ paths: './shared' }));
	warnAboutCssUrls(css, 'bundle.css');

	await fs.outputFile(`${OUT_DIR}/bundle.css`, css);
	await fs.outputFile(`${OUT_DIR}/bundle.js`, await bundles.bundle);
	await writeIndexHtml();

	//The compiled themes are inside the bundle by now
	await fs.remove(`${OUT_DIR}/themeStyles.json`);

	console.log(`\nStandalone build ready in ${OUT_DIR}`);
	console.log('\tOpen index.html in a browser (double-clicking it works), or serve the folder');
	console.log('\twith any static file server. All brews are saved in your browser\'s IndexedDB.\n');
})().catch((err)=>{
	console.error(err);
	process.exit(1);
});
