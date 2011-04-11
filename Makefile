
SHELL := /bin/bash

TARGET = build/default/golem.node

$(TARGET): src/golem.cc
		node-waf configure build

man:
	mkdir  -p man
	pandoc -f markdown -t man -s doc/golem.1.md -o man/golem.1

install: man $(TARGET)
	mkdir -p /usr/local/man/man1
	cp man/golem.1 /usr/local/man/man1
	mandb /usr/local/man/man1
	npm install .

clean:
	rm -rf build
	rm -rf man

.PHONY: man
