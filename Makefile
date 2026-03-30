PKG_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
NODE    := node
PNPM    := pnpm

.PHONY: build test agent-check

build:
	$(PNPM) --filter @browserkit/adapter-rescue-flights build

test: build
	$(PNPM) --filter @browserkit/adapter-rescue-flights test

## Call adapter tools over MCP HTTP (port 52746), dump results to agent-check-results.json.
## Requires: browserkit start (adapter must already be running).
agent-check: build
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo "  Rescue Flights — agent-check"
	@echo "  Adapter must be running: browserkit start"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	$(NODE) $(PKG_DIR)packages/adapter-rescue-flights/dist/run-check.js
