// LOOK AT ALL THE THINGS I REQUIRE.
var redis  = require('redis'),
	lamarr = require('./lamarr'),
	fs     = require('fs'),
	os     = require('os'),
	repeat = require('repeat'),
	format = require('util').format,
	async  = require('async'),
	logule = require('logule'),
	wg     = require('word-generator'),
	earl   = require('url'),
	argv   = require('optimist')
		.usage('Headcrab - Used to crawl and consume websites\nUsage: $0 -v -w -q -c [num] -s [num] url')
		.demand(['c', 1])
		.describe('c', 'The number of workers to use')
		.describe('v', 'Make this really verbose')
		.describe('q', 'Make this super quiet')
		.describe('w', 'Super verbose mode (-vv)')
		.describe('s', 'Seconds to sleep between queries')
		.boolean(['v', 'q'])
		.default('c', 5)
		.default('s', 0)
		.argv;

process.on('SIGTERM', function()
{
	cleanup();
	process.exit(1);
});
process.on('SIGINT', function()
{
	cleanup();
	process.exit(0);
});

function cleanup()
{
	console.log('');
	logule.trace('Closing connections to redis...');
	client.quit();
	messenger.quit();
	logule.info('Goodbye');
}	

/**
 * Show Processing Status
 *
 */
function status()
{
	client.GET(config.namespace + ':total', function(err, total)
	{
		logule.info(format("UPDATE: %s urls processed so far.", total));
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
	log[channel] = logule.sub(channel);
	client.LPOP(config.namespace + ':queue', function(err, url)
	{
		log[worker] = log[channel].sub(worker);
		if( err || !url )
		{
			if( argv.w )
			{
				log[worker].debug(format("Got error or no results (%s): '%s'", err, url));
				log[channel].debug(format("Returning %s back to the queue", worker));
			}
			client.publish(channel, worker);
			return;
		}

		log[channel].debug(format("Processing new available worker: %s", worker));
		log[worker].debug(format("Got the following URL: '%s'", url));

		lamarr.procreate(url, function(err, moar_urls, code, browser)
		{
			if( err || !moar_urls )
			{
				// Just push the worker back in the Queue, walk away.
				log[worker].debug(format("Either Err (%s) or no URLs found (%s) at %s", err, moar_urls.length, url));
				log[channel].debug(format("Returning %s back to the queue", worker));
				client.publish(channel, worker);
				return;
			}

			log[worker].debug(format("Found %s URLs on %s (code: %s)", moar_urls.length, url, code));

			// Lamarr returns a list of URLS (or nil)
			for(var key in moar_urls)
			{
				raw_url = moar_urls[key];
				clean_url = format_url(raw_url, browser.location.protocol+'//'+browser.location.host);

				if( argv.d )
				{
				}
				

				if( clean_url )
				{
					if( argv.w )
					{
						log[worker].debug(format("Adding the following url: %s from (%s)", clean_url, raw_url));
					}

					client.RPUSH(config.namespace + ':queue', clean_url);
				}
			}

			client.INCRBY(config.namespace + ':total', moar_urls.length);

			if( argv.s > 0 )
			{
				setTimeout(function()
				{
					log[channel].debug(format("Returning %s back to the queue", worker));
					client.publish(channel, worker);
				}, argv.s * 1000);
			}
			else
			{
				log[channel].debug(format("Returning %s back to the queue", worker));
				client.publish(channel, worker);
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
function format_url(url, domain, protocol)
{
	protocol = protocol || 'http';

	if( !domain )
	{
		return url;
	}

	// TODO: Check the URLs formatting!
	if( url.charAt(0) == '/' && url.charAt(1) == '/' )
	{
		ret_url = format("%s%s", protocol, url);
	}
	else if( url.charAt(0) == '/' || url.indexOf('http://') == -1 || url.indexOf('https://') == -1 )
	{
		// Build the URL!
		format_pattern = ( url.charAt(-1) == '/' ) ? "%s%s" : "%s/%s";
		ret_url = format(format_pattern, domain, url);
	}
	else
	{
		ret_url = url;
	}

	return ret_url;
}

/**
 * Load the configuration
 */
var data = fs.readFileSync('./config.json'), config;
try
{
	logule.trace('Loading configuration values...');
	config = JSON.parse(data);
	logule.info('Configuration loaded!');
}
catch(err)
{
	logule.error('Failed to load configuration');
	logule.line(err);
	process.exit(1);
}

var log = {};

/**
 * Start the program.
 */
logule.suppress('debug', 'line', 'trace');

if( argv.v )
{
	logule.allow('debug', 'line', 'trace');
}

if( argv.q )
{
	logule.suppress('debug', 'warn', 'trace', 'line');
}

logule.trace('Creating Redis connections...');
client = redis.createClient(config.redis.port, config.redis.host);
messenger = redis.createClient(config.redis.port, config.redis.host);

client.stream.on('connect', function()
{
	// Lets kick off this shindig! Clear old queues, create new "workers"
	// REMOVE ME SOON
	client.SET(config.namespace + ':total', 0);
	logule.debug('Redis connected!');
	logule.info('Ready and processing!');
	// Get some status goodness rolling
	repeat(status).every(5, 's').start.in(1, 's');

	// We need to seed the message queue.
	process.nextTick(function()
	{
		async.forEach(argv._, function(url, cb)
		{
			furl = format_url(url);
			logule.trace(format('Adding %s (%s) to queue', url, furl));
			client.RPUSH(config.namespace + ':queue', furl, cb);
		},
		function(err)
		{
			if( err )
			{
				logule.error(format('Could not load URLs: %s', err));
			}
			else
			{
				logule.debug('URLs are loaded!');
			}
		});
	});

	messenger.subscribe(config.namespace+':'+os.hostname()+':workers', function()
	{
		logule.debug('Subscribed to '+config.namespace+':'+os.hostname()+':workers');
		messenger.on('message', work);

		logule.trace(format('Creating %s workers...', argv.c));
		words = new wg.WordsGenerator(8);
		workers = words.generateWordsToObject(argv.c);

		// ASYNC THIS?
		for(var worker in workers)
		{
			logule.sub(config.namespace+':'+os.hostname()+':workers').debug(format("Adding %s to the queue", worker));
			client.publish(config.namespace+':'+os.hostname()+':workers', worker);
		}
	});
});
