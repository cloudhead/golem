var tty = require('tty');

process.stderr.fd = process.stderr.fd || 2;

this.Logger = function (outStream, errStream, debugStream) {
    errStream = errStream || outStream;

    this.streams = {
        debug:  debugStream,
        info:   outStream,
        notice: outStream,
        warn:   errStream,
        error:  errStream,
        crit:   errStream
    };
};

this.Logger.prototype = {
    log: function (msg, lvl, args) {
        var stream = this.streams[lvl];

        if (! stream) { return }

        var header = (tty.isatty(stream.fd) ? ' \x1b[0;1m' + process.title + '\x1b[0m' : process.title) +
                     '[' + process.pid + ']';

        var level = this.level(lvl);

        msg = msg.replace(/%[sdj]/g, function (x) {
            var val = args.shift();

            if (val) {
                switch (x) {
                    case '%s': return String(val);
                    case '%d': return Number(val);
                    case '%j': return JSON.stringify(val);
                    default:   return x;
                }
            } else {
                return x;
            }
        });
        return stream.write(header + ' ' + level + ' ' + msg + '\n');
    },
    debug:  function (msg) { this.log(msg, 'debug',  Array.prototype.slice.call(arguments, 1)) },
    info:   function (msg) { this.log(msg, 'info',   Array.prototype.slice.call(arguments, 1)) },
    notice: function (msg) { this.log(msg, 'notice', Array.prototype.slice.call(arguments, 1)) },
    warn:   function (msg) { this.log(msg, 'warn',   Array.prototype.slice.call(arguments, 1)) },
    error:  function (msg) { this.log(msg, 'error',  Array.prototype.slice.call(arguments, 1)) },
    crit:   function (msg) { this.log(msg, 'crit',   Array.prototype.slice.call(arguments, 1)) },

    level: function (lvl) {
        var level = '\x1b[1m ' + lvl + ' \x1b[21m';
        if (tty.isatty(this.streams[lvl].fd)) {
            switch (lvl) {
                default:
                case 'debug':
                    return '\x1b[30m' + level + '\x1b[39m';
                case 'info':
                    return '\x1b[37m' + level + '\x1b[39m';
                case 'notice':
                    return '\x1b[36m' + level + '\x1b[39m';
                case 'warn':
                    return '\x1b[33m' + level + '\x1b[39m';
                case 'error':
                case 'crit':
                    return '\x1b[31m' + level + '\x1b[39m';
            }
        } else {
            return '[' + lvl + ']';
        }
    }
};

