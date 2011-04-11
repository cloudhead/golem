
golem
=====

> pre-forking HTTP server for node.

introduction
------------

**golem** was directly inspired by [unicorn](http://raa.ruby-lang.org/project/unicorn/) and [nginx](http://nginx.org),
in its pre-forking model, UNIX-oriented design and signal handling. Unlike unicorn, it is capable of handling slow clients,
and doesn't need to run behind a load-balancer. This is due to [node](http://nodejs.org) being inherently designed for
slow clients.

overview
--------

**golem** is started with the `golem` command, which takes a number of options, and a path to the application file:

    $ golem -p 8888 -n 2 server/index.js

*See the `examples/` folder for examples. For information on all the options, see the `golem(1)` man page.*

One may choose to start **golem** in *daemonized* mode, this is simply achieved by passing the `-D` flag. **golem**
will then fork itself twice, start a new session and detach itself from the terminal. If the child process hasn't
encountered any errors, it will signal its grand-parent (which will exit promptly), and start listening for connections.

Once it's started accepting connections, **golem** distributes the load amongst its worker processes. If a worker dies,
it is respawned immediately. The running instance can be controlled via standard POSIX signals, such as `SIGHUP` and `SIGQUIT`:

    $ kill -s SIGQUIT `cat /var/run/golem.pid`

This performs a graceful shutdown of the master and all workers.

logging
-------

**golem** has several ways of logging:

### stdout/stderr #

This is the default, when in *development* mode. Output is to current terminal.

### log file #

This is the default, when in *production* mode. Output is to a file of your choosing.
It defaults to `/var/log/golem.log`, this can be changed via the command-line, with the
`--log` option, and similarly in the server file.

### custom logger #

We can specify a custom logger, by setting the `logger` option in the server file, for example
if we want *syslog* logging, we can do:

    config.logger = syslog.createClient(514, 'localhost');

documentation
-------------

See the `golem(1)` man page for specifics. Alternatively, you can view `doc/golem.1.md`.

development
-----------

Run `make` to build the source files, `make install` to install.

license
-------

**golem** is licensed under the AGPLv3 license. See `LICENSE` for more information.

copyright
---------

Copyright (C) 2011 [Alexis Sellier](http://cloudhead.io)
