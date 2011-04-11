
var path = require('path');

var netb = process.binding('net');
var events = require('events');
var $ = require('util');
var net = require('net');
var fs = require('fs');
var os = require('os');
var http = require('http');
var inspect = require('util').inspect;
var spawn = require('child_process').spawn;
var tty = require('tty');

var repl   = require('golem/repl');
var posix  = require('golem/posix');
var util   = require('golem/util');
var Worker = require('golem/worker').Worker;

this.Configurator = require('golem/configurator').Configurator;
this.logger = require('golem/configurator').logger;

var CTRL_R = '\u0012',
    CTRL_C = '\u0003',
    CTRL_J = '\n',
    CTRL_K = '\u000b',
    CTRL_Q = '\u0011';

var golem = exports;

this.workers = {};

this.startctx = {
    argv: process.argv.slice(1),
    cwd: process.cwd()
};

this.Server = function (config, p) {
    this.config = new(golem.Configurator)(config);

                            // These will be set when we call this.config.commit
    this.app = null;        // Application Server instance
    this.workers = null;    // Target worker count
    this.pid = null;        // Path to process PID file
    this.fd = -1;           // File descriptor we're listening on
    this.readyPipe = p;     // Used to signal the grandparent process that we're ready
    this.settings = {};

    this.reexecPid = 0;

    events.EventEmitter.call(this);
};
$.inherits(this.Server, events.EventEmitter);

this.Server.prototype.status = function () {
    var that = this;

    return {
        pid: process.pid,
        uid: process.getuid(),
        gid: process.getgid(),
        started: that.started,
        uptime: util.duration(new(Date) - that.started),
        workers: Object.keys(golem.workers).map(function (w) {
            return golem.workers[w].toJSON();
        }),
        memory: util.memoryUsage()
    };
};

this.Server.prototype.abort = function (message) {
    this.logger.crit(message);
    process.exit(1);
};

//
// Attempt to create a pid/lock file
//
this.Server.prototype.lock = function (file) {
    var pid;

    if (file) {
        if (this.isLocked(file)) {
            pid = parseInt(fs.readFileSync(file, 'ascii'));

            if (this.pid && (file === this.pid) && (pid === process.pid)) {
                return true;
            }
            if (pid === this.reexecPid && /\.oldbin$/.test(this.pid)) {
                return this.logger.warn("can't lock while reexec-ed");
            }
            this.abort('a golem master process is already running');
        }
    }

    if (this.pid) { this.unlock() }

    try {
        var tmp = path.join(path.dirname(file), Date.now() + '.' + process.pid);
        var fd = fs.openSync(tmp, posix.O_RDWR | posix.O_CREAT | posix.O_EXCL, 0644);

        fs.writeSync(fd, process.pid.toString() + '\n', 0, 'ascii');
        fs.renameSync(tmp, file);
        fs.closeSync(fd);

        this.pid = file;
    } catch (e) {
        this.logger.crit(e.stack);
        process.exit(1);
    }
};

this.Server.prototype.unlock = function (path) {
    path = path || this.pid;

    if (this.isLocked(path)) {
        try {
            var pid = parseInt(fs.readFileSync(path, 'ascii'));
            if (pid === process.pid) {
                fs.unlinkSync(path);
            }
        } catch (e) {
            this.logger.error(e.message);
        }
    }
};

this.Server.prototype.isLocked = function (pid) {
    if (!pid && !this.pid) { return false }

    try {
        fs.statSync(pid || this.pid);
    } catch (e) {
        if (e.code === 'ENOENT') { return false }
        else                     { throw e }
    }
    return true;
};

this.Server.prototype.reload = function (callback, refresh) {
    var that = this;

    this.config.reload(this, refresh, function (config) {
        // Copy configuration to server instance
        config.commit(that);

        if (that.pid) {
            that.lock(that.pid);
        }
        that.logger.info('configuration loaded from ' + that.config.appPath);

        // TODO: Check that stdout & stderr are writeable
        callback(null);
    });
};

