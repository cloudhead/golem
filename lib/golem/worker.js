var net = require('net');
var posix = require('golem/posix');

this.Worker = function (process, fd, n) {
    this.isready = false;
    this.number = n;
    this.process = process;
    this.pid = process && process.pid;
    this.connections = 0;
    this.idlesince = null;

    net.Socket.call(this, { fd: fd });
};
this.Worker.prototype.__proto__ = net.Socket.prototype;

this.Worker.prototype.toString = function () {
    return 'worker/' + this.number + '[' + this.pid + ']';
};

this.Worker.prototype.toJSON = function () {
    var that = this;

    return {
        ready: that.isready,
        started: that.started,
        pid: that.pid,
        connections: that.connections,
        idle: that.idletime(),
        number: that.number
    };
};

this.Worker.prototype.idletime = function () {
    if (this.idlesince) {
        return (new(Date) - this.idlesince) / 1000;
    }
};

this.Worker.prototype.register = function (event, msg) {
    if (this[event]) {
        this[event](msg);
    }
};

this.Worker.prototype.ok = function (msg) {
    if (this.connections = parseInt(msg)) {
        this.idlesince = null;
    } else if (! this.idlesince) {
        this.idlesince = new(Date);
    }
};

this.Worker.prototype.ready = function () {
    this.isready = true;
    this.started = new(Date);
};

this.Worker.prototype.chown = function (usr, grp) {
    var user  = usr && posix.getpwnam(usr);
    var group = grp && posix.getpwnam(grp);

    if (usr && !user)  { throw new(Error)("user '" + usr + "' not found.") }
    if (grp && !group) { throw new(Error)("group '" + grp + "' not found.") }

    var uid = user  && user.uid;
    var gid = group && group.gid;

    gid && process.setgid(gid);
    uid && process.setuid(uid);
};

this.Worker.prototype.kill = function (signal) {
    try {
        this.process.kill(signal);
        this.destroy();
    } catch (e) {
        if (e.code === 'ESRCH') {
            this.destroy();
            return false;
        } else {
            throw e;
        }
    }
    return true;
};

this.Worker.prototype.__defineGetter__('uptime', function () {
    return new(Date) - this.started;
});

