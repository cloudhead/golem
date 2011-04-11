var http = require('http');

module.exports = function (server, callback) {
    server.port = 8888;
    server.workers = 4;

    // Set process uid/gid to user 'nobody'
    // server.user = 'nobody';
    // server.group = 'nobody';

    var app = http.createServer(function (req, res) {
        res.writeHead(200, {});
        res.end('hello from ' + process.pid + '!');
    });

    // Called when a new worker is spawned and
    // ready to process requests.
    server.once('worker', function (worker) {
        console.log(worker.toString() + ' ready!');
    });

    server.on('workerExit', function (worker) {
        console.log(worker.toString() + ' just went down!');
    });

    callback(app);
};