this.Server.prototype.init = function () {
    var that = this;

    this.logger.info('listening on ' + this.settings.host + ':' + this.settings.port);

    // Immediate shutdown
    this.trap('SIGINT',  function () { this.exit(0) });
    this.trap('SIGTERM', function () { this.exit(0) });

    // Gracefuly shutdown all workers,
    // then exit Master.
    this.trap('SIGQUIT', function () {
        this.close(function () { process.exit(0) });
    });

    // Re-execute binary
    this.trap('SIGUSR2', function () { this.reexec() });

    // Gracefuly shutdown all workers, but
    // keep Master alive.
    this.trap('SIGWINCH', function () {
        // Are we daemonized?
        // Ignore if not, as this signal is sent to attached
        // processes when the terminal is resized.
        if (process.getppid() === 1) {
            this.killEachWorker(posix.SIGQUIT, true);
        } else {
            this.logger.debug("SIGWINCH ignored");
        }
    });
    //
    // Reload configuration
    //
    this.trap('SIGHUP', function () {
        that.reload(function () {
            that.killEachWorker(posix.SIGQUIT);
        }, true);
    });
    this.trap('SIGTTIN', function () { this.incrementWorkers() });
    this.trap('SIGTTOU', function () { this.decrementWorkers() });

    process.removeAllListeners('uncaughtException');

    process.on('uncaughtException', function (e)     { that.onUncaughtException(e) });
    process.on('exit',              function (code)  { that.onExit(code) });

    this.logger.info('process ready');

    // Signal our parent process that we are ready.
    this.readyPipe && this.readyPipe.write(process.pid.toString());

    if (!this.daemonized && !this.settings.raw) {
        tty.setRawMode(true);
        process.stdin.on('keypress', function (raw) {
            that.handleKeyboard(raw);
        }).resume();
    }

    // Spawn the initial workers
    return this.maintainWorkerCount(function () {
        // - Master -
        this.isMaster = true;
        this.emit('master', this);
        this.started = new(Date);

        return this;
    });
};
this.Server.prototype.listen = function (port, host) {
    var that = this;
    if (this.listening)  { return }
    if (! this.app)      { return this.reload(function () { that._listen(port, host) }) }
    else                 { return this._listen(port, host) }
};
this.Server.prototype._listen = function (port, host) {
    var that = this;

    this.listening = true;

    if (process.getppid() === parseInt(process.env.GOLEM_MASTER_PID)) {
        new(net.Socket)({ fd: 0, type: 'unix' }).on('fd', function (fd) {
            that.logger.debug('new master received fd')
            that.fd = fd;
            that.init();
        }).resume();
    } else {
        // Create an unbound TCP socket, bind it to a port and host,
        // then listen on it. The file descriptor will be shared
        // amongst workers.
        try {
            this.fd = netb.socket('tcp');
            netb.bind(this.fd, port || this.settings.port, host || this.settings.host);
        } catch (e) {
            this.logger.crit('failed to bind to port: ' + e.message);
            this.onExit(1);
            process.exit(1);
        }
        netb.listen(this.fd, 128);
        this.init();
    }
};

this.Server.prototype.handleKeyboard = function (code) {
    switch (code) {
        case CTRL_R:   return process.kill(process.pid, 'SIGHUP');  // ^R
        case CTRL_C:   return process.kill(process.pid, 'SIGINT');  // ^C
        case CTRL_J:   return process.kill(process.pid, 'SIGTTOU'); // ^J
        case CTRL_K:   return process.kill(process.pid, 'SIGTTIN'); // ^K
        case CTRL_Q: 
        case '\u001c': return process.kill(process.pid, 'SIGQUIT'); // ^Q
        case '\r':     return process.stdout.write('\n');           // Return
        case '\u007f': return process.stdout.write('\x1b[1D');      // Backspace
        default:       return process.stdout.write(code);
    }
}

this.Server.prototype.onUncaughtException = function (error) {
    this.logger.crit(error.stack);
    this.exit(1);
};

this.Server.prototype.onExit = function (code) {
    if (this.isLocked()) { this.unlock(this.pid) }
    this.logger.notice('master process exiting with code ' + code);
    process.stdout.flush();
};

this.Server.prototype.close = function (callback) {
    var fd = this.fd;
    this.killEachWorker(posix.SIGQUIT, true);
    this.on('workerExit', function () {
        if (Object.keys(golem.workers).length === 0) {
            netb.close(fd);
            callback(null);
        }
    });
};

this.Server.prototype.exit = function (code) {
    this.killEachWorker(posix.SIGTERM, true);
    process.exit(code);
};

this.Server.prototype.trap = function (signal, callback) {
    var that = this;
    process.on(signal, function () {
        that.logger.notice('process received ' + signal);
        that.emit(signal);
        callback.call(that);
    });
};

