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
		.usage('Headcrab - Used to crawl and consume websites\nUsage: $0 -v -w -q -c [num] -s [num] -d [domain] url')
		.demand(['c', 1])
		.describe('c', 'The number of workers to use')
		.describe('d', 'The root domain used during lookups')
		.describe('s', 'Seconds to sleep between queries')
		.describe('q', 'Make this super quiet')
		.describe('v', 'Make this really verbose')
		.describe('w', 'Super verbose mode (-vv)')
		.describe('x', 'Continue previoius session')
		.boolean(['v', 'q', 'w', 'x'])
		.string('d')
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
	client.LLEN(config.namespace + ':queue', function(err, total)
	{
		client.GET(config.namespace + ':total', function(err, done)
		{
			client.GET(config.namespace + ':alltime', function(err, alltime)
			{
				// UGH, this sucks now. DAMN YOU NON-BLOCKING LANGUAGES
				client.HLEN(config.namespace + ':done:404', function(err, total_404)
				{
					client.HLEN(config.namespace + ':done:500', function(err, total_500)
					{
						process.nextTick(function()
						{
							logule.info(format("STATUS (%s%%): %s urls (of %s) processed so far. Status codes, 500: %s, 404: %s", (done/alltime*100).toFixed(2), done, total, total_500, total_404));
						});
					});
				});
			});
		});
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
				//log[worker].debug(format("Got error or no results (%s): '%s'", err, url));
				//log[channel].debug(format("Returning %s back to the queue", worker));
			}
			client.publish(channel, worker);
			return;
		}

		log[channel].debug(format("Processing new available worker: %s", worker));
		log[worker].debug(format("Got the following URL: '%s'", url));

		process_url(channel, worker, url, function(err, url, channel, worker)
		{
			if( err )
			{
				if( argv.w )
				{
					log[worker].debug(err);
				}
				
				client.INCR(config.namespace + ':total');

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
				
				return;
			}
						

			lamarr.procreate(url, function(err, moar_urls, code, browser)
			{
				if( !err )
				{
					// If there is no "real" error, then just drop the URL in to a bucket
					client.HINCRBY(config.namespace + ':done:' + code, url, 1);
				}

				if( err || !moar_urls )
				{
					// Just push the worker back in the Queue, walk away.
					log[worker].debug(format("Either Err (%s) or no URLs found (%s) at %s", err, moar_urls.length, url));
					log[channel].debug(format("Returning %s back to the queue", worker));
					client.publish(channel, worker);
					return;
				}

				client.HINCRBY(config.namespace + ':done:' + code, url, 1);

				log[worker].debug(format("Found %s URLs on %s (code: %s)", moar_urls.length, url, code));
				// Lamarr returns a list of URLS (or nil)
				async.forEach(moar_urls, function(raw_url, cb)
				{
					clean_url = format_url(raw_url, browser.location.protocol+'//'+browser.location.host);

					process_url(channel, worker, clean_url, function(err, final_url, channel, worker)
					{
						if( err )
						{
							if( argv.w )
							{
								log[worker].debug(err);
							}

							cb();
							return;
						}

						client.INCR(config.namespace + ':alltime');
						client.RPUSH(config.namespace + ':queue', final_url);
						cb();
					});
				},
				function(err)
				{
					client.INCR(config.namespace + ':total');

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
		});
	});
}

function process_url(channel, worker, url, cb)
{
	if( argv.d )
	{
		url_parts = earl.parse(url);
		if( url_parts.hostname.indexOf(argv.d) == -1 )
		{
			process.nextTick(function()
			{
				cb(format("URL %s is not in %s network", url, argv.d), null, channel, worker);
			});
			return;
		}
	}

	//log[worker].info("IS IT CLEAN ENOUGH!? "+url);
	client.HEXISTS(config.namespace + ':done:200', url, function(err, exists, foo)
	{
		process.nextTick(function()
		{
			if( exists > 0 || err )
			{
				cb(format("URL (%s) already exists.", url), url, channel, worker);
				return;
			}

			cb(null, url, channel, worker);
		});
	});
}

/**
 * Formatn URL
 * 
 * @param url
 * @param domain - OPTIONAL
 * @param protocol - OPTIONAL
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
	else if( url.charAt(0) == '/' || (url.indexOf('http://') == -1 && url.indexOf('https://') == -1) )
	{
		// Build the URL!
		format_pattern = ( url.charAt(0) == '/' ) ? "%s%s" : "%s/%s";
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
	// Lets kick off this shindig!
	logule.debug('Redis connected!');
	logule.info('Ready and processing!');
	// Get some status goodness rolling
	repeat(status).every(5, 's').start.in(1, 's');

	if( !argv.x )
	{
		logule.debug('Cleaning old queue data');
		client.SET(config.namespace + ':total', 0);
		client.DEL(config.namespace + ':queue');
		client.KEYS(config.namespace + ':done:*', function(err, keys)
		{
			keys.forEach(function(key, i)
			{
				client.DEL(key);
			});
		});

		// We need to seed the message queue.
		process.nextTick(function()
		{
			async.forEach(argv._, function(url, cb)
			{
				logule.trace(format('Adding %s (%s) to queue', url, url));
				client.RPUSH(config.namespace + ':queue', url, cb);
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
	}

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
