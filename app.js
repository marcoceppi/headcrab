// LOOK AT ALL THE THINGS I REQUIRE.
var redis  = require('redis'),
	lamarr = require('./lamarr'),
	fs     = require('fs'),
	repeat = require('repeat'),
	format = require('util').format,
	async  = require('async'),
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

/**
 * Show Processing Status
 *
 */
function status()
{
	client.GET(config.namespace + ':total', function(err, total)
	{
		output(format("UPDATE: %s urls processed so far.", total));
	});
}

/**
 * Process a new item
 * This is a simple "web worker"
 *
 * @param channel - Where to return [worker]
 * @param worker - Unique name "web worker"
 */
function work(channel, worker)
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
			if( err || !moar_urls )
			{
				// Just push the worker back in the Queue, walk away.
				output(format("%s.%s: Either Err (%s) or no URLs found (%s) at %s", channel, worker, err, moar_urls.length, url), "debug");
				client.publish(channel, worker);
				return;
			}

			output(format("%s.%s: Found %s URLs on %s", channel, worker, moar_urls.length, url), "debug");
			// Lamarr returns a list of URLS (or nil)
			for(var key in moar_urls)
			{
				
			}
		});
	});
}

/**
 * Queue URL
 * 
 * @param url
 * @param domain - OPTIONAL
 * @param callback(err, final_url)
 */
function format_url(url, domain, cb)
{
	cb = cb || domain;
	// TODO: Check the URLs formatting!
	cb(null, url);
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
	// REMOVE ME SOON
	client.SET(config.namespace + ':total', 0);
	output('Redis connected!', 'debug');
	output('Ready and processing!');
	// Get some status goodness rolling
	repeat(status).every(10, 's').start.in(5, 's');

	// We need to seed the message queue.
	process.nextTick(function()
	{
		async.forEach(argv._, function(url, cb)
		{
			format_url(url, function(err, furl)
			{
				output(format('Adding %s (%s) to queue', url, furl), 'debug');
				client.RPUSH(config.namespace + ':queue', furl, cb);
			});
		},
		function(err)
		{
			// I don't really care?
			output('URLs are loaded! Error? ' + err, 'debug');
		});
	});
});
