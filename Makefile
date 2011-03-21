
SHELL := /bin/bash

build/default/golem.node: src/golem.cc
		node-waf configure build

man:
	mkdir  -p man
	pandoc -f markdown -t man -s doc/golem.1.md -o man/golem.1

install: man
	mkdir -p /usr/local/man/man1
	cp man/golem.1 /usr/local/man/man1
	mandb /usr/local/man/man1

clean:
	rm -rf build
	rm -rf man

.PHONY: man
