import { generateContent, LLMContext } from './llm.js';
import * as files from './actions/files.js';
import * as server from './actions/server.js';
import * as email from './actions/email.js';
import * as system from './actions/system.js';

export interface ActionRequest {
  action: string;
  args?: Record<string, unknown>;
}

export interface ExecutorResult {
  type: 'text' | 'action_pending' | 'action_executed' | 'fallback_required';
  text?: string;
  pendingAction?: ActionRequest;
  actionResult?: string;
}

const SYSTEM_PROMPT_INJECTION = `
You are an AI assistant capable of executing local system commands.
To execute an action, you MUST output ONLY a valid JSON object matching this schema. Do not output markdown or explanatory text before or after the JSON.

{
  "action": "action_name",
  "args": {
    "param1": "value"
  }
}

Available actions:
- readFile (args: { path: string })
- listDirectory (args: { path: string })
- getServiceStatus (args: { name: string })
- readEmails (args: { folder: string, limit: number })
- writeFile (args: { path: string, content: string })
- deleteFile (args: { path: string })
- restartIIS (args: {})
- restartNodeRed (args: {})
- sendEmail (args: { to: string, subject: string, body: string })
- execCommand (args: { cmd: string })
- unlockLaptop (args: {})

If you DO NOT want to perform an action, just answer normally with plain text. Do not use JSON.
`.trim();

/**
 * Main entry point for processing a user message.
 */
export async function handleUserMessage(prompt: string, llmContext: LLMContext, modelKey?: string): Promise<ExecutorResult> {
  // Inject instructions so the LLM knows how to trigger actions via JSON
  const finalContext: LLMContext = {
    ...llmContext,
    systemPrompt: llmContext.systemPrompt 
      ? `${llmContext.systemPrompt}\n\n${SYSTEM_PROMPT_INJECTION}`
      : SYSTEM_PROMPT_INJECTION
  };

  const llmRes = await generateContent(prompt, finalContext, modelKey);

  if (llmRes.needsFallbackConfirmation) {
    return { type: 'fallback_required' };
  }

  const responseText = llmRes.text || '';
  const actionRequest = parseLLMResponse(responseText);

  if (!actionRequest) {
    // Normal conversation response
    return { type: 'text', text: responseText };
  }

  if (isActionDestructive(actionRequest.action)) {
    // Destructive actions MUST NOT be executed automatically (HITL rule)
    return {
      type: 'action_pending',
      pendingAction: actionRequest
    };
  }

  // Safe actions are executed immediately
  try {
    const result = await executeAction(actionRequest.action, actionRequest.args);
    return {
      type: 'action_executed',
      text: `Executed action: ${actionRequest.action}`,
      actionResult: typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)
    };
  } catch (error) {
    return {
      type: 'action_executed',
      text: `Failed to execute action: ${actionRequest.action}`,
      actionResult: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Executes a parsed action. Used directly for safe actions,
 * or called by telegram.ts after the user confirms a destructive action.
 */
export async function executeAction(actionName: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const requireString = (name: string, val: unknown) => {
    if (typeof val !== 'string') throw new Error(`Argument '${name}' must be a string`);
    return val;
  };
  
  const requireNumber = (name: string, val: unknown) => {
    const num = Number(val);
    if (isNaN(num)) throw new Error(`Argument '${name}' must be a valid number`);
    return num;
  };

  switch (actionName) {
    case 'readFile':
      return await files.readFile(requireString('path', args.path));
    case 'listDirectory':
      return await files.listDirectory(requireString('path', args.path));
    case 'writeFile':
      return await files.writeFile(requireString('path', args.path), requireString('content', args.content));
    case 'deleteFile':
      return await files.deleteFile(requireString('path', args.path));
    case 'getServiceStatus':
      return await server.getServiceStatus(requireString('name', args.name));
    case 'restartIIS':
      return await server.restartIIS();
    case 'restartNodeRed':
      return await server.restartNodeRed();
    case 'sendEmail':
      return await email.sendEmail(
        requireString('to', args.to), 
        requireString('subject', args.subject), 
        requireString('body', args.body)
      );
    case 'readEmails':
      return await email.readEmails(
        requireString('folder', args.folder || 'INBOX'), 
        args.limit ? requireNumber('limit', args.limit) : 10
      );
    case 'execCommand':
      return await system.execCommand(requireString('cmd', args.cmd));
    case 'unlockLaptop':
      return await system.unlockLaptop();
    default:
      throw new Error(`Unknown action: ${actionName}`);
  }
}

export function isActionDestructive(actionName: string): boolean {
  const destructiveActions = [
    'writeFile', 'deleteFile', 'restartIIS', 'restartNodeRed',
    'sendEmail', 'execCommand', 'unlockLaptop'
  ];
  return destructiveActions.includes(actionName);
}

function parseLLMResponse(text: string): ActionRequest | null {
  try {
    // Attempt to extract JSON from markdown code blocks
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonStr = match ? match[1] : text;
    
    const parsed = JSON.parse(jsonStr.trim());
    if (parsed && typeof parsed.action === 'string') {
      return parsed as ActionRequest;
    }
  } catch {
    // If it fails to parse, it means the LLM responded with normal text
  }
  return null;
}
