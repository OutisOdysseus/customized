/* The markdown pages that the server normally reads off disk and renders into
 * the initial page load. The standalone build bundles them instead.
 * (.md files are turned into plain strings by the standalone build's transforms)
 */
const welcome       = require('../pages/homePage/welcome_msg.md');
const welcomeLegacy = require('../pages/homePage/welcome_msg_legacy.md');
const migrate       = require('../pages/homePage/migrate.md');
const changelog     = require('../../../changelog.md');
const faq           = require('../../../faq.md');

export {
	welcome,
	welcomeLegacy,
	migrate,
	changelog,
	faq
};
