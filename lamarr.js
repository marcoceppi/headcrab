var Browser = require('zombie'),
	assert  = require('assert');

exports.procreate = function(url, cb)
{
	browser = new Browser();
	browser.visit('http://marcoceppi.com', function(e, browser, status)
	{
		anchorsAway = browser.document.querySelectorAll('a');
		for(var anchor in anchorsAway)
		{
			dom_attr = anchorsAway[anchor]._attributes;
			if( typeof dom_attr == 'object' && dom_attr.hasOwnProperty('href') )
			{
				console.log(dom_attr.href._nodeValue);
			}
		}
	});
}

