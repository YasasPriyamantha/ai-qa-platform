/**
 * explore command (Task P4, DEC-040)
 *
 * Runs one AI exploration (P3 loop, P2 gateway, P1 connection) of a project's
 * baseUrl or --start URL and saves the observation record. The project's
 * exploration.mode decides whether it is read-only or interactive, and
 * --requirement guides it to the pages those requirements describe (Q2). Refuses
 * before starting MCP unless AI is enabled, the API key is present and a
 * valid budget exists. The MCP server's output directory is inside the
 * exploration's own git-ignored folder and is deleted when the exploration
 * ends, because the server writes it without credential scrubbing (Q3 fix).
 */

import { join, resolve } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { loadPhase2ProjectConfig, ConfigValidationError, getProjectStoragePaths } from '../projects/index.js';
import { validateBaseUrl } from '../projects/loader.js';
import { getEnvSecret } from '../provider-secrets/index.js';
import { loadRequirementRegistry, type Requirement } from '../requirements/index.js';
import { createOpenAIAdapter, type ProviderAdapter } from '../model-providers/index.js';
import { buildPlaywrightMcpLaunch, McpConnection } from '../mcp/playwright-mcp.js';
import { ToolGateway } from '../mcp/tool-gateway.js';
import { runExploration } from '../exploration/loop.js';
import { explorationDirectory, newExplorationId, saveExplorationRecord, type ExplorationContext } from '../exploration/record.js';
import { loadAiSetup } from './ai-setup.js';
import { displayError } from './output.js';
import { EXIT_SUCCESS, EXIT_FAILURE } from './run-command.js';

/** Fixed exploration limits; the AI request and token limits come from config/ai-budget.json. */
const MAX_TOOL_CALLS = 30;
const MAX_DURATION_MS = 10 * 60_000;
const CALL_TIMEOUT_MS = 30_000;

export interface ExploreOptions {
  readonly configPath: string;
  /** Start page instead of the project's baseUrl; must pass the domain rule. */
  readonly startUrl?: string;
  /** Directory holding .env and config/ (default: current working directory). */
  readonly rootDir?: string;
  /** Requirement IDs whose pages the exploration should reach. */
  readonly requirementIds?: readonly string[];
  /** Adapter override; tests inject a fake. Default: the OpenAI adapter. */
  readonly adapter?: ProviderAdapter;
}

