var redis  = require('redis'),
	lamarr = require('./lamarr'),
	fs     = require('fs'),
	repeat = require('repeat'),
    format = require('util').format,
	argv   = require('optimist')
		.usage('Headcrab - Used to crawl and consume websites\nUsage: $0 -v -q -c [num] url')
		.demand(['c', 1])
		.describe('c', 'The number of workers to use')
		.describe('v', 'Make this really verbose')
		.describe('q', 'Make this super quiet')
		.boolean(['v', 'q'])
		.default('c', 5)
		.argv;

function output(text, lvl)
{
	lvl = lvl || 'general';

	if( lvl != 'error' )
	{
		if( argv.q || (!argv.v && lvl != 'general') )
		{
			return;
		}
	}
	// Maybe replace this whole bit with Date().toJSON();...
	d = new Date();
	dts = format("%s.%s.%s %s:%s:%s", d.getFullYear(), ("0" + (d.getMonth()+1)).slice(-2), ("0" + d.getDate()).slice(-2), 
		("0" + d.getHours()).slice(-2), ("0" + d.getMinutes()).slice(-2), ("0" + d.getSeconds()).slice(-2));
	console.log(format('%s (%s): %s', dts, lvl, text));
}

function process(channel, worker)
{
	output(format("%s Processing new %s", worker), 'debug');
	client.LPOP(config.namespace + ':queue', function(err, url)
	{
		if( err || !url )
		{
			output(format("%s.%s: Got error or no results (%s): '%s'", channel, worker, err, url), 'debug');
			output(format("%s: Returning %s back to the queue", channel, worker), 'debug');
			client.publish(channel, worker);

			return;
		}
		output(format("%s.%s: Got the following URL: '%s'", channel, worker, url), 'debug');

		lamarr.procreate(url, function(err, moar_urls, browser)
		{
			// Lamarr returns a list of URLS (or nil)
			for(var key in moar_urls)
			{
				
			}
		});
	});
}

/**
 * Load the configuration
 */
var data = fs.readFileSync('./config.json'), config;
try
{
	output('Loading configuration values...', 'debug');
	config = JSON.parse(data);
	output('Configuration loaded!');
}
catch(err)
{
	output('Failed to load configuration', 'error');
	output(err, 'error');
	process.exit(1);
}

/**
 * Start the program.
 */
output('Creating Redis connections...', 'debug');
client = redis.createClient(config.redis.port, config.redis.host);
messenger = redis.createClient(config.redis.port, config.redis.host);

client.stream.on('connect', function()
{
	// Lets kick off this shindig! Clear old queues, create new "workers"
	client.SET(config.namespace + ':total', 5);
	output('Redis connected!', 'debug');
	output('Ready and processing!');
	repeat(function()
	{
		client.GET(config.namespace + ':total', function(err, total)
		{
			output(format("UPDATE: %s items processed so far.", total));
		});
	}).every(10, 's')
	.start.in(5, 's');
});
