import { generateContent, LLMContext, TokenUsage } from './llm.js';
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
  usage?: TokenUsage;
}

const SYSTEM_PROMPT_INJECTION = `
You are an AI assistant capable of executing local system commands.
To execute an action, output ONLY a valid JSON object. No markdown, no explanation.

{
  "action": "action_name",
  "args": { "param1": "value" }
}

Available actions:
- readFile (args: { path: string }) — read file content
- listDirectory (args: { path: string }) — list directory contents
- writeFile (args: { path: string, content: string }) — create or overwrite a file
- deleteFile (args: { path: string }) — delete a file
- getServiceStatus (args: { name: string }) — check if a service is running
- restartIIS (args: {}) — restart IIS web server
- restartNodeRed (args: {}) — restart Node-RED service
- sendEmail (args: { to: string, subject: string, body: string }) — send email
- readEmails (args: { folder: string, limit: number }) — read emails
- execCommand (args: { cmd: string }) — run arbitrary shell command (last resort only)
- unlockLaptop (args: {}) — unlock the laptop screen
- getHostname (args: {}) — returns the machine name (e.g. "Gilgamesh")
- getUsername (args: {}) — returns the OS username (e.g. "randi")
- getEnvVar (args: { name: string }) — returns an environment variable value
- getOSInfo (args: {}) — returns OS type, version, architecture
- getSpecialFolder (args: { folder: string }) — returns the real path of a special folder (Desktop, MyDocuments, MyPictures, MyMusic, Startup)

Rules:
1. When the user asks for the machine name or computer name → use getHostname
2. When the user asks for the username or current user → use getUsername
3. When resolving file paths that include the user folder or desktop, use getSpecialFolder. Only fall back to getUsername if the path is not a recognized special folder.
4. Never hardcode usernames or paths. Always resolve them dynamically.
5. Only use execCommand when no other action fits the task.
6. If no action is needed, respond with plain text only — no JSON.
7. When resolving special folders (Desktop, Documents, Pictures), always use getSpecialFolder instead of constructing paths manually.
`.trim();

/**
 * Main entry point for processing a user message.
 */
export async function handleUserMessage(prompt: string, llmContext: LLMContext, modelKey?: string): Promise<ExecutorResult> {
  const finalContext: LLMContext = {
    ...llmContext,
    systemPrompt: llmContext.systemPrompt
      ? `${llmContext.systemPrompt}\n\n${SYSTEM_PROMPT_INJECTION}`
      : SYSTEM_PROMPT_INJECTION
  };

  const workingHistory = [...(finalContext.history || [])];
  let currentPrompt = prompt;
  const MAX_CHAIN = 5;

  for (let i = 0; i < MAX_CHAIN; i++) {
    const llmRes = await generateContent(currentPrompt, { ...finalContext, history: workingHistory }, modelKey);

    if (llmRes.needsFallbackConfirmation) {
      return { type: 'fallback_required' };
    }

    const responseText = llmRes.text || '';
    const actionRequest = parseLLMResponse(responseText);

    if (!actionRequest) {
      return { type: 'text', text: responseText, usage: llmRes.usage };
    }

    if (classifyAction(actionRequest.action) === 'destructive') {
      return { type: 'action_pending', pendingAction: actionRequest };
    }

    try {
      const result = await executeAction(actionRequest.action, actionRequest.args);
      const resultStr = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
      workingHistory.push({ role: 'user', content: currentPrompt });
      workingHistory.push({ role: 'model', content: responseText });
      currentPrompt = `Action result for ${actionRequest.action}: ${resultStr}`;
    } catch (error) {
      return {
        type: 'action_executed',
        text: `Failed to execute action: ${actionRequest.action}`,
        actionResult: error instanceof Error ? error.message : String(error)
      };
    }
  }

  return { type: 'text', text: 'Maximum action chain length reached without a final response.' };
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
    case 'getHostname':
      return system.getHostname();
    case 'getUsername':
      return system.getUsername();
    case 'getEnvVar':
      return system.getEnvVar(requireString('name', args.name));
    case 'getOSInfo':
      return system.getOSInfo();
    case 'getSpecialFolder':
      return await system.getSpecialFolder(requireString('folder', args.folder));
    case 'execCommand':
      return await system.execCommand(requireString('cmd', args.cmd));
    case 'unlockLaptop':
      return await system.unlockLaptop();
    default:
      throw new Error(`Unknown action: ${actionName}`);
  }
}

export function classifyAction(actionName: string): 'readOnly' | 'safe' | 'destructive' {
  const readOnlyActions = ['getHostname', 'getUsername', 'getEnvVar', 'getOSInfo', 'getSpecialFolder'];
  const destructiveActions = [
    'writeFile', 'deleteFile', 'restartIIS', 'restartNodeRed',
    'sendEmail', 'execCommand', 'unlockLaptop'
  ];
  if (readOnlyActions.includes(actionName)) return 'readOnly';
  if (destructiveActions.includes(actionName)) return 'destructive';
  return 'safe';
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
