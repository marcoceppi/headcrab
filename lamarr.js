var Browser = require('zombie'),
	assert  = require('assert');

// All Lamarr wants to do is couple with you.
exports.procreate = function(url, cb)
{
	browser = new Browser();
	browser.runScripts = false;
	browser.silent = true;
	// Trust me for now that URL will be a fully qualified URL.
	// Don't trust anyone else though
	browser.visit(url, function(e, browser, status)
	{
		process.nextTick(function()
		{
			anchorsAway = browser.document.querySelectorAll('a');
			var urls = new Array();
			for(var anchor in anchorsAway)
			{
				dom_attr = anchorsAway[anchor]._attributes;
				if( typeof dom_attr == 'object' && dom_attr.hasOwnProperty('href') )
				{
					href = dom_attr.href._nodeValue;
					if( href && href.charAt(0) != '#' )
					{
						urls.push(href);
					}
				}
			}
			cb(null, urls, status, browser);
		});
	});
}

