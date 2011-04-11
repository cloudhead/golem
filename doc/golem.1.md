% GOLEM(1) Golem User Manual
% Alexis Sellier
% March 17, 2011

# NAME

  **golem** - pre-forking HTTP server for node

# SYNOPSIS

  **golem** [-p _PORT_] [-n COUNT] [_options_] [_server_]

# DESCRIPTION
   
  **golem** starts an HTTP or TCP server specified by _server_ on port _PORT_, and spawns _COUNT_
  worker processes to handle incoming connections.

  **golem** uses fork(2) to spawn worker processes, and bind(2) to share the listening socket amongst
  its workers.

  If _server_ is not specified, **golem** will look for "index.js" in **$PWD**. If _server_ is a directory,
  it will look for "index.js" in that directory.

  **golem** loads the file with **require**, and expects **module.exports** to be set to a function.
  The function is called by golem, and is passed a configuration object and a callback. The object is a proxy
  on which we can set options. The callback is to be called with our server instance if we can't return it synchronously:

  **server file example**:

      var app = require('./app'); // An `http.Server` instance

      module.exports = function (config, callback) {
          config.port    = 8888;
          config.workers = 4;

          process.nextTick(function () {
              callback(app);
          });
      }

  **golem** is controlled entirely via signals. See the **SIGNALS** section for information. Also note
  that certain signals can be sent via the keyboard, when golem is attached to a terminal. This is
  indicated when relevant, in the **SIGNALS** section.

# OPTIONS

  -n, \--workers _COUNT_
  :   Spawn _COUNT_ workers at startup. Defaults to the number of CPU cores.
      Workers will be restarted when necessary, to maintain count.

  -p, \--port _PORT_
  :   Listen on port _PORT_ for incoming HTTP connections. Defaults to 8080.

  -h, \--host _HOST_
  :   Bind to _HOST_. If unspecified, will use INADDR_ANY (0.0.0.0).
      Don't specify this if you don't know what you're doing.

  -s, \--signal _SIGNAL_
  :   Send signal _SIGNAL_ to the master process. Equivalent to:

      **kill -s SIGNAL \`cat /var/run/golem.pid\`.**

      If you specify a _PID_ via the `--pid` option, it will use that pid,
      instead of the one at the default path.

      For information on the possible values of _SIGNAL_, see the **SIGNALS** section.

  -I, \--include _PATH_
  :   Prepend _PATH_ to **require.paths**. Loaded applications will look
      here for node modules before they look elsewhere. You can separate paths
      with ':'. Example:

          -I ./:~/modules:./includes

  <!-- -R, \--require _PATH_
       :   Require CommonJS modules from _PATH_, before loading the application.
           This is equivalent to calling "require(_PATH_)" in the *CONFIG* file. -->

  -E, \--env _ENV_
  :   Run the server in environment _ENV_.

  -D, \--daemonize
  :   Run golem as a daemon. Detaches the process from the controlling terminal.
      
  \--pid _PATH_
  :   Use _PATH_ as the pid file path. Defaults to "/var/run/golem.pid",
      or "$PWD/golem.pid" if the former path is not writable.

  -v, \--version
  :   display version and exit.

  \--help
  :   display usage info and options.

  \--debug
  :   debug mode.

# SIGNALS

  TERM
  : Immediate shutdown, kill all workers immediately, then exit master.

  INT, ^C
  : Equivalent to **TERM**.

  HUP, ^R
  : Reload the config file, and gracefully restart all workers.

  QUIT, ^Q
  : Graceful shutdown, wait for workers to finish their current request, then exit.

  USR1
  : Not implemented.

  USR2
  : Re-execute the running binary. A separate QUIT should be sent to the original
    process once the child is verified to be up and running.

  WINCH
  : Gracefully stop all workers but keep the master running. This only works for daemonized processes.

  TTIN, ^K
  : Increment the number of worker processes by one.

  TTOU, ^J
  : Decrement the number of worker processes by one.

# COPYRIGHT

  Copyright (c) 2011 Alexis Sellier


