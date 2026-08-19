/**
 * Browser wire client. The plugin selects fixture or HTTP transport, provides
 * the shared API client, and lets the runtime object layer start the stream
 * controller with its sinks. It does not construct the IPC client.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { IApiClient } from './api.ts'
import { FixtureApiClient } from './fixture.ts'
import { readDshDesktop } from './dsh-desktop.ts'
import { createConnectionHandle } from './handle.ts'
import { WebApiClient } from './web-api-client.ts'
import { createWebConnectionRpc } from './rpc.ts'
import { isLoopbackHostname } from '../loopback-hostname.ts'

// ---- Contract re-exports (browser-safe apiproxy channels + core types) ----
export type {
  ApiProxy, SessionsApi, SessionSearchItem, SessionSummary, PromptContentPart, HostApi, EventsApi, MuxFrame, HostFrame,
  ApprovalResponsePayload, QuestionResponsePayload, HistoryEntry, ToolEventView,
  DirectoryEntry, DirectoryListing,
  ToolCallView, ToolResultView, WorkspaceApi, WorkspaceId, WorkspaceView,
  SkillsApi, SkillEntry,
  ModelCatalogFailure, ModelCatalogModel, ModelProviderGroup, ModelReasoning,
  MessageId, ModelReasoningEffort, ModelSelection, QueueAction, QueuedInboxItem, SessionModels,
  SubagentsApi, SubagentAddress, SubagentCatalog, SubagentListEntry, SubagentPromptReceipt,
  JobView,
  RpcRequest, RpcResponse, RpcResult, RpcError, RpcErrorCode,
  ClientRequest, ServerResponse, ServerRequest, ClientResponse, RpcMessage, RpcReceipt,
  HostDescription, IApiClient, SessionId, SessionEvent, ContentBlock, StreamChunk,
  GoalsApi, GoalRef,
  SettingsApi, SettingsNamespaceView, SettingsPathOpView, SettingsSecretView,
  CredentialsApi, CredentialView, ConfigurableProviderView, DiscoveredModelView, LlmApi,
} from './api.ts'
export {
  RpcId,
  AbstractApiClient,
  transportError,
} from './api.ts'

// Connection loop types are public through ConnectionHandle.start; the
// controller remains package-internal.
export type { ConnectionConfig, ConnectionSinks, ConnectionState } from './connection.ts'
export type { ClientConnectionRpc } from '../rpc.ts'
export type { ConnectionHandle, HostDescriptionSource } from './handle.ts'

/** Required services (none — this is the wire root). */
export const inject: string[] = []

/**
 * Client plugin body: provide fixture or HTTP transport as ctx.connection.
 * When the desktop preload bridge is present and `?fixture` is absent, this
 * half does not provide — the desktop-app client half owns the IPC carrier.
 * @param ctx - client cordis context.
 */
export function apply(ctx: Context): void {
  const pageLocation = typeof location === 'undefined' ? undefined : location
  const fixture = pageLocation !== undefined && new URLSearchParams(pageLocation.search).has('fixture')
  const desktop = readDshDesktop()
  if (!fixture && desktop !== undefined) return
  const fixtureClient = fixture ? new FixtureApiClient() : undefined
  const api: IApiClient = fixtureClient ?? new WebApiClient()
  const rpc = fixtureClient?.rpc ?? createWebConnectionRpc()
  ctx.provide('connection', createConnectionHandle(
    api,
    rpc,
    desktop !== undefined || pageLocation === undefined || isLoopbackHostname(pageLocation.hostname),
  ))
}
