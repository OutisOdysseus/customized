/* Support for the single-file build: a copy of the whole app packed into one
 * html document where every image, font and stylesheet is embedded as a data
 * uri instead of sitting next to the file.
 *
 * scripts/buildSingleFile.js injects that map as
 * `window.__HOMEBREWERY_INLINED_ASSETS__` before the app bundle runs; the
 * helpers below are no-ops in every other build, where the map is simply absent
 * and the assets keep being loaded from their normal paths.
 */
const assetMap = ()=>{
	if(typeof window === 'undefined') return null;
	return window.__HOMEBREWERY_INLINED_ASSETS__ || null;
};

// '/themes/V3/5ePHB/dropdownPreview.png' => 'data:image/png;base64,...'
// Accepts the same paths as assetUrl ('/x', './x' and 'x' all mean the same asset)
const inlineAsset = (path)=>{
	const map = assetMap();
	if(!map || !path) return null;
	const text = `${path}`;
	if(/^(data:|https?:|blob:|#)/i.test(text)) return null;
	return map[`/${text.replace(/^\.?\//, '')}`] || null;
};

// The app's own stylesheet, when the single-file build carries it in the page
const appStyles = ()=>{
	if(typeof window === 'undefined') return null;
	return window.__HOMEBREWERY_APP_CSS__ || null;
};

// Rewrite the `url(...)`s of a stylesheet (theme css, brew css, ...) so that the
// embedded fonts and images are used instead of files that aren't there
const resolveCssUrls = (css)=>{
	if(!assetMap() || !css) return css;
	return `${css}`.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, path)=>{
		const inlined = inlineAsset(path);
		return inlined ? `url(${inlined})` : match;
	});
};

// Same, for the src/href attributes of rendered brew html
const inlineHtmlAssets = (html)=>{
	if(!assetMap() || !html) return html;
	return `${html}`.replace(/\b(src|href)=(['"])([^'"]+)\2/gi, (match, attribute, quote, path)=>{
		const inlined = inlineAsset(path);
		return inlined ? `${attribute}=${quote}${inlined}${quote}` : match;
	});
};

export { assetMap, inlineAsset, appStyles, resolveCssUrls, inlineHtmlAssets };
