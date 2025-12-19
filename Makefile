SHELL := /bin/bash

DEV_HOST ?=

.PHONY: dev restore-prod check-prod package-plugin

dev:
	TRMNL_HOST=$(DEV_HOST) ./dev.sh --reset --open

restore-prod:
	./scripts/restore-prod-config.sh

check-prod:
	./scripts/check-prod-config.sh

package-plugin:
	tar -czf trmnl_chess.tar.gz trmnl_chess
	@echo "Created trmnl_chess.tar.gz for manual upload if needed."
