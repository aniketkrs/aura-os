import * as dotenv from 'dotenv';
import * as path from 'path';
import { execSync } from 'child_process';
// Load .env from project root regardless of cwd
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

import { T, Sym } from '../tui/theme';

export type ModelProvider = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'mistral';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMConfig {
  provider: ModelProvider;
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

// Default routing logic by task complexity
const DEFAULTS: Record<string, LLMConfig> = {
  fast: { provider: 'ollama', model: 'llama3.2:3b', maxTokens: 512 },
  smart: { provider: 'openai', model: 'gpt-4o-mini', maxTokens: 2048 },
  deep: { provider: 'anthropic', model: 'claude-opus-4-5', maxTokens: 4096 },
  local: { provider: 'ollama', model: 'llama3.1:8b', maxTokens: 2048 },
};

let activeConfig: LLMConfig = {
  provider: 'gemini',
  model: 'gemini-2.0-flash',
  maxTokens: 2048,
  temperature: 0.7,
};

export function setModel(provider: ModelProvider, model: string): void {
  activeConfig = { ...activeConfig, provider, model };
}

export function setSystemPrompt(prompt: string): void {
  activeConfig.systemPrompt = prompt;
}

export function getActiveModel(): LLMConfig {
  return activeConfig;
}

export function listModels(): Array<{ name: string; provider: string; model: string }> {
  return [
    // ── Anthropic ──────────────────────────────────────────────────────────
    { name: 'claude-opus', provider: 'anthropic', model: 'claude-opus-4-5' },
    { name: 'claude-sonnet', provider: 'anthropic', model: 'claude-sonnet-4-5' },
    { name: 'claude-haiku', provider: 'anthropic', model: 'claude-haiku-4-5' },
    // ── OpenAI ────────────────────────────────────────────────────────────
    { name: 'gpt-4o', provider: 'openai', model: 'gpt-4o' },
    { name: 'gpt-4o-mini', provider: 'openai', model: 'gpt-4o-mini' },
    { name: 'gpt-4.5', provider: 'openai', model: 'gpt-4.5-preview' },
    { name: 'o3', provider: 'openai', model: 'o3' },
    // ── Google Gemini ─────────────────────────────────────────────────────
    // Flash first: free-tier quota available; auto-fallback always picks first
    { name: 'gemini-flash', provider: 'gemini', model: 'gemini-2.0-flash' },
    { name: 'gemini-flash-lite', provider: 'gemini', model: 'gemini-2.0-flash-lite' },
    { name: 'gemini-2.5-flash', provider: 'gemini', model: 'gemini-2.5-flash' },
    // Pro models below — require paid plan
    { name: 'gemini-2.5-pro', provider: 'gemini', model: 'gemini-2.5-pro' },
    { name: 'gemini-3-pro', provider: 'gemini', model: 'gemini-3-pro-preview' },
    { name: 'gemini-3.1-pro', provider: 'gemini', model: 'gemini-3.1-pro-preview' },
    // ── Mistral ───────────────────────────────────────────────────────────
    { name: 'mistral-large', provider: 'mistral', model: 'mistral-large-latest' },
    { name: 'mistral-medium', provider: 'mistral', model: 'mistral-medium-latest' },
    { name: 'mistral-small', provider: 'mistral', model: 'mistral-small-latest' },
    // ── Local (Ollama) ────────────────────────────────────────────────────
    { name: 'llama3-8b', provider: 'ollama', model: 'llama3.1:8b' },
    { name: 'llama3-3b', provider: 'ollama', model: 'llama3.2:3b' },
  ];
}

// ─── Ollama Detection & Management ───────────────────────────────────────────

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  version?: string;
}

export interface OllamaModel {
  name: string;
  size: string;
  modified: string;
  parameterSize?: string;
}