// Reload the binary
this.Server.prototype.reexec = function () {
    var that = this;
    var oldpid, cmd;

    if (this.reexecPid > 0) {
        try {
            process.kill(this.reexecPid, 0);
            return this.logger.error('reexec-ed child already running');
        } catch (e) {
            if (e.code === 'ESRCH') {
                this.reexecPid = 0;
            } else { throw e }
        }
    }

    if (this.pid) {
        // TODO: Perform error checking
        oldpid = this.pid + '.oldbin';
        this.lock(oldpid);
    }

    process.env.GOLEM_MASTER_PID = process.pid;
    process.env.GOLEM_FD = this.fd;

    var fildes = netb.socketpair(),
        cmd = golem.startctx.argv;

    this.logger.info('executing "%s" in %s', cmd.join(' '), golem.startctx.cwd);

    var child = spawn('node', cmd, {
        customFds: [fildes[0], 1, 2],
        env: util.clone(process.env),
        cwd: golem.startctx.cwd
    });

    child.stdin = new(net.Socket)({ fd: fildes[0], type: 'unix' });

    process.nextTick(function () {
        new(net.Socket)({ fd: fildes[1], type: 'unix' }).write('fd', 'ascii', that.fd);
    });
    this.reexecPid = child.pid;

    process.title = 'golem-master.old'
};

this.Server.prototype.spawnMissingWorkers = function (c) {
    var fildes, worker, child;

    for (var i = 0, child; i < this.workers; i ++) {
        if (function () { // Skip workers which area already spawned
            for (var k in golem.workers) {
                if (golem.workers[k].number === i) { return true }
            }
        }()) { continue }

        // Create a unidirectional unix pipe.
        // Returns a pair of file descriptors:
        // fildes[0] is for reading, fildes[1] is for writing.
        fildes = netb.pipe();

        this.emit('prefork', this);

        // Fork the Master process
        child = posix.fork(!this.settings.keep);

        // Create a new worker interface. It is essentially
        // a Socket connecting the master and the worker.
        worker = new(Worker)(child, fildes[0], i);

        if (child) {
            // - Master -
            // Close the write-end of the pipe in the Master process,
            // and create a Socket stream to read from it.
            netb.close(fildes[1]);
            this.master(worker);
        } else {
            // - Worker -
            // Close the reading-end of the pipe,
            // act as a worker, and return, so we don't execute
            // the rest of the loop.
            netb.close(fildes[0]);
            return this.worker(worker, fildes[1]);
        }
    }
    c && c.call(this);
};

this.Server.prototype.maintainWorkerCount = function (c) {
    var that = this;
    var pids = Object.keys(golem.workers);
    var offset = this.workers - pids.length;

    if (offset > 0) {
        this.spawnMissingWorkers(c);
    } else if (offset < 0) {
        pids.forEach(function (pid) {
            if (golem.workers[pid].number >= that.workers) {
                that.killWorker(pid, posix.SIGQUIT);
            }
        });
        c && c.call(this);
    } else {
        // Nothing to do
    }
};

this.Server.prototype.incrementWorkers = function () {
    this.workers ++;
    this.maintainWorkerCount();
};
this.Server.prototype.decrementWorkers = function () {
    if (this.workers > 0) {
        this.workers --
        this.maintainWorkerCount();
    }
};

//
// Initialize worker listeners in master process.
//
// This method is called by the master, whenever a new
// worker is spawned. It takes an instance of Worker,
// assigns it to `golem.workers` and sets up a bunch
// of listeners. Note that Worker instances inherit
// from Socket.
//
this.Server.prototype.master = function (worker) {
    var that = this;

    this.logger.info('initializing ' + worker.toString());

    golem.workers[worker.pid] = worker;

    worker.setTimeout(3000);

    worker.resume();
    worker.process.on('exit', function (code, signal) {
        delete(golem.workers[worker.pid]);
        if (worker.isready) {
            that.emit('workerExit', worker, code, signal);
            that.maintainWorkerCount();
        } else {
            that.logger.crit('worker exited with code ' + code + ' before establishing a connection (' + signal + ')');
            that.exit(1);
        }
    });
    worker.on('data', function (data) {
        data = data.toString('ascii').split(' ');

        var event = data[0], msg = data[1];

        // Let our worker object know about this message.
        worker.register(event, msg);

        that.logger.debug('received "%s" from %s', data.join(' '), worker.toString());

        switch (event) {
            case 'ready': return that.emit('worker', worker);
            case 'ok':    return;
            case 'error':
            default:
        }
    }).on('timeout', function () {
        that.logger.notice('received timeout from %s. sending SIGTERM.', worker.toString());
        worker.kill(posix.SIGTERM);
    });
};

