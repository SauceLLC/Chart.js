
all: node_modules/.build
	./node_modules/.bin/rollup -c
	@echo -e "\n *** Build Done ***\n"
	@du -h dist/*.js

node_modules/.build: package.json
	npm install
	touch $@

distclean:
	rm -rf node_modules
	rm -rf dist/*

clean:
	rm -rf dist/*

.PHONY: clean distclean all