export async function executeExploreCommand(options: ExploreOptions): Promise<number> {
  const rootDir = options.rootDir ?? process.cwd();
  const refuse = (title: string, details?: string) => {
    displayError(`Exploration refused: ${title}`, details);
    return EXIT_FAILURE;
  };

  let config;
  try {
    config = loadPhase2ProjectConfig(resolve(process.cwd(), options.configPath));
  } catch (err) {
    const title = err instanceof ConfigValidationError ? 'Invalid project configuration' : 'Cannot load project configuration';
    displayError(title, (err as Error).message);
    return EXIT_FAILURE;
  }
  const requirementIds = options.requirementIds ?? [];
  let requirements: Requirement[] = [];
  if (requirementIds.length > 0) {
    let stored;
    try {
      stored = loadRequirementRegistry(getProjectStoragePaths(config.projectWorkspace).requirementsRegistryPath).requirements;
    } catch (err) {
      return refuse('cannot read the requirement registry', (err as Error).message);
    }
    const unknown = requirementIds.filter((id) => stored[id]?.status !== 'active');
    if (unknown.length > 0) return refuse('unknown or retired requirement', unknown.join(', '));
    requirements = requirementIds.map((id) => stored[id]);
  }
  const startUrl = options.startUrl ?? config.baseUrl;
  try {
    validateBaseUrl(startUrl, config.allowedDomains);
  } catch (err) {
    return refuse('start URL is not allowed', `${startUrl}: ${(err as Error).message.replace(/^baseUrl: /, '')}`);
  }

  const ai = loadAiSetup(rootDir);
  if (!ai.ok) return refuse(ai.title, ai.details);
  const { secretContext, provider, budget } = ai.setup;
  const { envFile } = secretContext;

  // Role credential values from the parsed root .env (never process.env); the model only sees placeholders (DEC-041 §7).
  const credentials: Record<string, Record<string, string>> = {};
  const credentialPlaceholders: string[] = [];
  for (const role of config.roles ?? []) {
    for (const [key, variable] of Object.entries(role.credentials)) {
      const value = envFile.success ? getEnvSecret(envFile.values, variable) : undefined;
      if (value === undefined) continue;
      (credentials[role.roleId] ??= {})[key] = value;
      credentialPlaceholders.push(`{{credential:${role.roleId}.${key}}}`);
    }
  }
  const mode = config.exploration?.mode ?? 'read-only';

  const b = budget;
  const context: ExplorationContext = {
    explorationId: newExplorationId(),
    projectId: config.projectId,
    startUrl,
    requirementIds,
    providerId: provider.providerId,
    modelId: provider.defaultModelId,
    startedAt: new Date().toISOString(),
    limits: {
      maxAiRequests: b.maxTotalRequests,
      maxToolCalls: MAX_TOOL_CALLS,
      maxDurationMs: MAX_DURATION_MS,
      callTimeoutMs: CALL_TIMEOUT_MS,
      budget: {
        maxTotalRequests: b.maxTotalRequests,
        maxInputTokensPerRequest: b.maxInputTokensPerRequest,
        maxOutputTokensPerRequest: b.maxOutputTokensPerRequest,
        maxCumulativeInputTokens: b.maxCumulativeInputTokens,
        maxCumulativeOutputTokens: b.maxCumulativeOutputTokens,
        window: b.window,
      },
    },
  };
  const mcpOutputDir = join(explorationDirectory(config.projectWorkspace, context.explorationId), 'mcp-output');
  mkdirSync(mcpOutputDir, { recursive: true });

  console.log('');
  console.log(`  Exploring ${startUrl} (${config.projectId}, ${mode}, ${provider.providerId} ${provider.defaultModelId})...`);
  let result;
  try {
    const connection = await McpConnection.connect(
      buildPlaywrightMcpLaunch({ allowedDomains: config.allowedDomains, outputDir: mcpOutputDir, baseEnv: process.env })
    );
    let gateway: ToolGateway;
    try {
      gateway = await ToolGateway.create(connection, {
        allowedDomains: config.allowedDomains,
        maxToolCalls: MAX_TOOL_CALLS,
        callTimeoutMs: CALL_TIMEOUT_MS,
        mode,
        credentials,
      });
    } catch (err) {
      await connection.close();
      throw err;
    }
    result = await runExploration({
      startUrl,
      providerId: provider.providerId,
      modelId: provider.defaultModelId,
      adapter: options.adapter ?? createOpenAIAdapter(),
      secretContext,
      budgetConfig: b,
      gateway,
      mcp: connection,
      maxAiRequests: context.limits.maxAiRequests,
      maxDurationMs: MAX_DURATION_MS,
      requirements,
      credentialPlaceholders,
    });
  } catch (err) {
    displayError('Exploration failed', (err as Error).message);
    return EXIT_FAILURE;
  } finally {
    // The server's own output (page text, console logs, off-domain pages) is never scrubbed, so none of it is kept (DEC-041 §7).
    rmSync(mcpOutputDir, { recursive: true, force: true });
  }

  let saved;
  try {
    saved = saveExplorationRecord(config.projectWorkspace, context, result);
  } catch (err) {
    displayError('Cannot save the observation record', (err as Error).message);
    return EXIT_FAILURE;
  }
  const { record, recordPath } = saved;
  const limits = context.limits.budget;
  console.log('');
  console.log(`  Stop reason:   ${record.stopReason}${record.error ? ` (${record.error})` : ''}`);
  console.log(`  Pages visited: ${record.pagesVisited.length}`);
  for (const page of record.pagesVisited) console.log(`    - ${page}`);
  console.log(`  Tool calls:    ${record.usage.toolCalls}/${MAX_TOOL_CALLS} (snapshots: ${record.evidence.length})`);
  console.log(`  AI requests:   ${record.usage.aiRequests}/${context.limits.maxAiRequests}`);
  console.log(`  Tokens:        input ${record.usage.inputTokens}/${limits.maxCumulativeInputTokens}, output ${record.usage.outputTokens}/${limits.maxCumulativeOutputTokens}`);
  console.log(`  Record:        ${recordPath}`);
  console.log('');
  return record.summary ? EXIT_SUCCESS : EXIT_FAILURE;
}
