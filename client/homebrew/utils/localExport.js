/* Downloading and viewing brew sources without a server.
 *
 * On the server build these are two small pages (`/download/:id` and
 * `/source/:id`) that stream the brew's text file. Offline the same text is
 * rebuilt from IndexedDB and handed to the browser as a blob, so the menu
 * entries behave the same way.
 */
import { isStandalone } from './mode.js';
import { findBrew } from './localStore.js';
import { plainId } from './localApi.js';

// Mirrors the sanitizeFilename() the server uses when naming the download
const sanitizeFileName = (name)=>`${name}`.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/^-+|-+$/g, '').trim();

const getBrewForExport = async (shareId)=>{
	const brew = await findBrew({ shareId: plainId(`${shareId}`) });
	if(!brew) throw new Error('Brew not found');
	return brew;
};

const saveBlob = (blob, fileName)=>{
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = fileName;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(()=>URL.revokeObjectURL(url), 1000);
};

// Same file the server would send from /download/:id (`HB - <title>.txt`)
const downloadBrew = async (shareId)=>{
	try {
		const brew = await getBrewForExport(shareId);
		const fileName = sanitizeFileName(`HB - ${brew.title}`).replaceAll(' ', '') || 'HB-Untitled-Brew';
		saveBlob(new Blob([brew.text], { type: 'text/plain;charset=utf-8' }), `${fileName}.txt`);
	} catch (err) {
		console.error('Unable to download brew', err);
		window.alert('Unable to download this brew.');
	}
};

// Same markup the server renders for /source/:id
const openBrewSource = async (shareId)=>{
	try {
		const brew = await getBrewForExport(shareId);
		const escape = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
		const text = `${brew.text}`.replaceAll('&', escape['&']).replaceAll('<', escape['<']).replaceAll('>', escape['>']);
		const source = `<code><pre style="white-space: pre-wrap;">${text}</pre></code>`;
		const url = URL.createObjectURL(new Blob([source], { type: 'text/html;charset=utf-8' }));
		window.open(url, '_blank');
		setTimeout(()=>URL.revokeObjectURL(url), 60000);
	} catch (err) {
		console.error('Unable to open brew source', err);
		window.alert('Unable to open this brew\'s source.');
	}
};

/* Props for the download / source links: a normal link when there is a server to
 * answer it, and a plain click handler when there isn't. */
const serverLinkProps = (path, action)=>(isStandalone() ? { onClick: action } : { href: path });

export {
	downloadBrew,
	openBrewSource,
	serverLinkProps,
	sanitizeFileName
};