this.Server.prototype.killWorker = function (pid, signal, maintain) {
    if (golem.workers[pid].kill(signal)) {
        // Success
        // If `maintain` is true, we make sure a new worker isn't respawned
        // after this one dies.
        maintain && this.workers --;
    } else {
        // Failure
        delete(golem.workers[pid]);
    }
};
this.Server.prototype.killEachWorker = function (signal, maintain) {
    for (var pid in golem.workers) {
        this.killWorker(pid, signal, maintain);
    }
};

// Initialize the worker process
//
// This is run for each worker, in the worker process itself,
// right after it's forked.
//
// We create a stream for writing to the Master process,
// assign the new worker's pid to `process.pid` and
// start listening on the shared file descriptor.
//
// We also make sure no event listeners remain from the
// parent process. This is probably only necessary when `--keep`
// is used, (ie: when we use the parent's event loop) but it's
// good measure anyway.
//
this.Server.prototype.worker = function (worker, fd) {
    var that = this;

    this.connections = 0;
    this.isMaster    = false;

    process.title = 'golem-worker/' + worker.number;

    // Drop all signal and process watchers
    posix.SIGNALS.forEach(function (sig) {
        if (process.listeners(sig).length > 0) {
            process.removeAllListeners(sig);
        }
    });
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('exit');

    process.on('uncaughtException', function (error) {
        that.logger.crit(error.stack);
        process.exit(-1);
    });

    Object.keys(golem.workers).forEach(function (pid) {
        // This is a bit of a hack: If the parent process's
        // watchers were kept by ev (keep = true), we can safely destroy
        // these streams - but if we're in a new event-loop (keep = false),
        // all we can do is `close(fd)`, or it'll SIGSEGV when workers >= 4.
        // This is probably because `Socket#destroy` tries to
        // free the event watchers even though they are not copied
        // over. Why it only happens when there are 4 or more workers is a mystery.
        // Anyhow, this is better than not doing anything.
        if (that.settings.keep) {
            golem.workers[pid].destroy();
        } else if (golem.workers[pid].fd) {
            netb.close(golem.workers[pid].fd);
        }
    }) ; delete(golem.workers);

    this.trap('SIGQUIT', function () { that.workerQuit() });
    this.trap('SIGTERM', function () { process.exit(0) });

    // Set *uid* and *gid* of current process.
    try {
        worker.chown(this.settings.user, this.settings.group);
    } catch (err) {
        this.logger.error("couldn't set uid or gid of process: " + err.message);
    }

    // Destroy unused streams. We destroy `stdin` because
    // we want to deal with it solely in the master process.
    // If we keep it open here, the kernel might decide to send
    // data here, if it feels like it.
    process.stdin.destroy();
    this.readyPipe && this.readyPipe.destroy();
    this.repl      && this.repl.fd && this.repl.close();

    this.emit('postfork', this);

    // worker -> master lifeline. This is used by the worker
    // to communicate to the master.
    this.pipe = new(net.Socket)({ fd: fd });
    this.pipe.setNoDelay(true);
    this.app.on('listening', function () {
        // Signal master we are ready to accept connections
        that.pipe.write('ready');
    });
    this.app.on('connection', function (connection) {
        that.connections ++;

        if (that.settings.debug) {
            that.pipe.write('connection ' + connection.remoteAddress);
        }

        connection.on('close', function () {
            that.connections --;
            if (that.connections == 0) {
                that.pipe.write('idle');
                that.emit('idle');
            }
        })
    });

    if (this.beforeListen) {
        this.beforeListen(function () {
            that.app.listenFD(that.fd);
        });
    } else {
        this.app.listenFD(this.fd);
    }

    // Tell the master we're ok, regularily, in case we get
    // into a bad state. As long as the server has a file descriptor,
    // we can assume it can accept connections.
    setInterval(function () {
        that.app.fd && that.pipe.writable && that.pipe.write('ok ' + that.connections);
    }, 1500);
};

this.Server.prototype.workerQuit = function () {
    var that = this;

    if (this.app.connections) {
        this.app.close();
        this.on('idle', function () {
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
};


