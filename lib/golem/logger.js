var tty = require('tty');
var fs = require('fs');

this.LOG_EMERG = 0;
this.LOG_ALERT = 1;
this.LOG_CRIT = 2;
this.LOG_ERROR = 3;
this.LOG_WARN = 4;
this.LOG_NOTICE = 5;
this.LOG_INFO = 6;
this.LOG_DEBUG = 7;

this.LEVELS = ['emerg', 'altert', 'crit', 'error', 'warn', 'notice', 'info', 'debug'];

process.stderr.fd = process.stderr.fd || 2;

this.Logger = function (verbosity, logfile) {
    this.verbosity = verbosity;
    this.logfile = logfile && fs.createWriteStream(logfile, { flags: 'a+', encoding: 'ascii', mode: 0666 });
};

this.Logger.prototype = {
    log: function (msg, lvl, args) {
        if (lvl > this.verbosity) { return }

        var stream = this.stream(lvl),
            time = new(Date), header;

        if (tty.isatty(stream.fd)) {
            header = '\x1b[90m' + time.toLocaleTimeString() + ' \x1b[0;1m' + process.title + '\x1b[0m';
        } else {
            header = time.toJSON() + process.title;
        }
        header += '[' + process.pid + ']';

        var level = this.level(lvl, stream);

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
        return stream.write(header + ' ' + level + ' ' + msg + '\n', 'ascii');
    },
    debug:  function (msg) { this.log(msg, exports.LOG_DEBUG,  Array.prototype.slice.call(arguments, 1)) },
    info:   function (msg) { this.log(msg, exports.LOG_INFO,   Array.prototype.slice.call(arguments, 1)) },
    notice: function (msg) { this.log(msg, exports.LOG_NOTICE, Array.prototype.slice.call(arguments, 1)) },
    warn:   function (msg) { this.log(msg, exports.LOG_WARN,   Array.prototype.slice.call(arguments, 1)) },
    error:  function (msg) { this.log(msg, exports.LOG_ERROR,  Array.prototype.slice.call(arguments, 1)) },
    crit:   function (msg) { this.log(msg, exports.LOG_CRIT,   Array.prototype.slice.call(arguments, 1)) },

    stream: function (lvl) {
        if (this.logfile) {
            return this.logfile;
        } else {
            return lvl < exports.LOG_WARN ? process.stderr : process.stdout;
        }
    },

    level: function (lvl, stream) {
        var level = '\x1b[1m ' + exports.LEVELS[lvl] + ' \x1b[21m';
        if (!this.logfile && tty.isatty(stream.fd)) {
            switch (lvl) {
                default:
                case exports.LOG_DEBUG:
                    return '\x1b[30m' + level + '\x1b[39m';
                case exports.LOG_INFO:
                    return '\x1b[37m' + level + '\x1b[39m';
                case exports.LOG_NOTICE:
                    return '\x1b[36m' + level + '\x1b[39m';
                case exports.LOG_WARN:
                    return '\x1b[33m' + level + '\x1b[39m';
                case exports.LOG_ERROR:
                case exports.LOG_CRIT:
                    return '\x1b[31m' + level + '\x1b[39m';
            }
        } else {
            return '[' + exports.LEVELS[lvl] + ']';
        }
    }
};