export async function checkOllamaInstalled(): Promise<OllamaStatus> {
  let installed = false;
  try {
    execSync('command -v ollama', { stdio: 'ignore' });
    installed = true;
  } catch { /* not installed */ }

  let running = false;
  let version: string | undefined;
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  try {
    const fetch = (await import('node-fetch')).default;
    const resp = await fetch(`${baseUrl}/api/version`, { timeout: 3000 } as any);
    if (resp.ok) {
      running = true;
      const data = await resp.json() as { version?: string };
      version = data.version;
    }
  } catch { /* not running */ }

  return { installed, running, version };
}

export async function listOllamaModels(): Promise<OllamaModel[]> {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const fetch = (await import('node-fetch')).default;
  const resp = await fetch(`${baseUrl}/api/tags`, { timeout: 5000 } as any);
  if (!resp.ok) throw new Error(`Ollama error: ${resp.statusText}`);

  const data = await resp.json() as {
    models?: Array<{
      name: string;
      size: number;
      modified_at: string;
      details?: { parameter_size?: string };
    }>;
  };

  return (data.models || []).map(m => ({
    name: m.name,
    size: formatBytes(m.size),
    modified: new Date(m.modified_at).toLocaleDateString(),
    parameterSize: m.details?.parameter_size,
  }));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export async function pullOllamaModel(
  modelName: string,
  onProgress?: (status: string, completed?: number, total?: number) => void,
): Promise<void> {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const fetch = (await import('node-fetch')).default;
  const resp = await fetch(`${baseUrl}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName, stream: true }),
  });

  if (!resp.ok) throw new Error(`Ollama pull error: ${resp.statusText}`);
  if (!resp.body) throw new Error('No response body from Ollama');

  // Stream the NDJSON response
  const body = resp.body as NodeJS.ReadableStream;
  let buffer = '';
  for await (const chunk of body) {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line) as {
          status?: string;
          completed?: number;
          total?: number;
          error?: string;
        };
        if (data.error) throw new Error(data.error);
        if (onProgress) onProgress(data.status || '', data.completed, data.total);
      } catch (e) {
        if ((e as Error).message && !(e as Error).message.includes('JSON'))
          throw e;
      }
    }
  }
}

export function getOllamaInstallGuide(): string {
  return [
    '',
    `  ${T.auraBold('Install Ollama')}`,
    `  ${T.dim('─'.repeat(50))}`,
    '',
    `  ${T.solar('Option 1:')} ${T.white('Homebrew (recommended for macOS)')}`,
    `  ${T.muted('$')} ${T.ice('brew install ollama')}`,
    '',
    `  ${T.solar('Option 2:')} ${T.white('Official installer')}`,
    `  ${T.muted('$')} ${T.ice('curl -fsSL https://ollama.com/install.sh | sh')}`,
    '',
    `  ${T.auraBold('After installing:')}`,
    `  ${T.dim('─'.repeat(50))}`,
    '',
    `  ${T.muted('1.')} Start the Ollama server:`,
    `     ${T.muted('$')} ${T.ice('ollama serve')}`,
    '',
    `  ${T.muted('2.')} Pull a model:`,
    `     ${T.muted('$')} ${T.ice('ollama pull llama3.2:3b')}    ${T.muted('(small, fast — 2GB)')}`,
    `     ${T.muted('$')} ${T.ice('ollama pull llama3.1:8b')}    ${T.muted('(larger, smarter — 4.7GB)')}`,
    '',
    `  ${T.muted('3.')} Then in Aura OS:`,
    `     ${T.aura('/ollama status')}   ${T.muted('— verify connection')}`,
    `     ${T.aura('/ollama models')}   ${T.muted('— list local models')}`,
    `     ${T.aura('/model llama3-3b')} ${T.muted('— switch to local model')}`,
    '',
  ].join('\n');
}

// ─── Anthropic ────────────────────────────────────────────────────────────────
async function callAnthropic(messages: Message[], config: LLMConfig): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const sysMessages = messages.filter(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');
  const system = config.systemPrompt || sysMessages.map(m => m.content).join('\n') || undefined;

  const resp = await client.messages.create({
    model: config.model,
    max_tokens: config.maxTokens || 2048,
    system,
    messages: chatMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  });

  return (resp.content[0] as { type: string; text: string }).text || '';
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────
async function callOpenAI(messages: Message[], config: LLMConfig): Promise<string> {
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const allMessages: Array<{ role: string; content: string }> = [];
  if (config.systemPrompt) allMessages.push({ role: 'system', content: config.systemPrompt });
  allMessages.push(...messages.map(m => ({ role: m.role, content: m.content })));

  const resp = await client.chat.completions.create({
    model: config.model,
    max_tokens: config.maxTokens || 2048,
    temperature: config.temperature ?? 0.7,
    messages: allMessages as Parameters<typeof client.chat.completions.create>[0]['messages'],
  });

  return resp.choices[0]?.message?.content || '';
}

// ─── Ollama ───────────────────────────────────────────────────────────────────
async function callOllama(messages: Message[], config: LLMConfig): Promise<string> {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const payload = {
    model: config.model,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    stream: false,
    options: { num_predict: config.maxTokens || 2048 },
  };

  const fetch = (await import('node-fetch')).default;
  const resp = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) throw new Error(`Ollama error: ${resp.statusText}`);
  const data = await resp.json() as { message?: { content: string } };
  return data.message?.content || '';
}

// ─── Gemini ───────────────────────────────────────────────────────────────────
async function callGemini(messages: Message[], config: LLMConfig): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const fetch = (await import('node-fetch')).default;
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Gemini error (${resp.status}): ${body || resp.statusText}`);
  }
  const data = await resp.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ─── Mistral ──────────────────────────────────────────────────────────────────
async function callMistral(messages: Message[], config: LLMConfig): Promise<string> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error('MISTRAL_API_KEY not set');

  const fetch = (await import('node-fetch')).default;
  const allMessages: Array<{ role: string; content: string }> = [];
  if (config.systemPrompt) allMessages.push({ role: 'system', content: config.systemPrompt });
  allMessages.push(...messages.map(m => ({ role: m.role, content: m.content })));

  const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens || 2048,
      temperature: config.temperature ?? 0.7,
      messages: allMessages,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Mistral error (${resp.status}): ${body || resp.statusText}`);
  }
  const data = await resp.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content || '';
}

// ─── Error classification ─────────────────────────────────────────────────────

export function isQuotaOrRateLimitError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes('credit balance') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('too many requests') ||
    msg.includes('insufficient_quota') ||
    msg.includes('billing') ||
    msg.includes('exceeded') ||
    msg.includes('payment required') ||
    msg.includes('402') ||
    (msg.includes('429'))
  );
}

export function isAuthError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes('401') ||
    msg.includes('authentication') ||
    msg.includes('api_key') ||
    msg.includes('invalid x-api-key') ||
    msg.includes('unauthorized') ||
    msg.includes('invalid_api_key')
  );
}

export function getAvailableProviders(): Array<{ provider: string; hasKey: boolean; models: string[] }> {
  const keyMap: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
    mistral: 'MISTRAL_API_KEY',
  };
  const allModels = listModels();
  const providers: Array<{ provider: string; hasKey: boolean; models: string[] }> = [];

  for (const [prov, envKey] of Object.entries(keyMap)) {
    providers.push({
      provider: prov,
      hasKey: !!process.env[envKey],
      models: allModels.filter(m => m.provider === prov).map(m => m.name),
    });
  }
  // Ollama — no key needed, just needs to be running
  providers.push({
    provider: 'ollama',
    hasKey: true, // always "available" if running
    models: allModels.filter(m => m.provider === 'ollama').map(m => m.name),
  });
  return providers;
}

// ─── Short error extraction ───────────────────────────────────────────────────
export function shortError(err: unknown): string {
  const raw = String(err);
  // Try to extract the "message" field from JSON error bodies
  const msgMatch = raw.match(/"message"\s*:\s*"([^"]+)"/);
  if (msgMatch) {
    const msg = msgMatch[1];
    // Cut at first newline or quota detail
    return msg.split('\\n')[0].split('\n')[0].substring(0, 120);
  }
  // Fallback: first line, capped
  return raw.split('\n')[0].substring(0, 120);
}

// ─── Main router ──────────────────────────────────────────────────────────────

type ProviderCallFn = (messages: Message[], config: LLMConfig) => Promise<string>;
const providerCallMap: Record<string, ProviderCallFn> = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  ollama: callOllama,
  gemini: callGemini,
  mistral: callMistral,
};

export async function chat(messages: Message[], config?: Partial<LLMConfig>): Promise<string> {
  const cfg = { ...activeConfig, ...config };

  // ── Try primary model ──────────────────────────────────────────────────────
  try {
    const callFn = providerCallMap[cfg.provider];
    if (!callFn) throw new Error(`Unknown provider: ${cfg.provider}`);
    return await callFn(messages, cfg);
  } catch (primaryErr) {
    const isQuotaErr = isQuotaOrRateLimitError(primaryErr);
    if (!isQuotaErr) throw primaryErr; // not a quota error — just throw

    console.log(`\n  ${T.solar(Sym.warn)} ${T.solarB(cfg.provider + '/' + cfg.model)} — ${T.muted(shortError(primaryErr))}`);

    // ── Try other models within SAME provider first ────────────────────────
    if (cfg.provider !== 'ollama') {
      const sameProvModels = listModels().filter(
        m => m.provider === cfg.provider && m.model !== cfg.model
      );
      for (const alt of sameProvModels) {
        try {
          console.log(`  ${T.muted('  trying')} ${T.white(alt.model)}${T.muted('...')}`);
          const callFn = providerCallMap[cfg.provider];
          if (!callFn) break;
          const result = await callFn(messages, { ...cfg, model: alt.model });
          setModel(cfg.provider, alt.model);
          console.log(`  ${T.aurora(Sym.check)} ${T.muted('Auto-switched to')} ${T.white(cfg.provider + '/' + alt.model)}\n`);
          return result;
        } catch { /* this model also failed, try next */ }
      }
    }

    // ── Try other cloud providers (all their models) ───────────────────────
    const keyMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      gemini: 'GEMINI_API_KEY',
      mistral: 'MISTRAL_API_KEY',
    };
    for (const [prov, envKey] of Object.entries(keyMap)) {
      if (prov === cfg.provider) continue;
      if (!process.env[envKey]) continue;
      const provModels = listModels().filter(m => m.provider === prov);
      for (const fb of provModels) {
        try {
          console.log(`  ${T.muted('  trying')} ${T.white(prov + '/' + fb.model)}${T.muted('...')}`);
          const callFn = providerCallMap[prov];
          if (!callFn) break;
          const result = await callFn(messages, { ...cfg, provider: prov as ModelProvider, model: fb.model });
          setModel(prov as ModelProvider, fb.model);
          console.log(`  ${T.aurora(Sym.check)} ${T.muted('Auto-switched to')} ${T.white(prov + '/' + fb.model)}\n`);
          return result;
        } catch { /* try next model/provider */ }
      }
    }

    // ── Last resort: Ollama ────────────────────────────────────────────────
    if (cfg.provider !== 'ollama') {
      try {
        const status = await checkOllamaInstalled();
        if (status.running) {
          let fallbackModel = 'llama3.2:3b';
          try {
            const models = await listOllamaModels();
            if (models.length > 0) fallbackModel = models[0].name;
          } catch { /* use default */ }
          console.log(`  ${T.muted('  trying')} ${T.white('ollama/' + fallbackModel)}${T.muted('...')}`);
          const result = await callOllama(messages, { ...cfg, provider: 'ollama', model: fallbackModel });
          setModel('ollama' as ModelProvider, fallbackModel);
          console.log(`  ${T.aurora(Sym.check)} ${T.muted('Auto-switched to')} ${T.white('ollama/' + fallbackModel)}\n`);
          return result;
        }
      } catch { /* Ollama not available either */ }
    }

    // ── Nothing worked ────────────────────────────────────────────────────
    throw primaryErr;
  }
}

export async function quickChat(userMsg: string, systemPrompt?: string): Promise<string> {
  const messages: Message[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userMsg });
  return chat(messages);
}
