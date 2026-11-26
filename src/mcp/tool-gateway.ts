/**
 * Safe tool gateway for Playwright MCP (Task P2, DEC-040 §3.4–3.6, §3.9).
 *
 * The only path from the model to the browser. It offers the read-only tool
 * allowlist, checks each call's arguments against the tool's input schema
 * and the project's domain rule before calling the server, re-checks the page
 * URL after every call, limits and times out calls, and turns every outcome
 * into text-only ToolResultMessage content. It never throws for a tool call.
 */

import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv';
import { validateBaseUrl } from '../projects/loader.js';
import { toolResultMessage, type ToolCall, type ToolResultMessage } from '../model-providers/messages.js';
import type { ToolDefinition } from '../model-providers/request.js';
import type { McpConnection } from './playwright-mcp.js';

/** Read-only tools offered to the model (exact Playwright MCP names, §3.4). */
const ALLOWED_TOOLS = ['browser_navigate', 'browser_snapshot', 'browser_navigate_back', 'browser_wait_for'] as const;

/** Arguments refused even though the schema allows them: no file access (Architecture §3.6). */
const FORBIDDEN_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  browser_snapshot: ['filename'],
};

/** The tool that produces raw page evidence. */
const SNAPSHOT_TOOL = 'browser_snapshot';

/** Why the gateway stopped accepting calls. */
export type GatewayStopReason = 'domain_violation' | 'tool_call_limit';

/** Raw snapshot text kept for the observation record (P4). May contain MCP element references (§3.9). */
export interface Evidence {
  readonly id: string;
  readonly toolName: string;
  readonly text: string;
}

export interface GatewayCallOutcome {
  /** The result to append to the conversation; text only. */
  readonly result: ToolResultMessage;
  /** Set for a successful snapshot. */
  readonly evidence?: Evidence;
  /** Set when this call stopped the session. */
  readonly stopReason?: GatewayStopReason;
}

export interface ToolGatewayOptions {
  readonly allowedDomains: readonly string[];
  readonly maxToolCalls: number;
  readonly callTimeoutMs: number;
}

/** The part of the P1 connection the gateway uses. */
type McpToolClient = Pick<McpConnection, 'listTools' | 'callTool'>;

type ArgumentCheck = (input: unknown) => { valid: boolean; errorMessage?: string };

/** Page URLs reported in a Playwright MCP result ("- Page URL: …" lines). */
function pageUrls(text: string): string[] {
  return [...text.matchAll(/^- Page URL: (\S+)/gm)].map((m) => m[1]);
}

/** The domain rule (§3.5a): the project's baseUrl validation, or null when allowed. */
function domainError(url: string, allowedDomains: readonly string[]): string | null {
  try {
    validateBaseUrl(url, [...allowedDomains]);
    return null;
  } catch (err) {
    return (err as Error).message.replace(/^baseUrl: /, ''); // the rule is shared; the field name is not
  }
}

export class ToolGateway {
  private callCount = 0;
  private evidenceCount = 0;
  private stopped?: GatewayStopReason;

  private constructor(
    private readonly client: McpToolClient,
    private readonly options: ToolGatewayOptions,
    /** Tool definitions offered to the model (§3.6: external schema, unchanged). */
    readonly tools: readonly ToolDefinition[],
    private readonly checks: ReadonlyMap<string, ArgumentCheck>
  ) {}

  /** List the server's tools and keep the allowlist. Throws if an allowlisted tool is missing. */
  static async create(client: McpToolClient, options: ToolGatewayOptions): Promise<ToolGateway> {
    const listed = await client.listTools();
    const validator = new AjvJsonSchemaValidator();
    const tools: ToolDefinition[] = [];
    const checks = new Map<string, ArgumentCheck>();
    for (const name of ALLOWED_TOOLS) {
      const tool: Tool | undefined = listed.find((t) => t.name === name);
      if (!tool) throw new Error(`Playwright MCP server does not offer the required tool '${name}'`);
      tools.push({
        name,
        description: tool.description ?? '',
        parameters: { kind: 'external_json_schema', source: 'mcp:playwright', jsonSchema: tool.inputSchema },
      });
      checks.set(name, validator.getValidator(tool.inputSchema as Parameters<typeof validator.getValidator>[0]));
    }
    return new ToolGateway(client, options, tools, checks);
  }

