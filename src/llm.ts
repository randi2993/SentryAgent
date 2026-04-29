export interface ModelProviderConfig {
    provider: 'gemini' | 'anthropic' | 'ollama';
    model: string;
    temperature: number;
    maxOutputTokens: number;
    endpoint?: string;
}

export interface LLMConfig {
    default: string;
    fallbackModel: string;
    fallbackBehavior: 'ask' | 'fail';
    providers: Record<string, ModelProviderConfig>;
}

export interface Message {
    role: 'user' | 'model';
    content: string;
}

export interface LLMContext {
    config: LLMConfig;
    systemPrompt?: string;
    history?: Message[];
}

export interface LLMResult {
    text?: string;
    needsFallbackConfirmation?: boolean;
}

// Strict response typings to avoid 'any'
interface GeminiResponse {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

interface AnthropicResponse {
    content?: Array<{ text?: string }>;
}

interface OllamaResponse {
    message?: { content?: string };
}

/**
 * Generates content using the configured LLM provider (Gemini, Anthropic, or Ollama).
 * Exposes a single unified interface that handles API key loading, payload formatting,
 * and fallback behaviors as requested by the architecture.
 */
export async function generateContent(prompt: string, context: LLMContext, modelKey?: string): Promise<LLMResult> {
    const { config } = context;
    const activeKey = modelKey || config.default;
    let providerConfig = config.providers[activeKey];

    if (!providerConfig) {
        console.error(`Model key '${activeKey}' not found in config. Using default.`);
        providerConfig = config.providers[config.default];
        if (!providerConfig) {
            throw new Error(`Default model '${config.default}' not found in config.`);
        }
    }

    // Inject ACTIVE_MODEL into system prompt to prevent the model from misidentifying itself
    const baseSystemPrompt = context.systemPrompt || '';
    const injectedSystemPrompt = `${baseSystemPrompt}\n\nACTIVE_MODEL: ${providerConfig.model} (${providerConfig.provider})`.trim();

    try {
        if (providerConfig.provider === 'gemini') {
            return await callGemini(prompt, injectedSystemPrompt, context.history, providerConfig);
        } else if (providerConfig.provider === 'anthropic') {
            return await callAnthropic(prompt, injectedSystemPrompt, context.history, providerConfig);
        } else if (providerConfig.provider === 'ollama') {
            return await callOllama(prompt, injectedSystemPrompt, context.history, providerConfig);
        } else {
            // TypeScript correctly infers this is unreachable under normal config,
            // but we add a generic throw to satisfy runtime safety
            throw new Error(`Unsupported provider configured`);
        }
    } catch (error) {
        console.error(`LLM Error (${activeKey}):`, error);

        if (config.fallbackBehavior === 'ask') {
            return { needsFallbackConfirmation: true };
        } else {
            throw new Error(`LLM call failed and fallback behavior is 'fail': ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

async function callGemini(prompt: string, systemPrompt: string, history: Message[] | undefined, providerConfig: ModelProviderConfig): Promise<LLMResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${providerConfig.model}:generateContent?key=${apiKey}`;

    const contents = [];
    if (history) {
        for (const msg of history) {
            contents.push({ role: msg.role, parts: [{ text: msg.content }] });
        }
    }
    contents.push({ role: 'user', parts: [{ text: prompt }] });

    const payload = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
            temperature: providerConfig.temperature,
            maxOutputTokens: providerConfig.maxOutputTokens
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Gemini API Error: ${res.status} ${errorText}`);
    }

    const data = (await res.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { text };
}

async function callAnthropic(prompt: string, systemPrompt: string, history: Message[] | undefined, providerConfig: ModelProviderConfig): Promise<LLMResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

    const url = 'https://api.anthropic.com/v1/messages';

    const messages = [];
    if (history) {
        for (const msg of history) {
            messages.push({ role: msg.role === 'model' ? 'assistant' : msg.role, content: msg.content });
        }
    }
    messages.push({ role: 'user', content: prompt });

    const payload = {
        model: providerConfig.model,
        system: systemPrompt,
        messages,
        temperature: providerConfig.temperature,
        max_tokens: providerConfig.maxOutputTokens
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Anthropic API Error: ${res.status} ${errorText}`);
    }

    const data = (await res.json()) as AnthropicResponse;
    const text = data.content?.[0]?.text || '';
    return { text };
}

async function callOllama(prompt: string, systemPrompt: string, history: Message[] | undefined, providerConfig: ModelProviderConfig): Promise<LLMResult> {
    const endpoint = providerConfig.endpoint || 'http://localhost:11434';
    const url = `${endpoint}/api/chat`;

    const messages = [];
    if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
    }
    if (history) {
        for (const msg of history) {
            messages.push({ role: msg.role === 'model' ? 'assistant' : msg.role, content: msg.content });
        }
    }
    messages.push({ role: 'user', content: prompt });

    const payload = {
        model: providerConfig.model,
        messages,
        stream: false,
        options: {
            temperature: providerConfig.temperature,
            num_predict: providerConfig.maxOutputTokens
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Ollama API Error: ${res.status} ${errorText}`);
    }

    const data = (await res.json()) as OllamaResponse;
    const text = data.message?.content || '';
    return { text };
}
