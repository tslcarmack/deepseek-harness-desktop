# Agent Note: Convert absolute plugin paths to file URLs on every root include

Status: implemented

[English](2026-08-14-root-include-absolute-plugin-file-url.md) | 中文

## Problem

`--patch` 覆盖层用绝对文件系统路径命名本地插件，因为 patch 文件不会改变 loader 解析相对 specifier 时所使用的 profile 目录。Node 的 ESM loader 接受 POSIX 绝对路径，但会把 `D:/code/plugin.ts` 这样的 Windows 盘符路径解析成 URL scheme `d:`，并以 `ERR_UNSUPPORTED_ESM_URL_SCHEME` 拒绝。

`mountRootInclude` 已经会把绝对路径转换成 `file:` URL，但只发生在传入 `bareModuleBaseUrl` 时使用的 `HostResolvedRootInclude` 子类上。源码启动的 `pnpm dsh web --patch` 不会传入该参数，因此文档中的第一个插件覆盖层在 Windows 上会失败。

## Decision

根 `cordis:include` builtin 始终是 `RootInclude` 子类。每次 import 都会在 Node 的 ESM loader 接收路径之前，用 `pathToFileURL` 转换绝对文件系统路径。相对 specifier 和 `cordis:` builtin 仍走 `EntryTree.import`。传入 `bareModuleBaseUrl` 时，裸包名继续相对该宿主基准解析。

preset 树已经有同样的转换。本笔记负责 `dsh` 及其他 app bin 使用的启动 include，不负责 preset 挂载。

## Alternatives considered

**仅在传入 `bareModuleBaseUrl` 时转换。** 否决：这正是缺陷所在。源码启动和进程内 `boot()` 调用方会省略宿主基准，而这些路径正是加载 `--patch` 覆盖层的路径。

**在解析 patch 文件时改写绝对名称。** 否决：基础 `cordis.yml` 行也可以携带绝对路径，而且面向用户的名称应保持为文件系统路径。

**改 vendored 的 `EntryTree.import`。** 否决：该转换是 DeepSeek Harness 的启动约定，已经实现在宿主基准覆盖旁边；为仓库已拥有的规则去改 vendor，还要记入上游本地修改日志。

## Consequences

`pnpm dsh web --patch` 接受 Windows 盘符插件路径。POSIX 绝对路径同样会变成 `file:` URL；Node 在那里本来就接受未转换的形式。单元覆盖在不带宿主基准的 `boot()` 期间监视 Loader 的 `internal.import`，并断言收到的是 file URL。
