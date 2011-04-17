var http = require('http'),
    https = require('https'),
    path = require('path'),
    vm = require('vm'),
    os = require('os'),
    Module = require('module').Module,
    fs = require('fs');

var repl = require('golem/repl');
var l = require('golem/logger');
var Logger = require('golem/logger').Logger;
var golem = require('golem');

// Default logger, until configuration is read.
var logger = this.logger = new(Logger)(l.LOG_INFO);

var LOG_METHODS = ['debug', 'info', 'notice', 'error', 'warn', 'crit'];

this.DEFAULTS = {
    workers:   os.cpus().length,
    port:      8080,
    config:    null,
    host:      null,
    env:       'development',
    pid:       '/var/run/golem.pid',
    log:       '/var/log/golem.log',
    app:       'index.js',
    timeout:   10000,
    preload:   false,
    debug:     false,
    daemonize: false,
    raw:       false,
    repl:      5001,
    user:      '',
    group:     '',
    logger:    null
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
        this._commitListeners(server);
        this._commitLogger(server);
        this._commitPid(server);

        server.settings  = this.settings;
        server.app       = this.app;
        server.workers   = this.settings.workers;

        if (this.settings.repl) {
            server.repl = new(repl.Server)(this.settings.repl).register(server);
        }
    },
    _commitListeners: function (server) {
        // Bind event listeners
        for (var e in this.listeners) {
            for (var i = 0, c; i < this.listeners[e].length; i ++) {
                c = this.listeners[e][i];

                if (l.once) {
                    delete(c.once);
                    server.once(e, c);
                } else {
                    server.on(e, c);
                }
            }
        }
        server.beforeListen = this.beforeListen;
    },
    _commitPid: function (server) {
        var pid = path.resolve(this.settings.pid);

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
    },
    _commitLogger: function (server) {
        var that = this;
        var log = path.resolve(this.settings.log);

        if (this.settings.logger && LOG_METHODS.every(function (m) {
            if (typeof(that.settings.logger[m]) !== 'function') {
                logger.error("logger object doesn't have a '" + m + "' method - falling back to default logger.");
                return false;
            } else {
                return true;
            }
        })) { server.logger = this.settings.logger }
        else {
            if (!path.isWritable(path.dirname(log))) {
                if (!this.settings.daemonize && path.isWritable(process.cwd())) {
                    this.settings.log = path.join(process.cwd(), 'golem.log');
                    logger.warn("couldn't open `" + log + "', sending log output to `" + this.settings.log + "' instead.");
                } else {
                    // Error
                }
            }
            server.logger = new(Logger)(this.settings.debug ? l.LOG_DEBUG : l.LOG_INFO,
                                        this.settings.env === 'production' ? this.settings.log : null);
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
        filename = path.resolve(filename);

        if (refresh) {
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

        var ctx = Object.create(that.params);

        ctx.env = ctx.env || this.settings.env;

        var app = require(filename).call(ctx, context, function (app) {
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

