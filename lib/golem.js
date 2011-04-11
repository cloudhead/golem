
var netb = process.binding('net');

require.paths.unshift(__dirname);

this.VERSION = [0, 1, 0];

var posix = require('golem/posix');

this.Server = require('golem/server').Server;

function abort() {
    console.error('golem-master failed to start.');
    process.exit(1);
}

//
// Grandparent - Exits when Master is ready
// \_ Parent   - Exits immediately
//    \_ Master (Golem)
//
this.daemonize = function () {
    // Create a uni-directional unix pipe
    var pipe = posix.pipe();

    if (posix.fork()) {
        // - Grandparent -
        // Close write-end of ready-pipe.
        // Exit process once we receive notice
        // from the master process that it has 
        // started successfuly.
        pipe[1].destroy();
        pipe[0].resume();
        pipe[0].on('data', function (data) {
            if (parseInt(data.toString('ascii')) > 1) {
                process.exit(0);
            } else {
                abort();
            }
        }).on('close', function () {
            abort();
        });
    } else {
        // - Parent -
        // Start a new Session,
        // close read-end of the ready-pipe
        posix.setsid();
        pipe[0].destroy();

        // Fork again, we don't want
        // to be Session Leader.
        if (posix.fork()) {
            process.exit(0);
        } else {
            // - Golem Master -
            // Set process title, file mask &
            // close standard file descriptors
            process.title = 'golem-master';
            process.umask(0);
            posix.closeStdio();

            // Return ready-pipe write stream,
            // so we can pass it to our Server instance.
            return pipe[1];
        }
    }
};