  /** Why the gateway stopped, if it has. */
  get stopReason(): GatewayStopReason | undefined {
    return this.stopped;
  }

  /** Run one model tool call. Never throws; failures come back as `Tool error: …` text. */
  async call(toolCall: ToolCall, signal?: AbortSignal): Promise<GatewayCallOutcome> {
    const fail = (message: string, stopReason?: GatewayStopReason): GatewayCallOutcome => ({
      result: toolResultMessage(toolCall.id, toolCall.name, `Tool error: ${message}`, true),
      ...(stopReason ? { stopReason } : {}),
    });

    if (this.stopped) return fail(`the browser session has stopped (${this.stopped})`);
    const check = this.checks.get(toolCall.name);
    if (!check) return fail(`tool '${toolCall.name}' is not allowed; allowed tools: ${ALLOWED_TOOLS.join(', ')}`);

    let args: unknown;
    try {
      args = JSON.parse(toolCall.arguments || '{}');
    } catch {
      return fail('arguments are not valid JSON');
    }
    if (typeof args !== 'object' || args === null || Array.isArray(args)) return fail('arguments must be a JSON object');
    const checked = check(args);
    if (!checked.valid) return fail(`invalid arguments: ${checked.errorMessage ?? 'schema validation failed'}`);
    const forbidden = (FORBIDDEN_ARGUMENTS[toolCall.name] ?? []).filter((key) => key in args);
    if (forbidden.length > 0) return fail(`argument '${forbidden[0]}' is not allowed`);
    const record = args as Record<string, unknown>;
    if (toolCall.name === 'browser_navigate') {
      const error = domainError(String(record.url), this.options.allowedDomains);
      if (error) return fail(`navigation refused: ${error}`);
    }

    if (this.callCount >= this.options.maxToolCalls) {
      this.stopped = 'tool_call_limit';
      return fail(`tool call limit (${this.options.maxToolCalls}) reached`, 'tool_call_limit');
    }
    if (signal?.aborted) return fail('cancelled');
    this.callCount++;

    let response: CallToolResult;
    const timeout = AbortSignal.timeout(this.options.callTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      response = await new Promise<CallToolResult>((resolve, reject) => {
        combined.addEventListener('abort', () => reject(combined.reason), { once: true });
        this.client.callTool(toolCall.name, record, { signal: combined, timeoutMs: this.options.callTimeoutMs })
          .then(resolve, reject);
      });
    } catch (err) {
      if (timeout.aborted) return fail(`timed out after ${this.options.callTimeoutMs} ms`);
      if (signal?.aborted) return fail('cancelled');
      return fail((err as Error).message);
    }

    // Text only (§3.6): non-text items are dropped and replaced by a note.
    const text = response.content
      .map((item) => (item.type === 'text' ? item.text : `[${item.type} content omitted: text-only results]`))
      .join('\n');

    // Re-check the page the browser is on (§3.5b); off-domain content is withheld.
    for (const url of pageUrls(text)) {
      if (url === 'about:blank') continue;
      const error = domainError(url, this.options.allowedDomains);
      if (error) {
        this.stopped = 'domain_violation';
        return fail(`domain_violation: the browser left the allowed domains (${error}); page content withheld`, 'domain_violation');
      }
    }

    if (response.isError) return fail(text);
    if (toolCall.name !== SNAPSHOT_TOOL) {
      return { result: toolResultMessage(toolCall.id, toolCall.name, text) };
    }
    const evidence: Evidence = { id: `ev-${String(++this.evidenceCount).padStart(3, '0')}`, toolName: toolCall.name, text };
    return {
      result: toolResultMessage(toolCall.id, toolCall.name, `Evidence ID: ${evidence.id}\n${text}`),
      evidence,
    };
  }
}
