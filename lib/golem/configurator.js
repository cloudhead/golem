var http = require('http'),
    https = require('https'),
    path = require('path'),
    vm = require('vm'),
    os = require('os'),
    Module = require('module').Module,
    fs = require('fs');

var repl = require('golem/repl');
var Logger  = require('golem/logger').Logger;
var golem = require('golem');

// Default logger, until configuration is read.
var logger = this.logger = new(Logger)(process.stdout, process.stderr, null);

this.DEFAULTS = {
    workers:   os.cpus().length,
    port:      8080,
    config:    null,
    host:      '127.0.0.1',
    env:       'development',
    pid:       '/var/run/golem.pid',
    app:       'index.js',
    preload:   false,
    debug:     false,
    daemonize: false,
    raw:       false,
    keep:      false,
    repl:      5001
};

this.Configurator = function (params) {
    this.app = null;
    this.listeners = {};
    this.modules = [];
    this.compiled = null;
    this.params = params;
    this.settings = {};
};

this.Configurator.prototype = {
    commit: function (server) {
        var pid = path.resolve(this.settings.pid);

        if (this.settings.env === 'production') {
            server.logger = syslog.createClient(514, 'localhost');
        } else {
            server.logger = new(Logger)(process.stdout, process.stderr,
                                        this.settings.debug ? process.stdout : null);
        }

        // Bind event listeners
        for (var e in this.listeners) {
            for (var i = 0, l; i < this.listeners[e].length; i ++) {
                l = this.listeners[e][i];

                if (l.once) {
                    delete(l.once);
                    server.once(e, l);
                } else {
                    server.on(e, l);
                }
            }
        }
        server.beforeListen = this.beforeListen;

        // Check for write access on pid file
        if (pid) {
            // Check that we can write the pid file
            if (path.isWritable(pid) || path.isWritable(path.dirname(pid))) {
                server.pid = pid;
            } else if (!this.settings.daemonize && path.isWritable(process.cwd())) {
                server.pid = path.join(process.cwd(), 'golem.pid');
                server.logger.warn("couldn't write PID file, writing to " + server.pid);
            } else {
                // Error
                server.logger.crit("can't write pid file " + pid);
                process.exit(1);
            }
        }
        server.settings  = this.settings;
        server.app       = this.app;
        server.workers   = this.settings.workers;

        if (this.settings.repl) {
            server.repl = new(repl.Server)(this.settings.repl).register(server);
        }
    },
    load: function (filename, server, refresh, callback) {
        var that = this;

        logger.info('(re)loading configuration from "' + filename + '"');

        var context = {
            on: function (event, callback) {
                that.listeners[event] = that.listeners[event] || [];
                that.listeners[event].push(callback);
            },
            once: function (event, callback) {
                callback.once = true;
                context.on(event, callback);
            },
            beforeListen: function (callback) { that.beforeListen = callback }
        };
        // Define setters for config options
        Object.keys(exports.DEFAULTS).forEach(function (k) {
            Object.defineProperty(context, k, {
                get: function () {
                    return that.settings[k];
                },
                set: function (val) {
                    var type = typeof(exports.DEFAULTS[k]);

                    if (typeof(val) === type) {
                        that.settings[k] = val;
                    } else {
                        logger.warn("'" + k + "' must be a " + type + ". ignoring.");
                    }
                }
            });
        });

        if (refresh) {
            filename = path.resolve(filename);

            delete(require.cache[filename]);

            Object.keys(require.cache).forEach(function (k) {
                var m = require.cache[k];

                while (m.parent) {
                    if (m.parent.id === filename) {
                        delete(require.cache[k]);
                        break;
                    }
                    m = m.parent;
                }
            });
        }

        function onExit() {
            logger.crit('no app was exported from "' + filename + '" -');
            logger.crit('make sure you either return an app,');
            logger.crit('or call the provided callback with an app.');
        }

        // Remove previous event listeners
        for (var e in this.listeners) {
            for (var i = 0; i < this.listeners[e].length; i ++) {
                server.removeListener(e, this.listeners[e][i]);
            }
        }
        this.listeners = {};

        var app = require(filename)(context, function (app) {
            process.nextTick(function () {
                process.removeListener('exit', onExit);
                callback(app);
            });
        });

        if (app) {
            process.removeListener('exit', onExit);
            callback(app);
        } else {
            process.on('exit', onExit);
        }
    },
    reload: function (server, refresh, callback) {
        var that = this, filename = this.params.app || exports.DEFAULTS.app;

        fs.stat(filename, function (e, stat) {
            if (e) {
                if (e.code === 'ENOENT') {
                    logger.crit("couldn't load config file: " + e.message);
                    process.exit(1);
                } else {
                    throw new(Error)(e.message);
                }
            } else if (stat.isDirectory()) {
                filename = path.join(filename, 'index.js');
            }

            for (var k in exports.DEFAULTS) {
                that.settings[k] = exports.DEFAULTS[k];
            }
            that.load(filename, server, refresh, function (app) {
                that.app = app;
                that.appPath = filename;
                for (var k in that.params) {
                    that.settings[k] = that.params[k];
                }
                callback(that);
            });
        });
    }
};

