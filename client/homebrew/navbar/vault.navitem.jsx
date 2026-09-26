const React = require('react');

const Nav = require('naturalcrit/nav/nav.jsx');
const { href } = require('../utils/navigation.js');

module.exports = function (props) {
	return (
		<Nav.item
			color='purple'
			icon='fas fa-dungeon'
			href={href('/vault')}
			newTab={false}
			rel='noopener noreferrer'
		>
			Vault
		</Nav.item>
	);
};
