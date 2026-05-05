---
name: golang
description: Use when working with Go code, Go tooling, Go architecture, Go testing, Go performance, Go libraries, or Go debugging.
---

# Golang Skill Router

Use this skill for general Go work.

## Delegate to child skills

Use `golang-benchmark` for benchmarks, profiling, pprof, benchstat, and performance measurement.
Use `golang-cli` for CLI structure, flags, configuration, shell completion, and exit codes.
Use `golang-code-style` for formatting, comments, conventions, and idiomatic style.
Use `golang-concurrency` for goroutines, channels, mutexes, errgroup, worker pools, and race risks.
Use `golang-context` for context propagation, cancellation, timeouts, deadlines, and tracing values.
Use `golang-continuous-integration` for GitHub Actions, quality gates, linting, security scans, and releases.
Use `golang-data-structures` for slices, maps, arrays, containers, builders, generics, and copy semantics.
Use `golang-database` for database/sql, sqlx, pgx, transactions, NULL values, and query patterns.
Use `golang-dependency-injection` for constructors, dependency wiring, service lifecycles, and DI tradeoffs.
Use `golang-dependency-management` for go.mod, upgrades, vulnerabilities, MVS, and dependency automation.
Use `golang-design-patterns` for idiomatic architecture, options, lifecycle, resilience, and resource handling.
Use `golang-documentation` for godoc comments, README, examples, changelogs, and project docs.
Use `golang-error-handling` for wrapping, errors.Is/As, sentinels, custom errors, and production logging.
Use `golang-grpc` for protobuf, gRPC servers/clients, interceptors, TLS, errors, and streaming RPCs.
Use `golang-lint` for golangci-lint, staticcheck, go vet, lint configs, and suppression guidance.
Use `golang-modernize` for current Go idioms, newer standard library APIs, and modernization work.
Use `golang-naming` for package, type, interface, constant, boolean, receiver, and test naming.
Use `golang-observability` for slog, metrics, OpenTelemetry, profiling, alerts, and dashboards.
Use `golang-performance` after profiling or benchmarks identify a bottleneck to optimize.
Use `golang-popular-libraries` when choosing production-ready Go libraries or comparing alternatives.
Use `golang-project-layout` for new project layout, monorepos, workspaces, and package organization.
Use `golang-safety` for nil, aliasing, numeric conversion, resource lifecycle, and defensive copying risks.
Use `golang-samber-do` for dependency injection with github.com/samber/do.
Use `golang-samber-hot` for in-memory caching with github.com/samber/hot.
Use `golang-samber-lo` for finite slice, map, channel, string, tuple, and functional transformations.
Use `golang-samber-mo` for Option, Result, Either, Future, IO, Task, and nullable/error-safe flows.
Use `golang-samber-oops` for structured error handling with github.com/samber/oops.
Use `golang-samber-ro` for reactive streams, observables, subjects, and event-driven pipelines.
Use `golang-samber-slog` for slog handler extensions and logging integrations.
Use `golang-security` for injection, crypto, filesystem, network, cookies, secrets, and auth risks.
Use `golang-stay-updated` for Go learning resources, news, communities, and release tracking.
Use `golang-stretchr-testify` for testify assert, require, mock, suites, and advanced matchers.
Use `golang-structs-interfaces` for type design, embedding, assertions, field tags, and receiver choices.
Use `golang-testing` for tests, table-driven tests, mocks, coverage, fuzzing, fixtures, and suites.
Use `golang-troubleshooting` for bugs, crashes, deadlocks, races, debugging, and root-cause analysis.

## Default behavior

Prefer simple, idiomatic Go.
Use small interfaces at package boundaries.
Propagate `context.Context` where work can be cancelled.
Return errors instead of panicking.
Write table-driven tests for non-trivial behavior.
