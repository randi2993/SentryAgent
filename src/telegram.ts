import { Telegraf, Context } from 'telegraf';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { handleUserMessage, executeAction, ActionRequest } from './executor.js';
import { LLMConfig, LLMContext, Message } from './llm.js';

interface ThreadConfig {
  name?: string;
  model: string;
  createdAt: string;
}

interface ChatConfig {
  chatId: string;
  defaultModel: string;
  threads: Record<string, ThreadConfig>;
}

const pendingActions = new Map<string, ActionRequest>();
const conversationHistory = new Map<string, Message[]>();
const CHATS_DIR = join(process.cwd(), 'config', 'chats');

function formatTokenCount(count: number): string {
  if (count < 1000) {
    return String(count);
  }
  if (count < 1000000) {
    const k = count / 1000;
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
  }
  const m = count / 1000000;
  return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
}

async function getChatConfig(chatId: string, defaultConfig: LLMConfig): Promise<ChatConfig> {
  const filePath = join(CHATS_DIR, `${chatId}.json`);
  if (existsSync(filePath)) {
    const data = await readFile(filePath, 'utf-8');
    return JSON.parse(data) as ChatConfig;
  }
  return {
    chatId,
    defaultModel: defaultConfig.default,
    threads: {}
  };
}

async function saveChatConfig(chatId: string, config: ChatConfig): Promise<void> {
  if (!existsSync(CHATS_DIR)) {
    await mkdir(CHATS_DIR, { recursive: true });
  }
  const filePath = join(CHATS_DIR, `${chatId}.json`);
  await writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

export async function startBot(llmConfig: LLMConfig) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables');

  const allowedChatIdStr = process.env.ALLOWED_CHAT_ID;
  if (!allowedChatIdStr) throw new Error('ALLOWED_CHAT_ID is not set in environment variables');
  const allowedChatIds = allowedChatIdStr.split(',').map(s => s.trim());

  const bot = new Telegraf(token);

  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id.toString();
    if (chatId && allowedChatIds.includes(chatId)) {
      return next();
    }
    // Message from non-whitelisted chat is silently dropped for security
  });

  // Load static context loaded at runtime
  let agentContext = '';
  try {
    agentContext = await readFile(join(process.cwd(), '.agent', 'agent.md'), 'utf-8');
  } catch (error) {
    console.log('.agent/agent.md not found or unreadable (optional), continuing without it');
  }

  // Core message processing logic (used for both normal text and fallback retries)
  async function processUserMessage(ctx: Context, text: string, threadId: string, fallbackModel?: string) {
    if (!ctx.chat) return;

    const chatId = ctx.chat.id.toString();
    const chatConf = await getChatConfig(chatId, llmConfig);

    // Register thread if new and not root
    if (!chatConf.threads[threadId] && threadId !== 'root') {
      chatConf.threads[threadId] = {
        model: chatConf.defaultModel,
        createdAt: new Date().toISOString()
      };
      await saveChatConfig(chatId, chatConf);
    }

    const activeModel = fallbackModel || chatConf.threads[threadId]?.model || chatConf.defaultModel;

    // Load conversation history
    const histKey = `${chatId}_${threadId}`;
    if (!conversationHistory.has(histKey)) {
      conversationHistory.set(histKey, []);
    }
    const history = conversationHistory.get(histKey)!;

    const context: LLMContext = {
      config: llmConfig,
      systemPrompt: agentContext,
      history: history.slice(-10) // Keep the last 10 messages for context
    };

    if ('sendChatAction' in ctx) {
      await ctx.sendChatAction('typing').catch(() => { });
    }

    try {
      const result = await handleUserMessage(text, context, activeModel);

      // Only push user message if it's the original call, not a fallback call (avoid duplicate history)
      if (!fallbackModel) {
        history.push({ role: 'user', content: text });
      }

      if (result.type === 'fallback_required') {
        const actionId = `${chatId}_${Date.now()}_fallback`;
        pendingActions.set(actionId, { action: 'USE_FALLBACK', args: { prompt: text } });

        await ctx.reply(`⚠️ Model **${activeModel}** is currently unavailable.\nWould you like to try again using the fallback model (**${llmConfig.fallbackModel}**)?`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Yes, use fallback', callback_data: `fallback:confirm:${actionId}` },
              { text: '❌ No', callback_data: `fallback:cancel:${actionId}` }
            ]]
          }
        });
        return;
      }

      if (result.type === 'action_pending' && result.pendingAction) {
        const actionId = `${chatId}_${Date.now()}`;
        pendingActions.set(actionId, result.pendingAction);

        const actionText = `⚠️ Destructive action requested: **${result.pendingAction.action}**\n\nArguments:\n\`\`\`json\n${JSON.stringify(result.pendingAction.args, null, 2)}\n\`\`\`\n\nDo you want to proceed?`;

        await ctx.reply(actionText, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Confirm', callback_data: `action:confirm:${actionId}` },
              { text: '❌ Cancel', callback_data: `action:cancel:${actionId}` }
            ]]
          }
        });
        return;
      }

      if (result.type === 'action_executed') {
        await ctx.reply(`${result.text}\n\`\`\`\n${result.actionResult}\n\`\`\``, { parse_mode: 'Markdown' });
        return;
      }

      if (result.type === 'text' && result.text) {
        history.push({ role: 'model', content: result.text });

        let messageText = result.text;
        if (result.usage) {
          const inTokens = formatTokenCount(result.usage.promptTokens);
          const outTokens = formatTokenCount(result.usage.completionTokens);
          messageText += ` (↑${inTokens} ↓${outTokens} tk)`;
        }

        await ctx.reply(messageText);
        return;
      }

    } catch (error) {
      console.error('Error handling user message:', error);
      await ctx.reply(`An error occurred: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // System commands
  bot.command('start', async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const config = await getChatConfig(chatId, llmConfig);
    await ctx.reply(`Hello! SentryAgent is online.\nCurrent default model: ${config.defaultModel}`);
  });

  bot.command('status', async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const threadId = ctx.message && 'message_thread_id' in ctx.message && ctx.message.message_thread_id != null
      ? ctx.message.message_thread_id.toString()
      : 'root';
    const chatConf = await getChatConfig(chatId, llmConfig);
    const activeModel = chatConf.threads[threadId]?.model || chatConf.defaultModel;

    let text = `SentryAgent Status:\n`;
    text += `- Active Model: ${activeModel}\n`;
    text += `- Fallback Behavior: ${llmConfig.fallbackBehavior}\n`;
    text += `- Providers Loaded: ${Object.keys(llmConfig.providers).join(', ')}\n`;
    await ctx.reply(text);
  });

  bot.command('model', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const chatId = ctx.chat.id.toString();
    const threadId = ctx.message && 'message_thread_id' in ctx.message && ctx.message.message_thread_id != null
      ? ctx.message.message_thread_id.toString()
      : 'root';
    const chatConf = await getChatConfig(chatId, llmConfig);

    if (args.length === 0) {
      const activeModel = chatConf.threads[threadId]?.model || chatConf.defaultModel;
      let text = `Active model for this thread: ${activeModel}\n\nAvailable models:\n`;
      for (const [key, details] of Object.entries(llmConfig.providers)) {
        text += `- ${key} (${details.provider})\n`;
      }
      text += `\nUse /model <key> to change.`;
      return ctx.reply(text);
    }

    const newModel = args[0];
    if (newModel === 'default') {
      if (chatConf.threads[threadId]) {
        delete chatConf.threads[threadId];
        await saveChatConfig(chatId, chatConf);
      }
      return ctx.reply(`Thread reset to chat default model: ${chatConf.defaultModel}`);
    }

    if (!llmConfig.providers[newModel]) {
      return ctx.reply(`Unknown model key: ${newModel}`);
    }

    chatConf.threads[threadId] = {
      model: newModel,
      createdAt: chatConf.threads[threadId]?.createdAt || new Date().toISOString()
    };
    await saveChatConfig(chatId, chatConf);
    await ctx.reply(`Model for this thread set to: ${newModel}`);
  });

  // Callbacks for HITL (actions and fallbacks)
  bot.on('callback_query', async (ctx) => {
    if (!('data' in ctx.callbackQuery) || !ctx.callbackQuery.data) return;
    const data = ctx.callbackQuery.data;

    const parts = data.split(':');

    // Handle destructive action confirmation
    if (parts[0] === 'action') {
      const decision = parts[1];
      const actionId = parts[2];

      const action = pendingActions.get(actionId);
      if (!action) {
        await ctx.answerCbQuery('Action expired or not found.');
        return;
      }

      if (decision === 'cancel') {
        pendingActions.delete(actionId);
        await ctx.editMessageText('❌ Action cancelled.');
        await ctx.answerCbQuery();
        return;
      }

      if (decision === 'confirm') {
        pendingActions.delete(actionId);
        await ctx.editMessageText(`✅ Executing ${action.action}...`);

        try {
          const result = await executeAction(action.action, action.args);
          const resultStr = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
          await ctx.reply(`Result of ${action.action}:\n\`\`\`\n${resultStr}\n\`\`\``, { parse_mode: 'Markdown' });
        } catch (error) {
          await ctx.reply(`Failed to execute ${action.action}:\n${error instanceof Error ? error.message : String(error)}`);
        }
        await ctx.answerCbQuery();
      }
    }
    // Handle fallback model confirmation
    else if (parts[0] === 'fallback') {
      const decision = parts[1];
      const actionId = parts[2];

      const action = pendingActions.get(actionId);
      if (!action) {
        await ctx.answerCbQuery('Fallback request expired.');
        return;
      }

      if (decision === 'cancel') {
        pendingActions.delete(actionId);
        await ctx.editMessageText('❌ Fallback cancelled.');
        await ctx.answerCbQuery();
        return;
      }

      if (decision === 'confirm') {
        pendingActions.delete(actionId);
        await ctx.editMessageText(`✅ Retrying with fallback model: ${llmConfig.fallbackModel}`);

        const prompt = String(action.args?.prompt || '');
        const msg = ctx.callbackQuery.message;
        const threadId = msg && 'message_thread_id' in msg && msg.message_thread_id
          ? msg.message_thread_id.toString()
          : 'root';

        // Retry logic processing
        await processUserMessage(ctx, prompt, threadId, llmConfig.fallbackModel);
        await ctx.answerCbQuery();
      }
    }
  });

  // Standard text message handler
  bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return; // Ignore unhandled commands

    const threadIdStr = 'message_thread_id' in ctx.message && ctx.message.message_thread_id != null
      ? ctx.message.message_thread_id.toString()
      : 'root';

    await processUserMessage(ctx, text, threadIdStr);
  });

  try {
    console.log('Starting Telegram bot polling...');

    bot.launch(() => {
      console.log('✅ Bot is now listening for incoming messages');
    });

    console.log('✅ Bot launched, polling started');

  } catch (error) {
    console.error('❌ Failed to launch Telegram bot:', error);
    throw error;
  }

  // Graceful shutdown
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
