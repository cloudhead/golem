
golem
=====

> pre-forking HTTP server for node.

introduction
------------

**golem** was directly inspired by [unicorn](http://raa.ruby-lang.org/project/unicorn/) and [nginx](http://nginx.org),
in its pre-forking model, UNIX-oriented design and signal handling. Unlike unicorn, it is capable of handling slow clients,
and doesn't need to run behind a load-balancer. This is due to [node](http://nodejs.org) being inherently designed to handle
slow clients.

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
