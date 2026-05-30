# pi-harness-agent development tasks

cwd := "."

# List available recipes
default:
    @just --list

# Run all unit tests (stream parser + agent profiles)
test: test-unit test-profiles

# Run stream parser unit tests
test-unit:
    node --experimental-strip-types --test test/unit/stream-parser.test.ts

# Run agent profile validation tests
test-profiles:
    node --experimental-strip-types --test test/unit/agent-profiles.test.ts

# Run integration tests (static analysis + CLI smoke test)
test-integration:
    node --experimental-strip-types --test test/integration/extension-loading.test.ts

# Run all tests
test-all: test test-integration
    echo "✅ All tests passed!"
