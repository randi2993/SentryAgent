import { readFile } from 'fs/promises';
import { join } from 'path';
import { startBot } from './telegram.js';
import { LLMConfig } from './llm.js';

/**
 * Bootstrap file for SentryAgent.
 * Loads the LLM configuration from the filesystem and initializes the Telegram bot.
 * Environment variables are loaded natively via Node's --env-file flag.
 */
async function bootstrap() {
  try {
    console.log('Starting SentryAgent bootstrap process...');

    // 1. Read config/llm-config.json once at startup
    const configPath = join(process.cwd(), 'config', 'llm-config.json');
    const configRaw = await readFile(configPath, 'utf-8');
    const llmConfig = JSON.parse(configRaw) as LLMConfig;

    console.log('✅ LLM configuration loaded successfully.');

    // 2. Initialize telegram.ts with the loaded configuration
    await startBot(llmConfig);

  } catch (error) {
    console.error('❌ Failed to bootstrap SentryAgent:', error);
    process.exit(1);
  }
}

bootstrap();
