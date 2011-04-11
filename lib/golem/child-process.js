
var path = require('path');
var events = require('events');
var util = require('util');
var net = require('net');
var netb = process.binding('net');
var posix = require('golem/posix').binding;

this.ChildProcess = function () {
    this.pid = null;
    events.EventEmitter.call(this);
};
util.inherits(this.ChildProcess, events.EventEmitter);

this.ChildProcess.prototype.fork = function (drop) {
    var that = this;

    // Create an instance of the internal (C++)
    // ChildProcess class.
    this.process = new(posix.ChildProcess);

    this.process.onexit = function (code, signal) {
        that.exitCode = code;
        that.exitSignal = signal;

        that.emit('exit', code, signal);
    };

    // Fork a new child process
    if (this.pid = this.process.fork(drop)) {
        return this;
    } else {
        process.pid = posix.getpid();
        return null;
    }
};
this.ChildProcess.prototype.kill = function (signal) {
    if (this.exitCode === undefined) {
        return this.process.kill(signal);
    } else {
        return false;
    }
};

