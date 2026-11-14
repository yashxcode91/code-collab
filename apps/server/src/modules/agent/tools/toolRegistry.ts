import { prisma } from '@codecollab/database';
import {
  AgentToolName,
  AGENT_LIMITS,
} from '@codecollab/shared';
import { AppError } from '../../../utils/AppError';
import { AgentTool, AgentToolContext } from './agentTool.interface';
import { ReadFileTool } from './readFile.tool';
import { WriteFileTool } from './writeFile.tool';
import { EditFileTool } from './editFile.tool';
import { SearchCodebaseTool } from './searchCodebase.tool';
import { ListDirectoryTool } from './listDirectory.tool';
import { RunVerificationTool } from './runVerification.tool';

export class ToolRegistry {
  private readonly tools = new Map<AgentToolName, AgentTool>();

  constructor() {
    this.register(new ReadFileTool());
    this.register(new WriteFileTool());
    this.register(new EditFileTool());
    this.register(new SearchCodebaseTool());
    this.register(new ListDirectoryTool());
    this.register(new RunVerificationTool());
  }

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  getTool(name: AgentToolName): AgentTool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  getToolDeclarations(): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> {
    return [
      {
        name: 'read_file',
        description:
          'Reads file content from workspace by relative path with optional line numbers.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path of file' },
            lineStart: { type: 'number', description: 'Starting line number' },
            lineEnd: { type: 'number', description: 'Ending line number' },
          },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description:
          'Writes or replaces full file content into the quarantined review staging buffer.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path of file' },
            content: { type: 'string', description: 'Complete source content' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'edit_file',
        description:
          'Surgically replaces target string with replacement text in an existing file.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path of file' },
            target: { type: 'string', description: 'Exact string to match' },
            replacement: { type: 'string', description: 'New string to inject' },
          },
          required: ['path', 'target', 'replacement'],
        },
      },
      {
        name: 'search_codebase',
        description:
          'Performs semantic vector search across project codebase using pgvector.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Natural language or code query' },
            topK: { type: 'number', description: 'Max results to return (1-20)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'list_directory',
        description:
          'Lists files in workspace branch overlaid with current uncommitted staged files.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Optional directory path prefix' },
            recursive: { type: 'boolean', description: 'Whether to list recursively' },
          },
        },
      },
      {
        name: 'run_verification',
        description:
          'Runs in-memory TypeScript syntax & compilation verification. Returns compiler diagnostics.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Optional verification command' },
          },
        },
      },
    ];
  }

  /**
   * Executes a tool with strict payload validation, execution timing, and
   * database audit logging into `agent_tool_calls`.
   */
  async executeTool(params: {
    toolName: string;
    context: AgentToolContext;
    inputPayload: Record<string, unknown>;
    stepId?: string;
  }): Promise<{
    toolCallId: string;
    output: any;
    durationMs: number;
    error?: string;
  }> {
    const { toolName, context, inputPayload, stepId } = params;
    const tool = this.tools.get(toolName as AgentToolName);

    if (!tool) {
      throw new AppError(
        404,
        'TOOL_NOT_FOUND',
        `Autonomous agent tool '${toolName}' is not registered`
      );
    }

    // 1. Validate payload using tool's Zod schema
    const parsedInput = tool.schema.parse(inputPayload);

    // 2. Persist running tool call record
    const toolCallRecord = await prisma.agentToolCall.create({
      data: {
        sessionId: context.sessionId,
        stepId: stepId ?? null,
        toolName,
        inputPayload: inputPayload as any,
        status: 'RUNNING',
      },
    });

    const startTime = Date.now();

    try {
      // 3. Execute with timeout race
      const executionPromise = tool.execute(context, parsedInput);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new AppError(
              408,
              'TOOL_TIMEOUT',
              `Tool '${toolName}' timed out after ${AGENT_LIMITS.MAX_TOOL_EXECUTION_TIMEOUT_MS}ms`
            )
          );
        }, AGENT_LIMITS.MAX_TOOL_EXECUTION_TIMEOUT_MS);
      });

      const output = await Promise.race([executionPromise, timeoutPromise]);
      const durationMs = Date.now() - startTime;

      // 4. Update audit log with success
      await prisma.agentToolCall.update({
        where: { id: toolCallRecord.id },
        data: {
          status: 'SUCCESS',
          outputPayload: (output ?? {}) as any,
          durationMs,
        },
      });

      return {
        toolCallId: toolCallRecord.id,
        output,
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err.message || 'Tool execution failure';

      // 5. Update audit log with error
      await prisma.agentToolCall.update({
        where: { id: toolCallRecord.id },
        data: {
          status: 'ERROR',
          errorMessage,
          durationMs,
        },
      });

      throw err;
    }
  }
}

export const defaultToolRegistry = new ToolRegistry();
