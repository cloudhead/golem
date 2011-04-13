var path = require('path');
var events = require('events');
var util = require('util');
var net = require('net');
var netb = process.binding('net');

require.paths.unshift(path.join(__dirname, '..', '..'));

var constants = process.binding('constants');
var binding = this.binding = require('build/default/golem');

var ChildProcess = require('golem/child-process').ChildProcess;

this.SIGNALS = ['SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGHUP', 'SIGTTOU',
                'SIGTTIN', 'SIGCHLD', 'SIGUSR1', 'SIGUSR2', 'SIGWINCH'];

// Copy all the constants, such as SIGINT, SIGTERM etc
// to the exports object, for easier access.
for (var k in constants) { this[k] = constants[k] }

// File permissions, used by access()
this.X_OK = 1 << 0;
this.W_OK = 1 << 1;
this.R_OK = 1 << 2;

// Wrapper around ChildProcess#fork
this.fork = function (drop) {
    return new(ChildProcess)().fork(drop);
};

path.isWritable = function (file) {
    return exports.access(file, exports.W_OK) === 0;
};

// Get Process ID and parent Process ID
process.getpid  = function () { return binding.getpid() };
process.getppid = function () { return binding.getppid() };
process.geteuid = function () { return binding.geteuid() };
process.getegid = function () { return binding.getegid() };

// Get passwd and group entries by user/group name
this.getpwnam = function (name) { return binding.getpwnam(name) };
this.getgrnam = function (name) { return binding.getgrnam(name) };

// Check file access permissions
this.access = function (path, mode) { return binding.access(path, mode) };

// Set Session ID
this.setsid = function () {
    var sid = binding.setsid();
    if (sid < 0) { throw new(Error)("couldn't set sid") }
    return sid;
};

this.pipe = function () {
    var fildes = netb.pipe();
    return [
        new(net.Socket)({ fd: fildes[0] }),
        new(net.Socket)({ fd: fildes[1] })
    ];
};

this.closeStdio = function () {
    return binding.closeStdio();
};

