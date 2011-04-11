var net = require('net');
var repl = require('repl');
var events = require('events');
var util = require('golem/util');
var $ = require('util');

this.Server = function (port) {
    events.EventEmitter.call(this);
    this.net = null;
    this.port = port;
};
this.Server.prototype.__proto__ = events.EventEmitter.prototype;

this.Server.prototype.register = function (master) {
    var that = this;

    this.net = net.createServer(function (socket) {
        socket.write('connected to golem-master[' + process.pid + ']\n');

        var context = repl.start('golem> ', socket).context;

        that.emit('connection', socket);

        Object.keys(exports.commands).forEach(function (c) {
            context[c] = function () {
                return exports.commands[c](socket, master);
            }
        });
        context.master   = context.server = master;
        context.settings = master.settings;
    });
    master.on('master', function (master) {
        that.net.listen(that.port, function () {
            master.logger.info('repl server started on ' + that.port);
        });
    });
    return this;
};

this.commands = {
    help: function (socket) {
        socket.write("commands are...\n");
    },
    status: function (socket, master) {
        var status = master.status();
        socket.write(exports.inspect(master.status()) + '\n');
    },
    quit: function (socket) {
        socket.write('bye!\n');
        socket.destroy();
    }
};

this.inspect = function (json, i) {
    i = i || 0;

    var indent = new(Array)(i * 2 + 1).join(' ');
    var buffer = '';

    Object.keys(json).forEach(function (k) {
        buffer += indent + '\x1b[1m' + k + '\x1b[21m' + ':';

        if (typeof(json[k]) === 'object') {
            buffer += '\n' + exports.inspect(json[k], ++ i); i --;
        } else if (typeof(json[k]) === 'date') {
            buffer += ' ' + json[k].toUTCString();
        } else {
            buffer += ' ' + json[k] + '\n';
        }
    });
    return buffer;
}
