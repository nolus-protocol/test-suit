prepare-test-integration-dev:
	/bin/bash ./scripts/run-test-integration-dev.sh $(shell pwd)  >&2

prepare-test-integration-local:
	/bin/bash ./scripts/run-test-integration-local.sh $(shell pwd)  >&2