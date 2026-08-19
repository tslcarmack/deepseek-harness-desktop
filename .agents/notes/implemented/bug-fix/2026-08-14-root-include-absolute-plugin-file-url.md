# Agent Note: Convert absolute plugin paths to file URLs on every root include

Status: implemented

English | [中文](2026-08-14-root-include-absolute-plugin-file-url.zh.md)

## Problem

A `--patch` overlay names a local plugin with an absolute filesystem path because the patch file does not change the profile directory the loader uses for relative specifiers. Node's ESM loader accepts a POSIX absolute path, but a Windows drive-letter path such as `D:/code/plugin.ts` is parsed as the URL scheme `d:` and rejected with `ERR_UNSUPPORTED_ESM_URL_SCHEME`.

`mountRootInclude` already converted absolute paths to `file:` URLs, but only on the `HostResolvedRootInclude` subclass used when `bareModuleBaseUrl` is set. Source-launch `pnpm dsh web --patch` does not pass that argument, so the documented first-plugin overlay failed on Windows.

## Decision

The root `cordis:include` builtin is always a `RootInclude` subclass. Every import converts an absolute filesystem path with `pathToFileURL` before Node's ESM loader receives it. Relative specifiers and `cordis:` builtins still go through `EntryTree.import`. When `bareModuleBaseUrl` is set, bare package names continue to resolve against that host base.

The same conversion already exists on preset trees. This note owns the boot include used by `dsh` and other app bins, not the preset mount.

## Alternatives considered

**Convert only when `bareModuleBaseUrl` is set.** Rejected because that is the defect: source-launch and in-process `boot()` callers omit the host base, and those are the paths that load a `--patch` overlay.

**Rewrite absolute names when parsing the patch file.** Rejected because a base `cordis.yml` row can also carry an absolute path, and the user-facing name should remain a filesystem path.

**Change vendored `EntryTree.import`.** Rejected because the conversion is a DeepSeek Harness boot contract already implemented beside the host-base override; a vendor edit would need an upstream-local-modification log for a rule this repository already owns.

## Consequences

`pnpm dsh web --patch` accepts a Windows drive-letter plugin path. POSIX absolute paths become `file:` URLs as well; Node already accepted the unconverted form there. Unit coverage spies on Loader `internal.import` during `boot()` without a host base and asserts the file URL.
