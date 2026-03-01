import * as readline from 'readline';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

import { T, Sym, divider, prompt as promptFn, Typing, boxLine, header } from './tui/theme';
import { dashboardScreen, helpScreen, printBanner, printHeader, clearScreen } from './tui/screens';
import { destroySession } from './security/session';
import { askHidden, changePin } from './security/auth';
import { loadProfile, saveProfile, getRoleContext, type UserProfile, type Role } from './data/profile';
import { getDefaultAgents } from './data/profile';
import {
  listTasks, addTask, updateTask, removeTask,
  type TaskStatus, type TaskPriority,
} from './data/tasks';
import { remember, recall, listMemory, clearMemory } from './data/memory';
import {
  startAgent, stopAgent, getAgentStatus, listRegistered, stopAllAgents, readAgentLog,
} from './agents/agent-manager';
import './agents/builtin-agents'; // register all built-in agents
import {
  chat, quickChat, setModel, getActiveModel, listModels,
  checkOllamaInstalled, listOllamaModels, pullOllamaModel, getOllamaInstallGuide,
  isQuotaOrRateLimitError, isAuthError, getAvailableProviders, shortError,
  type Message, type ModelProvider,
} from './tools/llm-router';
import { setSystemPrompt } from './tools/llm-router';
import { getProviderBadge, getAllProviderBadges } from './tui/provider-logos';
import {
  browse, search, googleSearch, renderBrowseResult,
  followLink, getHistory, clearHistory,
  addBookmark, removeBookmark, getBookmarks,
  createTab, closeTab, switchTab, getActiveTab, listTabs,
  type BrowseResult,
} from './tools/browser';
import {
  fetchInbox, sendEmail, formatEmailList, formatEmail,
  saveEmailConfig, loadEmailConfig, type EmailConfig,
} from './tools/email-client';
import { fetchGmailInbox, sendGmail, formatGmailList, formatGmailMessage, getGmailProfile } from './tools/gmail';
import { listDriveFiles, readDriveFile, formatDriveList } from './tools/gdrive';
import { runGoogleAuth, loadGoogleCreds, isGoogleAuthed, saveGoogleCreds, getOAuthClientCreds } from './tools/google-auth';
import { getUpcomingEvents, formatEvents } from './tools/calendar';
import { saveProfile as saveProfileFn } from './data/profile';
import { runApiKeySetup, showKeyStatus, injectKeysToEnv, saveKey, loadKeys } from './security/apikeys';
import './integrations/index'; // register all integrations
import {
  listIntegrations, getIntegration,
  loadIntegrationConfig, saveIntegrationConfig, deleteIntegrationConfig,
  isConnected,
} from './integrations/integration-manager';
import { fetchRepos, fetchIssues, fetchPRs } from './integrations/github';
import { renderImage, renderImageFromUrl, detectTerminalCapabilities } from './tools/image-renderer';
import { evaluateScript, type ScriptResult } from './tools/js-engine';
import { startMcpServer, stopMcpServer, getMcpServerStatus } from './mcp/aura-mcp-server';
import {
  addMcpServer, removeMcpServer, connectMcpServer, disconnectMcpServer,
  disconnectAll, listMcpConnectionsFull, listMcpTools, callMcpTool, autoConnectAll,
  type McpServerConfig,
} from './mcp/mcp-client-manager';
import {
  loadCustomAgents, saveCustomAgent, removeCustomAgent,
  registerCustomAgent, registerAllCustomAgents, buildAgentFromTemplate,
} from './agents/agent-builder';
import { getTemplates } from './agents/agent-templates';
import { detectIntent } from './tools/intent-router';
import { showAgentBanner, printAgentBanner, showBootGreeting } from './tui/agent-banner';

// ─── Chat history ──────────────────────────────────────────────────────────────
let chatHistory: Message[] = [];

// ─── Last browse result (for /click, /bookmark, /render img#) ─────────────────
let lastBrowseResult: BrowseResult | null = null;

// ─── Main shell ────────────────────────────────────────────────────────────────
export async function startInteractive(profile: UserProfile): Promise<void> {
  // Inject stored API keys (overrides .env if user set them via /apikey)
  await injectKeysToEnv();

  // Set LLM system context from role
  setSystemPrompt(`You are Aura, an intelligent terminal OS assistant.\n${getRoleContext(profile)}`);

  // Auto-start role-based agents
  const autoAgents = getDefaultAgents(profile.role);
  for (const agentName of autoAgents) startAgent(agentName);

  // Register custom agents from disk + auto-connect MCP servers
  await registerAllCustomAgents();
  await autoConnectAll();

  // Show dashboard
  const tasks = await listTasks();
  dashboardScreen(profile, tasks, getAgentStatus());

  // Aura greets the user first!
  await showBootGreeting(profile.name);

  // Start REPL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: promptFn(profile.role),
  });

  rl.prompt();

  rl.on('line', async (rawLine) => {
    const line = rawLine.trim();

    if (!line) {
      rl.prompt();
      return;
    }

    const [cmd, ...rest] = line.split(' ');
    const args = rest.join(' ').trim();

    // Commands that handle their own full-screen clear — skip the header for these
    const fullScreenCmds = ['/dash', '/dashboard', '/clear', '/cls', '/help', '/quit', '/exit', '/q', '/status', '/chat', '/c'];
    // /app connect and /mcp add run setup wizards — treat as full-screen so printHeader is skipped
    const isAppConnect = cmd.toLowerCase() === '/app' && args.split(' ')[0] === 'connect';
    const isMcpAdd = cmd.toLowerCase() === '/mcp' && args.split(' ')[0] === 'add';
    if (!fullScreenCmds.includes(cmd.toLowerCase()) && !isAppConnect && !isMcpAdd) {
      printHeader(profile);
    }

    try {
      await handleCommand(cmd, args, profile, rl);
    } catch (err) {
      console.log(`  ${T.nova(Sym.cross)} ${T.muted(String(err))}`);
    }

    rl.prompt();
  });

  rl.on('close', async () => {
    await handleQuit();
  });
}

// ─── Command router ────────────────────────────────────────────────────────────
async function handleCommand(
  cmd: string,
  args: string,
  profile: UserProfile,
  rl: readline.Interface,
): Promise<void> {
  switch (cmd.toLowerCase()) {

    // ── Navigation ────────────────────────────────────────────────────────────
    case '/dash':
    case '/dashboard': {
      const tasks = await listTasks();
      dashboardScreen(profile, tasks, getAgentStatus());
      break;
    }

    case '/clear':
    case '/cls': {
      clearScreen(profile);
      break;
    }

    case '/help': {
      helpScreen(profile);
      break;
    }

    case '/status': {
      await handleStatus(profile);
      break;
    }

    case '/quit':
    case '/exit':
    case '/q': {
      rl.close();
      await handleQuit();
      break;
    }

    // ── Chat ──────────────────────────────────────────────────────────────────
    case '/chat':
    case '/ask':
    case '/c': {
      if (!args) {
        await startChatSession(profile, rl);
      } else {
        await singleChat(args);
      }
      break;
    }

    case '/model': {
      if (!args) {
        const m = getActiveModel();
        console.log(`  ${T.muted('Active:')} ${getProviderBadge(m.provider)} ${T.white(m.model)}`);
      } else {
        let provider: string | undefined;
        let model: string | undefined;
        const [provStr, modelStr] = args.split('/');
        if (modelStr) {
          provider = provStr;
          model = modelStr;
        } else {
          const all = listModels();
          const match = all.find(m => m.name === args || m.model === args);
          if (match) {
            provider = match.provider;
            model = match.model;
          } else {
            console.log(`  ${T.nova('Unknown model.')} Use /models to list available models.`);
            break;
          }
        }
        // Validate provider has required config
        const keyMap: Record<string, string> = {
          anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', mistral: 'MISTRAL_API_KEY',
        };
        if (provider !== 'ollama' && keyMap[provider!] && !process.env[keyMap[provider!]]) {
          console.log(`  ${T.solar(Sym.warn)} No API key found for ${provider}. Set it with ${T.aura(`/apikey ${provider}`)}`);
        }
        if (provider === 'ollama') {
          const status = await checkOllamaInstalled();
          if (!status.running) {
            console.log(`  ${T.solar(Sym.warn)} Ollama is not running. Start it with ${T.ice('ollama serve')} or run ${T.aura('/ollama install')}`);
          }
        }
        setModel(provider as ModelProvider, model!);
        // Persist to profile
        const prof = await loadProfile();
        if (prof) {
          prof.preferences.defaultModel = model!;
          await saveProfileFn(prof);
        }
        console.log(`  ${T.aurora(Sym.check)} Model set to ${getProviderBadge(provider!)} ${T.white(model!)}`);
      }
      break;
    }

    case '/models': {
      console.log('');
      console.log(divider('AVAILABLE MODELS'));
      console.log(`  ${getAllProviderBadges()}`);
      console.log('');
      const active = getActiveModel();
      for (const m of listModels()) {
        const cur = m.model === active.model ? T.aurora(' ◄ active') : '';
        const badge = getProviderBadge(m.provider);
        console.log(`  ${T.aura(m.name.padEnd(16))} ${badge.padEnd(25)} ${T.white(m.model)}${cur}`);
      }
      console.log('');
      break;
    }

    // ── Ollama ─────────────────────────────────────────────────────────────────
    case '/ollama': {
      await handleOllama(args);
      break;
    }

    // ── Tasks ─────────────────────────────────────────────────────────────────
    case '/task': {
      await handleTask(args);
      break;
    }

    case '/tasks': {
      await handleTask('list');
      break;
    }

    // ── Email ─────────────────────────────────────────────────────────────────
    case '/mail':
    case '/email': {
      await handleMail(args, rl);
      break;
    }

    // ── Browser ───────────────────────────────────────────────────────────────
    case '/browse':
    case '/open': {
      if (!args) {
        console.log(`  ${T.muted('Usage: /browse <url>')}`);
        break;
      }
      const spin = new Typing(`Browsing ${args}...`).start();
      try {
        const result = await browse(args);
        lastBrowseResult = result;
        spin.stop();
        console.log('');
        console.log(divider(result.title.slice(0, 50)));
        console.log('');
        console.log(renderBrowseResult(result));
        if (result.links.length > 0) {
          console.log('');
          console.log(divider('LINKS'));
          for (const l of result.links.slice(0, 8)) {
            console.log(`  ${T.aura(String(l.n).padStart(2))}  ${T.white(l.text.slice(0, 50).padEnd(50))}  ${T.muted(l.href.slice(0, 55))}`);
          }
        }
        console.log('');
      } catch (err) {
        spin.stop(`  ${T.nova('Browse failed:')} ${String(err)}`);
      }
      break;
    }

    case '/search':
    case '/web': {
      if (!args) { console.log(`  ${T.muted('Usage: /search <query>')}`); break; }
      const spin = new Typing(`Searching: ${args}...`).start();
      try {
        const keys = await loadKeys();
        const gKey = keys.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY;
        const result = gKey ? await googleSearch(args, gKey) : await search(args);
        lastBrowseResult = result;
        spin.stop();
        console.log('');
        console.log(divider(result.title.slice(0, 60)));
        console.log('');
        console.log(renderBrowseResult(result));
        if (result.links.length) {
          console.log('');
          console.log(divider('LINKS'));
          for (const l of result.links.slice(0, 8)) {
            console.log(`  ${T.aura(String(l.n).padStart(2))}  ${T.white(l.text.slice(0, 50))}  ${T.muted(l.href.slice(0, 55))}`);
          }
        }
        console.log('');
      } catch (err) {
        spin.stop(`  ${T.nova('Search failed:')} ${String(err)}`);
      }
      break;
    }

    // ── Link follow ──────────────────────────────────────────────────────────
    case '/click':
    case '/follow': {
      if (!args || !lastBrowseResult) {
        console.log(`  ${T.muted(lastBrowseResult ? 'Usage: /click <link-number>' : 'Browse a page first with /browse <url>')}`);
        break;
      }
      const linkNum = parseInt(args);
      if (isNaN(linkNum)) { console.log(`  ${T.muted('Usage: /click <link-number>')}`); break; }
      const spinF = new Typing(`Following link #${linkNum}...`).start();
      try {
        const fResult = await followLink(lastBrowseResult, linkNum);
        lastBrowseResult = fResult;
        spinF.stop();
        console.log('');
        console.log(divider(fResult.title.slice(0, 50)));
        console.log('');
        console.log(renderBrowseResult(fResult));
        if (fResult.links.length > 0) {
          console.log('');
          console.log(divider('LINKS'));
          for (const l of fResult.links.slice(0, 8)) {
            console.log(`  ${T.aura(String(l.n).padStart(2))}  ${T.white(l.text.slice(0, 50).padEnd(50))}  ${T.muted(l.href.slice(0, 55))}`);
          }
        }
        console.log('');
      } catch (err) {
        spinF.stop(`  ${T.nova('Follow failed:')} ${String(err)}`);
      }
      break;
    }

    // ── Browser history ──────────────────────────────────────────────────────
    case '/history': {
      await handleHistory(args);
      break;
    }

    // ── Bookmarks ────────────────────────────────────────────────────────────
    case '/bookmark':
    case '/bm': {
      await handleBookmark(args);
      break;
    }

    // ── Tabs ─────────────────────────────────────────────────────────────────
    case '/tab': {
      await handleTab(args);
      break;
    }

    // ── Image rendering ──────────────────────────────────────────────────────
    case '/render':
    case '/img': {
      await handleRender(args);
      break;
    }

    // ── JavaScript sandbox ───────────────────────────────────────────────────
    case '/js':
    case '/eval': {
      await handleJs(args);
      break;
    }

    // ── Google Auth ───────────────────────────────────────────────────────────
    case '/google': {
      await handleGoogle(args, rl);
      break;
    }

    // ── Google Drive ──────────────────────────────────────────────────────────
    case '/drive': {
      await handleDrive(args);
      break;
    }

    // ── Agents ────────────────────────────────────────────────────────────────
    case '/agent': {
      await handleAgent(args, rl);
      break;
    }

    // ── MCP (Model Context Protocol) ─────────────────────────────────────────
    case '/mcp': {
      await handleMcp(args, rl);
      break;
    }

    // ── Calendar ──────────────────────────────────────────────────────────────
    case '/cal':
    case '/calendar': {
      const days = parseInt(args) || 7;
      const spin = new Typing('Loading calendar...').start();
      try {
        const events = await getUpcomingEvents(days);
        spin.stop();
        console.log('');
        console.log(divider(`UPCOMING EVENTS (${days} days)`));
        console.log(formatEvents(events));
        console.log('');
      } catch (err) {
        spin.stop(`  ${T.nova('Calendar error:')} ${String(err)}`);
      }
      break;
    }

    // ── Memory ────────────────────────────────────────────────────────────────
    case '/memory':
    case '/mem': {
      await handleMemory(args);
      break;
    }

    // ── Profile ───────────────────────────────────────────────────────────────
    case '/profile': {
      await handleProfile(args, profile);
      break;
    }

    // ── Log ───────────────────────────────────────────────────────────────────
    case '/log': {
      clearScreen(profile);
      console.log(divider('AGENT LOG'));
      const logLines = await readAgentLog(40);
      if (logLines.length === 0) {
        console.log(`  ${T.muted('No agent activity yet.')}`);
      } else {
        for (const line of logLines) {
          // Colour timestamp dim, agent name in aura, rest in muted
          const m = line.match(/^\[([^\]]+)\] \[([^\]]+)\] (.*)$/);
          if (m) {
            console.log(`  ${T.dim(m[1].slice(11, 19))}  ${T.aura(m[2].padEnd(20))}  ${T.muted(m[3])}`);
          } else {
            console.log(`  ${T.muted(line)}`);
          }
        }
      }
      console.log('');
      break;
    }

    // ── PIN change ────────────────────────────────────────────────────────────
    case '/pin': {
      const current = await askHidden(`  ${T.aura(Sym.key)} Current PIN: `);
      const newPin = await askHidden(`  ${T.aura(Sym.key)} New PIN: `);
      const confirm = await askHidden(`  ${T.aura(Sym.key)} Confirm new PIN: `);
      if (newPin !== confirm) {
        console.log(`  ${T.nova('PINs do not match.')}`);
        break;
      }
      const ok = await changePin(current, newPin);
      if (ok) {
        console.log(`  ${T.aurora(Sym.check)} PIN updated successfully.`);
      } else {
        console.log(`  ${T.nova('Incorrect current PIN.')}`);
      }
      break;
    }

    // ── API Keys ──────────────────────────────────────────────────────────────
    case '/apikey': {
      if (!args) {
        await showKeyStatus();
        console.log(`  ${T.muted('Usage:')} ${T.aura('/apikey anthropic')} ${T.muted('|')} ${T.aura('/apikey openai')} ${T.muted('|')} ${T.aura('/apikey gemini')} ${T.muted('|')} ${T.aura('/apikey google')}`);
      } else {
        const p = args.toLowerCase();
        if (p === 'google') {
          await handleGoogle('apikey', rl);
        } else if (['anthropic', 'openai', 'gemini', 'mistral'].includes(p)) {
          await runApiKeySetup(p as 'anthropic' | 'openai' | 'gemini' | 'mistral');
          // Re-inject immediately so the next chat call works
          await injectKeysToEnv();
        } else {
          console.log(`  ${T.muted('Providers:')} anthropic, openai, gemini, mistral, google`);
        }
      }
      break;
    }
    case '/keys': {
      await showKeyStatus();
      break;
    }

    // ── App integrations ──────────────────────────────────────────────────────
    case '/app': {
      await handleApp(args, rl);
      break;
    }

    // ── Unknown ───────────────────────────────────────────────────────────────
    default: {
      if (cmd.startsWith('/')) {
        console.log(`  ${T.nova(Sym.cross)} Unknown command: ${T.white(cmd)}`);
        console.log(`  ${T.muted('Type')} ${T.aura('/help')} ${T.muted('for available commands.')}`);
        break;
      }

      // Natural language intent detection — try to route before sending to LLM
      const fullInput = ([cmd, ...args.split(' ')]).join(' ').trim();
      const intent = detectIntent(fullInput);
      if (intent) {
        console.log(`  ${T.aurora(Sym.sparkle)} ${T.muted(intent.display)}`);
        await handleCommand(intent.command, intent.args, profile, rl);
        break;
      }

      // No intent matched — send to LLM as a regular chat message
      await singleChat(fullInput);
    }
  }
}

// ─── API key leak detector ──────────────────────────────────────────────────────
const API_KEY_PATTERNS = [
  /AIzaSy[A-Za-z0-9_-]{33}/,          // Google API keys
  /sk-[A-Za-z0-9]{20,}/,               // OpenAI keys
  /sk-ant-[A-Za-z0-9_-]{20,}/,         // Anthropic keys
  /key-[A-Za-z0-9]{20,}/,              // Generic API keys
  /ghp_[A-Za-z0-9]{36}/,               // GitHub PATs
  /glpat-[A-Za-z0-9_-]{20}/,           // GitLab PATs
  /xoxb-[A-Za-z0-9-]+/,               // Slack tokens
];

function containsApiKey(text: string): boolean {
  return API_KEY_PATTERNS.some(pattern => pattern.test(text));
}

// ─── Chat handlers ─────────────────────────────────────────────────────────────
async function singleChat(message: string): Promise<void> {
  // Guard: block API keys from being sent to cloud LLMs
  if (containsApiKey(message)) {
    console.log('');
    console.log(`  ${T.nova(Sym.cross)} ${T.nova('API KEY DETECTED in your message — blocked from sending.')}`);
    console.log(`  ${T.muted('Your key was NOT sent to any cloud service.')}`);
    console.log(`  ${T.muted('To set an API key securely, use:')} ${T.aura('/apikey gemini')} ${T.muted('or')} ${T.aura('/apikey openai')}`);
    console.log('');
    return;
  }

  chatHistory.push({ role: 'user', content: message });
  const spin = new Typing('Aura is thinking...').start();
  try {
    const reply = await chat(chatHistory);
    spin.stop();
    chatHistory.push({ role: 'assistant', content: reply });
    console.log('');
    console.log(`  ${T.aura(Sym.sparkle + '  Aura')}`);
    console.log('');
    const lines = reply.split('\n');
    for (const line of lines) {
      console.log('  ' + line);
    }
    console.log('');
  } catch (err) {
    const errMsg = shortError(err);
    spin.stop(`  ${T.nova('LLM Error:')} ${errMsg}`);
    if (isQuotaOrRateLimitError(err)) {
      console.log('');
      console.log(`  ${T.solar(Sym.warn)} ${T.solarB('API quota exhausted or rate-limited')} for ${T.white(getActiveModel().provider)}.`);
      console.log('');
      console.log(`  ${T.auraBold('Available alternatives:')}`);
      const providers = getAvailableProviders();
      for (const p of providers) {
        if (p.provider === getActiveModel().provider) continue;
        const keyStatus = p.provider === 'ollama' ? T.muted('(local)') : p.hasKey ? T.aurora('✓ key set') : T.dim('✗ no key');
        console.log(`  ${T.aura('›')} ${T.white(p.provider.padEnd(12))} ${keyStatus}  ${T.muted(p.models.join(', '))}`);
      }
      console.log('');
      console.log(`  ${T.muted('Switch with:')} ${T.aura('/model <name>')}  ${T.muted('e.g.')} ${T.aura('/model gemini-pro')} ${T.muted('or')} ${T.aura('/model mistral-large')}`);
      console.log(`  ${T.muted('Set a key:')}   ${T.aura('/apikey <provider>')}  ${T.muted('e.g.')} ${T.aura('/apikey gemini')}`);
      console.log(`  ${T.muted('Local AI:')}    ${T.aura('/ollama install')}  ${T.muted('— free, private, no API key needed')}`);
    } else if (isAuthError(err)) {
      console.log('');
      console.log(`  ${T.solar(Sym.warn)} API key missing or invalid.`);
      const prov = getActiveModel().provider;
      console.log(`  ${T.muted('Fix:')} ${T.aura(`/apikey ${prov}`)} ${T.muted(`to set your ${prov} key (input is masked)`)}`);
      console.log(`  ${T.muted('Or switch model:')} ${T.aura('/models')} ${T.muted('to see alternatives')}`);
    }
  }
}

async function startChatSession(profile: UserProfile, rl: readline.Interface): Promise<void> {
  clearScreen(profile);
  printAgentBanner('AURA');
  console.log(boxLine('AURA CHAT', 'aura'));
  console.log(`  ${T.muted('Type your message. Type')} ${T.aura('/back')} ${T.muted('to return to shell.')}`);
  console.log('');

  // Pause the main readline
  rl.pause();

  const chatRl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: `  ${T.ice('you')} ${T.dim('›')} `,
  });

  chatRl.prompt();

  chatRl.on('line', async (line) => {
    const msg = line.trim();
    if (msg === '/back' || msg === '/exit' || msg === '/quit') {
      chatRl.close();
      return;
    }
    if (!msg) { chatRl.prompt(); return; }

    // Guard: block API keys from being sent to cloud LLMs
    if (containsApiKey(msg)) {
      console.log('');
      console.log(`  ${T.nova(Sym.cross)} ${T.nova('API KEY DETECTED — blocked from sending.')}`);
      console.log(`  ${T.muted('Use')} ${T.aura('/back')} ${T.muted('then')} ${T.aura('/apikey gemini')} ${T.muted('to set your key securely.')}`);
      console.log('');
      chatRl.prompt();
      return;
    }

    chatHistory.push({ role: 'user', content: msg });
    const spin = new Typing('').start();
    try {
      const reply = await chat(chatHistory);
      spin.stop();
      chatHistory.push({ role: 'assistant', content: reply });
      console.log('');
      console.log(`  ${T.aura(Sym.sparkle)} ${T.auraBold('Aura:')}`);
      const replyLines = reply.split('\n');
      for (const rline of replyLines) console.log('  ' + rline);
      console.log('');
    } catch (err) {
      const errMsg = shortError(err);
      spin.stop(`  ${T.nova('Error:')} ${errMsg}`);
      if (isQuotaOrRateLimitError(err)) {
        console.log(`  ${T.solar(Sym.warn)} ${T.solarB('Quota exhausted.')} Run ${T.aura('/back')} then ${T.aura('/models')} to switch.`);
      } else if (isAuthError(err)) {
        console.log(`  ${T.solar(Sym.warn)} Run ${T.aura('/back')} then ${T.aura(`/apikey ${getActiveModel().provider}`)} to fix your API key.`);
      }
    }
    chatRl.prompt();
  });

  await new Promise<void>(resolve => {
    chatRl.on('close', () => {
      rl.resume();
      rl.prompt();
      resolve();
    });
  });
}

// ─── Task handler ──────────────────────────────────────────────────────────────
async function handleTask(args: string): Promise<void> {
  const [sub, ...rest] = args.split(' ');
  const restStr = rest.join(' ').trim();

  switch (sub) {
    case 'list':
    case 'ls':
    case '': {
      const tasks = await listTasks();
      console.log('');
      console.log(divider('TASKS'));
      if (tasks.length === 0) {
        console.log(`  ${T.muted('No tasks. Use /task add <title>')}`);
      } else {
        for (const t of tasks) {
          const statusIcon = {
            'todo': T.muted('○'),
            'in-progress': T.solar('◑'),
            'done': T.aurora('●'),
          }[t.status];
          const prio = t.priority === 'high' ? T.nova('[!]') : t.priority === 'med' ? T.solar('[~]') : T.muted('[ ]');
          const done = t.status === 'done' ? T.dim(t.title) : T.white(t.title);
          console.log(`  ${statusIcon} ${prio} ${T.dim(t.id.slice(0, 6))}  ${done}  ${T.muted(t.status)}`);
        }
      }
      console.log('');
      break;
    }

    case 'add':
    case 'new': {
      if (!restStr) { console.log(`  ${T.muted('Usage: /task add <title>')}`); break; }
      const t = await addTask(restStr);
      console.log(`  ${T.aurora(Sym.check)} Task created: ${T.white(t.title)} ${T.muted('#' + t.id.slice(0, 6))}`);
      break;
    }

    case 'done': {
      if (!restStr) { console.log(`  ${T.muted('Usage: /task done <id>')}`); break; }
      const updated = await updateTask(restStr, { status: 'done', doneAt: new Date().toISOString() });
      if (updated) console.log(`  ${T.aurora(Sym.check)} Marked done: ${T.white(updated.title)}`);
      else console.log(`  ${T.nova('Task not found.')}`);
      break;
    }

    case 'start': {
      if (!restStr) { console.log(`  ${T.muted('Usage: /task start <id>')}`); break; }
      const updated = await updateTask(restStr, { status: 'in-progress' });
      if (updated) console.log(`  ${T.solar(Sym.arrow)} Started: ${T.white(updated.title)}`);
      else console.log(`  ${T.nova('Task not found.')}`);
      break;
    }

    case 'rm':
    case 'del':
    case 'remove':
    case 'delete': {
      if (!restStr) { console.log(`  ${T.muted('Usage: /task rm <id>')}`); break; }
      const ok = await removeTask(restStr);
      if (ok) console.log(`  ${T.aurora(Sym.check)} Task removed.`);
      else console.log(`  ${T.nova('Task not found.')}`);
      break;
    }

    case 'prio':
    case 'priority': {
      const [id, p] = restStr.split(' ');
      if (!id || !p) { console.log(`  ${T.muted('Usage: /task prio <id> <high|med|low>')}`); break; }
      const updated = await updateTask(id, { priority: p as TaskPriority });
      if (updated) console.log(`  ${T.aurora(Sym.check)} Priority updated: ${T.white(updated.title)} → ${p}`);
      else console.log(`  ${T.nova('Task not found.')}`);
      break;
    }

    default:
      // If no sub-command, treat the whole args as a title to add
      if (args) {
        const t = await addTask(args);
        console.log(`  ${T.aurora(Sym.check)} Task created: ${T.white(t.title)} ${T.muted('#' + t.id.slice(0, 6))}`);
      } else {
        console.log(`  ${T.muted('Commands:')} list, add, done, start, rm, prio`);
      }
  }
}

// ─── Email handler (Gmail API first, IMAP fallback) ────────────────────────────
async function handleMail(args: string, rl: readline.Interface): Promise<void> {
  const [sub, ...rest] = args.split(' ');
  const restStr = rest.join(' ').trim();
  const gmailAuthed = await isGoogleAuthed();

  // Use the existing readline to avoid double-echo from two simultaneous rl instances
  const ask = (p: string): Promise<string> => new Promise(resolve => {
    rl.question(p, ans => resolve(ans.trim()));
  });

  switch (sub || 'inbox') {

    case 'setup': {
      console.log('');
      console.log(divider('EMAIL SETUP'));
      console.log('');
      console.log(`  ${T.aura(' 1')}  ${T.white('Gmail API')}  ${T.muted('(Recommended — uses /google auth, full access)')}`);
      console.log(`  ${T.aura(' 2')}  ${T.white('IMAP/SMTP')} ${T.muted('(App password, any email provider)')}`);
      console.log('');
      const choice = await ask(`  ${T.aura(Sym.arrow)} Choose (1 or 2): `);

      if (choice === '1') {
        console.log(`  ${T.muted('Run')} ${T.aura('/google auth')} ${T.muted('to connect your Gmail account.')}`);
      } else {
        const imapHost = await ask(`  ${T.aura('IMAP Host')} [imap.gmail.com]: `) || 'imap.gmail.com';
        const imapPort = parseInt(await ask(`  ${T.aura('IMAP Port')} [993]: `)) || 993;
        const smtpHost = await ask(`  ${T.aura('SMTP Host')} [smtp.gmail.com]: `) || 'smtp.gmail.com';
        const smtpPort = parseInt(await ask(`  ${T.aura('SMTP Port')} [587]: `)) || 587;
        const address = await ask(`  ${T.aura('Email address')}: `);
        const password = await askHidden(`  ${T.aura('App password (shown as ****):')} `);
        await saveEmailConfig({
          imap: { host: imapHost, port: imapPort, tls: true },
          smtp: { host: smtpHost, port: smtpPort, secure: smtpPort === 465 },
          address, password,
        });
        console.log(`  ${T.aurora(Sym.check)} IMAP/SMTP configured for ${T.white(address)}`);
        console.log(`  ${T.muted('For Gmail, generate an App Password at myaccount.google.com → Security → App Passwords')}`);
      }
      break;
    }

    case 'inbox':
    case '':
    case 'list': {
      const spin = new Typing('Fetching inbox...').start();
      try {
        if (gmailAuthed) {
          const emails = await fetchGmailInbox(20);
          spin.stop();
          const profile = await getGmailProfile().catch(() => ({ emailAddress: '', messagesTotal: 0 }));
          console.log('');
          console.log(divider(`GMAIL INBOX — ${profile.emailAddress} (${emails.length} shown)`));
          console.log('');
          console.log(`  ${T.dim('  # ')} ${T.muted('FROM'.padEnd(25))} ${T.muted('SUBJECT'.padEnd(38))} ${T.muted('DATE')}`);
          console.log(T.dim('  ' + '─'.repeat(76)));
          console.log(formatGmailList(emails));
          console.log('');
          console.log(`  ${T.muted('Use')} ${T.aura('/mail read <n>')} ${T.muted('to read · ')} ${T.aura('/mail send')} ${T.muted('to compose')}`);
        } else {
          const emails = await fetchInbox(20);
          spin.stop();
          console.log('');
          console.log(divider(`INBOX (${emails.length} messages)`));
          console.log('');
          console.log(`  ${T.dim('  # ')} ${T.muted('FROM'.padEnd(30))} ${T.muted('SUBJECT'.padEnd(40))} ${T.muted('DATE')}`);
          console.log(T.dim('  ' + '─'.repeat(76)));
          console.log(formatEmailList(emails));
          console.log('');
          console.log(`  ${T.muted('Tip: run')} ${T.aura('/google auth')} ${T.muted('to use Gmail API instead of IMAP')}`);
        }
        console.log('');
      } catch (err) {
        spin.stop(`  ${T.nova('Mail error:')} ${String(err)}`);
        if (String(err).includes('not configured') || String(err).includes('Not authenticated')) {
          console.log(`  ${T.muted('Run')} ${T.aura('/mail setup')} ${T.muted('or')} ${T.aura('/google auth')} ${T.muted('to configure email.')}`);
        }
      }
      break;
    }

    case 'read': {
      const idx = parseInt(restStr) - 1;
      if (isNaN(idx)) { console.log(`  ${T.muted('Usage: /mail read <number>')}`); break; }
      const spin = new Typing('Loading message...').start();
      try {
        if (gmailAuthed) {
          const emails = await fetchGmailInbox(20);
          spin.stop();
          if (idx < 0 || idx >= emails.length) { console.log(`  ${T.nova('Not found.')}`); break; }
          const m = emails[idx];
          console.log('');
          console.log(divider('EMAIL'));
          console.log('');
          console.log(formatGmailMessage(m).split('\n').map(l => '  ' + l).join('\n'));
        } else {
          const emails = await fetchInbox(20);
          spin.stop();
          if (idx < 0 || idx >= emails.length) { console.log(`  ${T.nova('Not found.')}`); break; }
          console.log('');
          console.log(divider('EMAIL'));
          console.log('');
          console.log(formatEmail(emails[idx]).split('\n').map(l => '  ' + l).join('\n'));
        }
        console.log('');
      } catch (err) {
        spin.stop(`  ${T.nova('Error:')} ${String(err)}`);
      }
      break;
    }

    case 'send': {
      const to = await ask(`  ${T.aura('To')}: `);
      const subject = await ask(`  ${T.aura('Subject')}: `);
      console.log(`  ${T.muted('Body (type')} ${T.aura('.')} ${T.muted('on a new line to finish):')}`);
      const lines: string[] = [];
      while (true) {
        const l = await ask('  ');
        if (l === '.') break;
        lines.push(l);
      }
      const body = lines.join('\n');
      const spin = new Typing('Sending...').start();
      try {
        if (gmailAuthed) {
          await sendGmail(to, subject, body);
        } else {
          await sendEmail(to, subject, body);
        }
        spin.stop(`  ${T.aurora(Sym.check)} Sent to ${T.white(to)}`);
      } catch (err) {
        spin.stop(`  ${T.nova('Failed:')} ${String(err)}`);
      }
      break;
    }

    default:
      console.log(`  ${T.muted('Commands:')} inbox, read <n>, send, setup`);
      console.log(`  ${T.muted('Status:')} ${gmailAuthed ? T.aurora('Gmail API connected') : T.muted('IMAP mode — run /google auth for Gmail API')}`);
  }
}

// ─── Google handler ────────────────────────────────────────────────────────────
async function handleGoogle(args: string, rl: readline.Interface): Promise<void> {
  const [sub, ...rest] = args.split(' ');
  // Use the existing readline to avoid double-echo from two simultaneous rl instances
  const ask = (p: string): Promise<string> => new Promise(resolve => {
    rl.question(p, ans => resolve(ans.trim()));
  });

  switch (sub || 'status') {
    case 'auth': {
      console.log('');
      console.log(divider('GOOGLE OAUTH2 SETUP'));
      console.log('');

      // Use stored or default credentials — no manual entry needed
      const oauthCreds = await getOAuthClientCreds();
      console.log(`  ${T.aurora(Sym.check)} Using Aura OS OAuth credentials`);
      console.log(`  ${T.muted('Client ID:')} ${T.dim(oauthCreds.clientId.slice(0, 20) + '...')}`);
      console.log('');

      // Save for future use
      const creds = await loadGoogleCreds();
      await saveGoogleCreds({ ...creds, clientId: oauthCreds.clientId, clientSecret: oauthCreds.clientSecret });

      try {
        await runGoogleAuth(oauthCreds.clientId, oauthCreds.clientSecret);
        console.log(`  ${T.aurora(Sym.check)} Google account connected. Run /mail inbox to access Gmail.`);
      } catch (err) {
        console.log(`  ${T.nova('Auth failed:')} ${String(err)}`);
      }
      break;
    }

    case 'apikey': {
      const key = await askHidden(`  ${T.aura('Google API Key (shown as ****):')} `);
      if (!key.trim()) { console.log(`  ${T.nova('No key entered.')}`); break; }
      await saveKey('GOOGLE_API_KEY' as any, key.trim());
      process.env.GOOGLE_API_KEY = key.trim();
      console.log(`  ${T.aurora(Sym.check)} Google API key saved.`);
      console.log(`  ${T.muted('Now')} ${T.aura('/search')} ${T.muted('will use Google Custom Search.')}`);
      break;
    }

    case 'status': {
      const authed = await isGoogleAuthed();
      const creds = await loadGoogleCreds();
      const hasKey = !!(process.env.GOOGLE_API_KEY || (await loadKeys()).GOOGLE_API_KEY);
      console.log('');
      console.log(divider('GOOGLE STATUS'));
      console.log(`  ${T.muted('OAuth2 (Gmail/Drive):')} ${authed ? T.aurora(Sym.check + ' connected') : T.nova(Sym.cross + ' not connected')}`);
      console.log(`  ${T.muted('API Key (Search):    ')} ${hasKey ? T.aurora(Sym.check + ' set') : T.muted('not set')}`);
      console.log(`  ${T.muted('Client ID:           ')} ${creds.clientId ? T.dim(creds.clientId.slice(0, 20) + '...') : T.muted('not set')}`);
      if (authed && creds.expiresAt) {
        const exp = new Date(creds.expiresAt).toLocaleTimeString();
        console.log(`  ${T.muted('Token expires:       ')} ${T.white(exp)}`);
      }
      console.log('');
      console.log(`  ${T.muted('Commands:')} ${T.aura('/google auth')} ${T.muted('·')} ${T.aura('/google apikey')} ${T.muted('·')} ${T.aura('/google status')}`);
      console.log('');
      break;
    }

    default:
      console.log(`  ${T.muted('Commands:')} ${T.aura('/google auth')} ${T.muted('·')} ${T.aura('/google apikey')} ${T.muted('·')} ${T.aura('/google status')}`);
  }
}

// ─── Drive handler ─────────────────────────────────────────────────────────────
async function handleDrive(args: string): Promise<void> {
  const [sub, ...rest] = args.split(' ');
  const restStr = rest.join(' ').trim();

  if (!(await isGoogleAuthed())) {
    console.log(`  ${T.nova('Not connected to Google.')} Run ${T.aura('/google auth')} first.`);
    return;
  }

  switch (sub || 'list') {
    case 'list':
    case 'ls': {
      const spin = new Typing('Fetching Drive files...').start();
      try {
        const files = await listDriveFiles(restStr || undefined, 20);
        spin.stop();
        console.log('');
        console.log(divider(`GOOGLE DRIVE (${files.length} files)`));
        console.log('');
        console.log(`  ${T.dim('  # ')} ${T.muted('NAME'.padEnd(45))} ${T.muted('MODIFIED')}  ${T.muted('SIZE')}`);
        console.log(T.dim('  ' + '─'.repeat(72)));
        console.log(formatDriveList(files));
        console.log('');
        console.log(`  ${T.muted('Use')} ${T.aura('/drive read <n>')} ${T.muted('to read a file · ')} ${T.aura('/drive search <query>')} ${T.muted('to search')}`);
        console.log('');
      } catch (err) {
        spin.stop(`  ${T.nova('Drive error:')} ${String(err)}`);
      }
      break;
    }

    case 'search': {
      if (!restStr) { console.log(`  ${T.muted('Usage: /drive search <query>')}`); break; }
      const spin = new Typing(`Searching Drive for "${restStr}"...`).start();
      try {
        const files = await listDriveFiles(`name contains '${restStr}'`, 15);
        spin.stop();
        console.log('');
        console.log(divider(`DRIVE SEARCH: "${restStr}"`));
        console.log(formatDriveList(files));
        console.log('');
      } catch (err) {
        spin.stop(`  ${T.nova('Search failed:')} ${String(err)}`);
      }
      break;
    }

    case 'read': {
      const idx = parseInt(restStr) - 1;
      if (isNaN(idx)) { console.log(`  ${T.muted('Usage: /drive read <number>')}`); break; }
      const spin = new Typing('Loading file...').start();
      try {
        const files = await listDriveFiles(undefined, 20);
        if (idx < 0 || idx >= files.length) { spin.stop(); console.log(`  ${T.nova('File not found.')}`); break; }
        const file = files[idx];
        const content = await readDriveFile(file.id);
        spin.stop();
        console.log('');
        console.log(divider(file.name.slice(0, 50)));
        console.log('');
        content.split('\n').slice(0, 60).forEach(l => console.log('  ' + l));
        console.log('');
      } catch (err) {
        spin.stop(`  ${T.nova('Read failed:')} ${String(err)}`);
      }
      break;
    }

    default:
      console.log(`  ${T.muted('Commands:')} list, search <query>, read <n>`);
  }
}

// ─── Agent handler ─────────────────────────────────────────────────────────────
async function handleAgent(args: string, rl?: readline.Interface): Promise<void> {
  const [sub, name] = args.split(' ');

  switch (sub || 'status') {
    case 'list':
    case 'ls': {
      console.log('');
      console.log(divider('REGISTERED AGENTS'));
      for (const def of listRegistered()) {
        console.log(`  ${T.aura(def.name.padEnd(22))} ${T.muted(def.description)}`);
      }
      console.log('');
      break;
    }

    case 'status':
    case 'st': {
      const status = getAgentStatus();
      console.log('');
      console.log(divider('AGENT STATUS'));
      for (const [n, active] of Object.entries(status)) {
        const dot = active ? T.aurora('●') : T.dim('○');
        const s = active ? T.aurora('running') : T.muted('idle');
        console.log(`  ${dot}  ${T.white(n.padEnd(22))} ${s}`);
      }
      console.log('');
      break;
    }

    case 'start': {
      if (!name) { console.log(`  ${T.muted('Usage: /agent start <name>')}`); break; }
      const ok = startAgent(name);
      if (ok) {
        showAgentBanner(name);
        console.log(`  ${T.aurora(Sym.check)} Agent started: ${T.white(name)}`);
      }
      else console.log(`  ${T.nova('Unknown agent:')} ${name}`);
      break;
    }

    case 'stop': {
      if (!name) { console.log(`  ${T.muted('Usage: /agent stop <name>')}`); break; }
      const ok = stopAgent(name);
      if (ok) console.log(`  ${T.aurora(Sym.check)} Agent stopped: ${T.white(name)}`);
      else console.log(`  ${T.nova('Agent not running:')} ${name}`);
      break;
    }

    case 'stopall': {
      stopAllAgents();
      console.log(`  ${T.aurora(Sym.check)} All agents stopped.`);
      break;
    }

    case 'templates':
    case 'tpl': {
      const templates = getTemplates();
      console.log('');
      console.log(divider('AGENT TEMPLATES'));
      for (const t of templates) {
        console.log(`  ${T.aura(t.id.padEnd(20))} ${T.ice(t.category.padEnd(12))} ${T.muted(t.description)}`);
        console.log(`  ${T.dim(''.padEnd(20))} ${T.dim('interval: ' + (t.defaultInterval / 1000) + 's')}`);
      }
      console.log('');
      console.log(`  ${T.muted('Use')} ${T.aura('/agent create')} ${T.muted('to build one.')}`);
      console.log('');
      break;
    }

    case 'create': {
      if (!rl) { console.log(`  ${T.nova('Create requires interactive mode.')}`); break; }
      const ask = (p: string): Promise<string> => new Promise(resolve => {
        rl.question(p, ans => resolve(ans.trim()));
      });

      const templates = getTemplates();
      console.log('');
      console.log(divider('CREATE CUSTOM AGENT'));
      console.log('');
      for (let i = 0; i < templates.length; i++) {
        console.log(`  ${T.aura(String(i + 1))}  ${T.white(templates[i].name.padEnd(20))} ${T.muted(templates[i].description)}`);
      }
      console.log('');
      const choice = parseInt(await ask(`  ${T.aura(Sym.arrow)} Template (1-${templates.length}): `));
      if (isNaN(choice) || choice < 1 || choice > templates.length) {
        console.log(`  ${T.nova('Invalid choice.')}`);
        break;
      }
      const template = templates[choice - 1];

      const agentName = await ask(`  ${T.aura('Agent name')}: `);
      if (!agentName) { console.log(`  ${T.nova('Aborted.')}`); break; }

      const config: Record<string, string> = {};
      let aborted = false;
      for (const field of template.configFields) {
        const hint = field.hint ? T.dim(` (${field.hint})`) : '';
        const def = field.default ? T.dim(` [${field.default}]`) : '';
        const value = await ask(`  ${T.aura(field.label)}${def}${hint}: `);
        config[field.name] = value || field.default || '';
        if (field.required && !config[field.name]) {
          console.log(`  ${T.nova('Required field. Aborted.')}`);
          aborted = true;
          break;
        }
      }
      if (aborted) break;

      const intervalStr = await ask(`  ${T.aura('Interval (ms)')} [${template.defaultInterval}]: `);
      const intervalMs = parseInt(intervalStr) || template.defaultInterval;

      const agent = buildAgentFromTemplate(template.id, agentName, config, intervalMs);
      await saveCustomAgent(agent);
      registerCustomAgent(agent);
      console.log(`  ${T.aurora(Sym.check)} Agent "${agentName}" created and registered.`);
      break;
    }

    case 'custom':
    case 'my': {
      const agents = await loadCustomAgents();
      console.log('');
      console.log(divider(`CUSTOM AGENTS (${agents.length})`));
      if (agents.length === 0) {
        console.log(`  ${T.muted('No custom agents. Use /agent create')}`);
      } else {
        for (const a of agents) {
          const en = a.enabled ? T.aurora('enabled') : T.muted('disabled');
          const interval = T.dim(`every ${Math.round(a.intervalMs / 1000)}s`);
          console.log(`  ${T.aura(a.name.padEnd(20))} ${T.ice(a.templateId.padEnd(18))} ${en}  ${interval}`);
        }
      }
      console.log('');
      break;
    }

    case 'delete':
    case 'remove': {
      if (!name) { console.log(`  ${T.muted('Usage: /agent delete <id-or-name>')}`); break; }
      const agents = await loadCustomAgents();
      const match = agents.find(a => a.id === name || a.name === name);
      if (!match) { console.log(`  ${T.nova('Custom agent not found:')} ${name}`); break; }
      stopAgent(match.name);
      await removeCustomAgent(match.id);
      console.log(`  ${T.aurora(Sym.check)} Agent "${match.name}" deleted.`);
      break;
    }

    default:
      console.log(`  ${T.muted('Commands:')} list, status, start <name>, stop <name>, stopall,`);
      console.log(`  ${T.muted('         ')} templates, create, custom, delete <id>`);
  }
}

// ─── Ollama handler ──────────────────────────────────────────────────────────────
async function handleOllama(args: string): Promise<void> {
  const [sub, ...rest] = args.split(' ');
  const restStr = rest.join(' ').trim();

  switch (sub || 'status') {
    case 'status': {
      const spin = new Typing('Checking Ollama...').start();
      const status = await checkOllamaInstalled();
      spin.stop();
      console.log('');
      console.log(divider('OLLAMA STATUS'));
      console.log(`  ${T.muted('Installed:')}  ${status.installed ? T.aurora(Sym.check + ' yes') : T.nova(Sym.cross + ' not found')}`);
      console.log(`  ${T.muted('Running:')}    ${status.running ? T.aurora(Sym.check + ' yes') : T.nova(Sym.cross + ' not running')}`);
      if (status.version) console.log(`  ${T.muted('Version:')}    ${T.white(status.version)}`);
      console.log('');
      if (!status.installed) {
        console.log(`  ${T.muted('Run')} ${T.aura('/ollama install')} ${T.muted('for installation guide.')}`);
      } else if (!status.running) {
        console.log(`  ${T.muted('Start Ollama with:')} ${T.ice('ollama serve')}`);
      } else {
        // Show local models
        try {
          const models = await listOllamaModels();
          if (models.length > 0) {
            console.log(`  ${T.muted('Local models:')} ${T.white(String(models.length))}`);
            for (const m of models) {
              console.log(`    ${T.solar(m.name.padEnd(25))} ${T.muted(m.size.padEnd(10))} ${T.dim(m.modified)}`);
            }
          } else {
            console.log(`  ${T.muted('No models installed. Run')} ${T.aura('/ollama pull llama3.2:3b')} ${T.muted('to get started.')}`);
          }
        } catch { /* ignore */ }
      }
      console.log('');
      break;
    }

    case 'models':
    case 'list': {
      const status = await checkOllamaInstalled();
      if (!status.running) {
        console.log(`  ${T.nova('Ollama is not running.')} Start it with ${T.ice('ollama serve')}`);
        break;
      }
      const spin = new Typing('Fetching Ollama models...').start();
      try {
        const models = await listOllamaModels();
        spin.stop();
        console.log('');
        console.log(divider(`OLLAMA MODELS (${models.length})`));
        if (models.length === 0) {
          console.log(`  ${T.muted('No models installed.')}`);
          console.log(`  ${T.muted('Pull one:')} ${T.aura('/ollama pull llama3.2:3b')}`);
        } else {
          console.log(`  ${T.dim('  # ')} ${T.muted('NAME'.padEnd(28))} ${T.muted('SIZE'.padEnd(10))} ${T.muted('PARAMS'.padEnd(10))} ${T.muted('MODIFIED')}`);
          console.log(T.dim('  ' + '─'.repeat(70)));
          models.forEach((m, i) => {
            const num = T.aura(String(i + 1).padStart(3));
            console.log(`  ${num}  ${T.solar(m.name.padEnd(28))} ${T.white(m.size.padEnd(10))} ${T.muted((m.parameterSize || '').padEnd(10))} ${T.dim(m.modified)}`);
          });
        }
        console.log('');
      } catch (err) {
        spin.stop(`  ${T.nova('Error:')} ${String(err)}`);
      }
      break;
    }

    case 'pull': {
      if (!restStr) {
        console.log(`  ${T.muted('Usage:')} ${T.aura('/ollama pull <model>')}`);
        console.log(`  ${T.muted('Example:')} ${T.aura('/ollama pull llama3.2:3b')}`);
        break;
      }
      const status = await checkOllamaInstalled();
      if (!status.running) {
        console.log(`  ${T.nova('Ollama is not running.')} Start it with ${T.ice('ollama serve')}`);
        break;
      }
      console.log(`  ${T.muted('Pulling')} ${T.white(restStr)}${T.muted('... this may take a while.')}`);
      const spin = new Typing(`Downloading ${restStr}`).start();
      try {
        let lastStatus = '';
        await pullOllamaModel(restStr, (st, completed, total) => {
          if (st !== lastStatus) {
            lastStatus = st;
            if (completed && total && total > 0) {
              const pct = Math.round((completed / total) * 100);
              spin.update(`${st} ${pct}%`);
            } else {
              spin.update(st);
            }
          }
        });
        spin.stop(`  ${T.aurora(Sym.check)} Model ${T.white(restStr)} pulled successfully!`);
        console.log(`  ${T.muted('Use')} ${T.aura(`/model ollama/${restStr}`)} ${T.muted('to switch to it.')}`);
      } catch (err) {
        spin.stop(`  ${T.nova('Pull failed:')} ${String(err)}`);
      }
      break;
    }

    case 'install': {
      console.log(getOllamaInstallGuide());
      break;
    }

    case 'use': {
      if (!restStr) {
        console.log(`  ${T.muted('Usage:')} ${T.aura('/ollama use <model>')}`);
        break;
      }
      const status = await checkOllamaInstalled();
      if (!status.running) {
        console.log(`  ${T.solar(Sym.warn)} Ollama is not running. Start it with ${T.ice('ollama serve')}`);
      }
      setModel('ollama' as ModelProvider, restStr);
      const prof = await loadProfile();
      if (prof) {
        prof.preferences.defaultModel = restStr;
        await saveProfileFn(prof);
      }
      console.log(`  ${T.aurora(Sym.check)} Model set to ${getProviderBadge('ollama')} ${T.white(restStr)}`);
      break;
    }

    default:
      console.log(`  ${T.muted('Commands:')} ${T.aura('/ollama status')} ${T.dim('·')} ${T.aura('models')} ${T.dim('·')} ${T.aura('pull <model>')} ${T.dim('·')} ${T.aura('install')} ${T.dim('·')} ${T.aura('use <model>')}`);
  }
}

// ─── History handler ──────────────────────────────────────────────────────────────
async function handleHistory(args: string): Promise<void> {
  const [sub, ...rest] = args.split(' ');

  switch (sub || 'list') {
    case 'list':
    case 'ls':
    case '': {
      const limit = parseInt(rest[0]) || 20;
      const entries = await getHistory(limit);
      console.log('');
      console.log(divider(`BROWSER HISTORY (${entries.length})`));
      if (entries.length === 0) {
        console.log(`  ${T.muted('No history yet. Use /browse <url> to start.')}`);
      } else {
        for (const e of entries) {
          const ts = new Date(e.visitedAt).toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          });
          console.log(`  ${T.dim(ts.padEnd(16))}  ${T.white(e.title.slice(0, 40).padEnd(40))}  ${T.muted(e.url.slice(0, 50))}`);
        }
      }
      console.log('');
      break;
    }

    case 'clear': {
      await clearHistory();
      console.log(`  ${T.aurora(Sym.check)} Browser history cleared.`);
      break;
    }

    default:
      console.log(`  ${T.muted('Commands:')} list [limit], clear`);
  }
}

// ─── Bookmark handler ─────────────────────────────────────────────────────────────
async function handleBookmark(args: string): Promise<void> {
  const [sub, ...rest] = args.split(' ');
  const restStr = rest.join(' ').trim();

  switch (sub || 'list') {
    case 'list':
    case 'ls':
    case '': {
      const bookmarks = await getBookmarks();
      console.log('');
      console.log(divider(`BOOKMARKS (${bookmarks.length})`));
      if (bookmarks.length === 0) {
        console.log(`  ${T.muted('No bookmarks. Use /bm add <url> [title]')}`);
      } else {
        for (const b of bookmarks) {
          const tags = b.tags.length > 0 ? T.ice(` [${b.tags.join(', ')}]`) : '';
          console.log(`  ${T.aurora(Sym.sparkle)} ${T.white(b.title.slice(0, 35).padEnd(35))} ${T.muted(b.url.slice(0, 45))}${tags}`);
        }
      }
      console.log('');
      break;
    }

    case 'add':
    case 'save': {
      let url = rest[0] || '';
      let title = '';
      let tags: string[] = [];

      if (!url && lastBrowseResult) {
        url = lastBrowseResult.url;
        title = lastBrowseResult.title;
      } else if (!url) {
        console.log(`  ${T.muted('Usage: /bm add <url> [title] [--tags t1,t2]')}`);
        break;
      }

      const tagsIdx = rest.indexOf('--tags');
      if (tagsIdx !== -1 && rest[tagsIdx + 1]) {
        tags = rest[tagsIdx + 1].split(',').map(t => t.trim()).filter(Boolean);
        title = rest.slice(1, tagsIdx).join(' ').trim() || title;
      } else {
        title = rest.slice(1).join(' ').trim() || title || url;
      }

      await addBookmark(url, title, tags);
      console.log(`  ${T.aurora(Sym.check)} Bookmarked: ${T.white(title.slice(0, 40))} ${T.muted(url.slice(0, 50))}`);
      break;
    }

    case 'rm':
    case 'del':
    case 'remove': {
      if (!restStr) { console.log(`  ${T.muted('Usage: /bm rm <url>')}`); break; }
      const ok = await removeBookmark(restStr);
      if (ok) console.log(`  ${T.aurora(Sym.check)} Bookmark removed.`);
      else console.log(`  ${T.nova('Bookmark not found.')}`);
      break;
    }

    default:
      console.log(`  ${T.muted('Commands:')} list, add [url] [title] [--tags t1,t2], rm <url>`);
  }
}

// ─── Tab handler ──────────────────────────────────────────────────────────────────
async function handleTab(args: string): Promise<void> {
  const [sub, ...rest] = args.split(' ');
  const restStr = rest.join(' ').trim();

  switch (sub || 'list') {
    case 'list':
    case 'ls':
    case '': {
      const tabs = listTabs();
      const active = getActiveTab();
      console.log('');
      console.log(divider(`TABS (${tabs.length})`));
      if (tabs.length === 0) {
        console.log(`  ${T.muted('No tabs open. Use /tab new [url]')}`);
      } else {
        for (const t of tabs) {
          const cur = active && t.id === active.id ? T.aurora(' \u25C4 active') : '';
          console.log(`  ${T.aura(String(t.id).padStart(3))}  ${T.white((t.title || 'New Tab').slice(0, 35).padEnd(35))}  ${T.muted(t.url.slice(0, 40))}${cur}`);
        }
      }
      console.log('');
      break;
    }

    case 'new':
    case 'open': {
      const tab = createTab(restStr || undefined);
      console.log(`  ${T.aurora(Sym.check)} Tab #${tab.id} created.`);
      if (restStr) {
        const spin = new Typing(`Loading ${restStr}...`).start();
        try {
          const result = await browse(restStr);
          lastBrowseResult = result;
          spin.stop();
          console.log(`  ${T.aurora(Sym.check)} Navigated to ${T.white(result.title.slice(0, 50))}`);
        } catch (err) {
          spin.stop(`  ${T.nova('Browse failed:')} ${String(err)}`);
        }
      }
      break;
    }

    case 'close': {
      const id = parseInt(restStr) || getActiveTab()?.id;
      if (!id) { console.log(`  ${T.muted('No active tab to close.')}`); break; }
      const ok = closeTab(id);
      if (ok) console.log(`  ${T.aurora(Sym.check)} Tab #${id} closed.`);
      else console.log(`  ${T.nova('Tab not found:')} ${id}`);
      break;
    }

    case 'switch':
    case 'go': {
      const id = parseInt(restStr);
      if (isNaN(id)) { console.log(`  ${T.muted('Usage: /tab switch <id>')}`); break; }
      const tab = switchTab(id);
      if (tab) {
        console.log(`  ${T.aurora(Sym.check)} Switched to tab #${tab.id}: ${T.white(tab.title || 'New Tab')}`);
        if (tab.result) lastBrowseResult = tab.result;
      } else {
        console.log(`  ${T.nova('Tab not found:')} ${id}`);
      }
      break;
    }

    default:
      console.log(`  ${T.muted('Commands:')} list, new [url], close [id], switch <id>`);
  }
}

// ─── Image render handler ─────────────────────────────────────────────────────────
async function handleRender(args: string): Promise<void> {
  if (!args) {
    console.log(`  ${T.muted('Usage: /render <url|path|img#>')}`);
    console.log(`  ${T.muted('  /render https://example.com/photo.png')}`);
    console.log(`  ${T.muted('  /render ./screenshot.jpg')}`);
    console.log(`  ${T.muted('  /render img3  (from last browse)')}`);
    console.log(`  ${T.muted('  /render caps  (terminal capabilities)')}`);
    return;
  }

  if (args === 'caps') {
    const caps = detectTerminalCapabilities();
    console.log('');
    console.log(divider('TERMINAL IMAGE CAPABILITIES'));
    console.log(`  ${T.muted('Sixel:'.padEnd(12))} ${caps.sixel ? T.aurora('yes') : T.muted('no')}`);
    console.log(`  ${T.muted('Kitty:'.padEnd(12))} ${caps.kitty ? T.aurora('yes') : T.muted('no')}`);
    console.log(`  ${T.muted('iTerm2:'.padEnd(12))} ${caps.iterm ? T.aurora('yes') : T.muted('no')}`);
    console.log(`  ${T.muted('Chafa:'.padEnd(12))} ${caps.chafa ? T.aurora('yes') : T.muted('no')}`);
    console.log('');
    return;
  }

  // img<N> from last browse result
  const imgMatch = args.match(/^img(\d+)$/i);
  if (imgMatch) {
    if (!lastBrowseResult || !lastBrowseResult.images || lastBrowseResult.images.length === 0) {
      console.log(`  ${T.muted('No images available. Browse a page first with /browse <url>')}`);
      return;
    }
    const imgNum = parseInt(imgMatch[1]);
    const img = lastBrowseResult.images.find((i: { n: number }) => i.n === imgNum);
    if (!img) {
      console.log(`  ${T.nova('Image #' + imgNum + ' not found.')} Available: 1-${lastBrowseResult.images.length}`);
      return;
    }
    const spin = new Typing(`Rendering image: ${img.alt || img.src.slice(0, 40)}...`).start();
    try {
      const rendered = await renderImageFromUrl(img.src);
      spin.stop();
      console.log('');
      console.log(rendered);
      console.log(`  ${T.muted(img.alt || 'image')} ${T.dim(img.src.slice(0, 60))}`);
      console.log('');
    } catch (err) {
      spin.stop(`  ${T.nova('Render failed:')} ${String(err)}`);
    }
    return;
  }

  // URL or file path
  const isUrl = args.startsWith('http://') || args.startsWith('https://');
  const spin = new Typing(`Rendering ${isUrl ? 'image from URL' : 'file'}...`).start();
  try {
    const rendered = isUrl
      ? await renderImageFromUrl(args)
      : await renderImage(args);
    spin.stop();
    console.log('');
    console.log(rendered);
    console.log('');
  } catch (err) {
    spin.stop(`  ${T.nova('Render failed:')} ${String(err)}`);
  }
}

// ─── JavaScript handler ───────────────────────────────────────────────────────────
async function handleJs(args: string): Promise<void> {
  if (!args) {
    console.log(`  ${T.muted('Usage: /js <javascript code>')}`);
    console.log(`  ${T.muted('  /js 2 + 2')}`);
    console.log(`  ${T.muted('  /js [1,2,3].map(n => n * n)')}`);
    console.log(`  ${T.muted('Runs in a sandboxed VM. No require/process/fs access.')}`);
    return;
  }

  const spin = new Typing('Evaluating...').start();
  try {
    const result: ScriptResult = await evaluateScript(args);
    spin.stop();

    if (result.console.length > 0) {
      console.log('');
      console.log(`  ${T.muted('Console:')}`);
      for (const line of result.console) {
        console.log(`  ${T.dim('>')} ${T.white(line)}`);
      }
    }

    if (result.error) {
      console.log(`  ${T.nova(Sym.cross)} ${T.nova(result.error)}`);
    } else {
      const display = typeof result.result === 'object'
        ? JSON.stringify(result.result, null, 2)
        : String(result.result);
      console.log('');
      console.log(`  ${T.aurora(Sym.arrow)} ${T.white(display)}`);
    }
    console.log('');
  } catch (err) {
    spin.stop(`  ${T.nova('JS error:')} ${String(err)}`);
  }
}

// ─── MCP handler ──────────────────────────────────────────────────────────────────
async function handleMcp(args: string, rl: readline.Interface): Promise<void> {
  const [sub, ...rest] = args.split(' ');
  const restStr = rest.join(' ').trim();

  const ask = (p: string): Promise<string> => new Promise(resolve => {
    rl.question(p, ans => resolve(ans.trim()));
  });

  switch (sub || 'status') {

    case 'status':
    case '': {
      const server = getMcpServerStatus();
      const connections = await listMcpConnectionsFull();
      console.log('');
      console.log(divider('MCP STATUS'));
      console.log(`  ${T.muted('MCP Server:'.padEnd(16))} ${server.running ? T.aurora('running on :' + server.port) : T.muted('stopped')}`);
      if (server.running) {
        console.log(`  ${T.muted('Connections:'.padEnd(16))} ${T.white(String(server.connections))}`);
      }
      console.log('');
      if (connections.length > 0) {
        console.log(`  ${T.aurora('Client Connections:')}`);
        for (const c of connections) {
          const dot = c.connected ? T.aurora('\u25CF') : T.dim('\u25CB');
          const status = c.connected ? T.aurora('connected') : c.error ? T.nova('error') : T.muted('disconnected');
          const tools = c.tools.length > 0 ? T.muted(` (${c.tools.length} tools)`) : '';
          console.log(`  ${dot}  ${T.white(c.name.padEnd(20))} ${T.ice(c.type.padEnd(6))} ${status}${tools}`);
          if (c.error) console.log(`     ${T.dim(c.error.slice(0, 60))}`);
        }
      } else {
        console.log(`  ${T.muted('No MCP servers configured. Use /mcp add to add one.')}`);
      }
      console.log('');
      break;
    }

    case 'serve':
    case 'start': {
      const port = parseInt(rest[0]) || undefined;
      const spin = new Typing(`Starting MCP server${port ? ' on :' + port : ''}...`).start();
      try {
        await startMcpServer(port);
        const s = getMcpServerStatus();
        spin.stop(`  ${T.aurora(Sym.check)} MCP server running on port ${T.white(String(s.port))}`);
      } catch (err) {
        spin.stop(`  ${T.nova('Failed:')} ${String(err)}`);
      }
      break;
    }

    case 'stop': {
      stopMcpServer();
      console.log(`  ${T.aurora(Sym.check)} MCP server stopped.`);
      break;
    }

    case 'list':
    case 'ls': {
      const connections = await listMcpConnectionsFull();
      console.log('');
      console.log(divider(`MCP SERVERS (${connections.length})`));
      if (connections.length === 0) {
        console.log(`  ${T.muted('None configured. Use /mcp add')}`);
      } else {
        for (const c of connections) {
          const dot = c.connected ? T.aurora('\u25CF') : T.dim('\u25CB');
          const status = c.connected ? T.aurora('connected') : T.muted('disconnected');
          console.log(`  ${dot}  ${T.aura(c.id.padEnd(16))} ${T.white(c.name.padEnd(18))} ${T.ice(c.type.padEnd(6))} ${status}`);
        }
      }
      console.log('');
      break;
    }

    case 'add': {
      console.log('');
      console.log(divider('ADD MCP SERVER'));
      console.log('');
      const id = await ask(`  ${T.aura('Server ID')} (unique slug): `);
      if (!id) { console.log(`  ${T.nova('Aborted.')}`); break; }
      const mcpName = await ask(`  ${T.aura('Display name')}: `) || id;
      const type = await ask(`  ${T.aura('Transport')} (stdio/sse): `);
      if (type !== 'stdio' && type !== 'sse') { console.log(`  ${T.nova('Must be stdio or sse.')}`); break; }

      const config: McpServerConfig = {
        id, name: mcpName, type: type as 'stdio' | 'sse', enabled: true, autoConnect: false,
      };

      if (type === 'stdio') {
        config.command = await ask(`  ${T.aura('Command')}: `);
        const argsInput = await ask(`  ${T.aura('Args')} (space-separated, optional): `);
        if (argsInput) config.args = argsInput.split(' ');
      } else {
        config.url = await ask(`  ${T.aura('SSE URL')}: `);
      }

      const auto = await ask(`  ${T.aura('Auto-connect on startup?')} (y/n): `);
      config.autoConnect = auto.toLowerCase() === 'y';

      await addMcpServer(config);
      console.log(`  ${T.aurora(Sym.check)} MCP server "${mcpName}" added. Use /mcp connect ${id} to connect.`);
      break;
    }

    case 'rm':
    case 'remove': {
      if (!restStr) { console.log(`  ${T.muted('Usage: /mcp rm <id>')}`); break; }
      await removeMcpServer(restStr);
      console.log(`  ${T.aurora(Sym.check)} MCP server "${restStr}" removed.`);
      break;
    }

    case 'connect': {
      if (!restStr) { console.log(`  ${T.muted('Usage: /mcp connect <id>')}`); break; }
      const spin = new Typing(`Connecting to ${restStr}...`).start();
      try {
        await connectMcpServer(restStr);
        spin.stop(`  ${T.aurora(Sym.check)} Connected to ${T.white(restStr)}`);
      } catch (err) {
        spin.stop(`  ${T.nova('Failed:')} ${String(err)}`);
      }
      break;
    }

    case 'disconnect': {
      if (!restStr) { console.log(`  ${T.muted('Usage: /mcp disconnect <id>')}`); break; }
      await disconnectMcpServer(restStr);
      console.log(`  ${T.aurora(Sym.check)} Disconnected from ${T.white(restStr)}`);
      break;
    }

    case 'disconnect-all':
    case 'disconnectall': {
      await disconnectAll();
      console.log(`  ${T.aurora(Sym.check)} All MCP servers disconnected.`);
      break;
    }

    case 'tools': {
      if (!restStr) { console.log(`  ${T.muted('Usage: /mcp tools <server-id>')}`); break; }
      const spin = new Typing(`Listing tools on ${restStr}...`).start();
      try {
        const tools = await listMcpTools(restStr);
        spin.stop();
        console.log('');
        console.log(divider(`MCP TOOLS: ${restStr} (${tools.length})`));
        if (tools.length === 0) {
          console.log(`  ${T.muted('No tools exposed by this server.')}`);
        } else {
          for (const t of tools) {
            console.log(`  ${T.aura(t.name.padEnd(24))} ${T.muted(t.description.slice(0, 55))}`);
          }
        }
        console.log('');
      } catch (err) {
        spin.stop(`  ${T.nova('Error:')} ${String(err)}`);
      }
      break;
    }

    case 'call': {
      const [serverId, toolName, ...jsonParts] = rest;
      if (!serverId || !toolName) {
        console.log(`  ${T.muted('Usage: /mcp call <server-id> <tool> [json-args]')}`);
        break;
      }
      let toolArgs: Record<string, unknown> = {};
      const jsonStr = jsonParts.join(' ').trim();
      if (jsonStr) {
        try { toolArgs = JSON.parse(jsonStr); }
        catch { console.log(`  ${T.nova('Invalid JSON args.')}`); break; }
      }
      const spin = new Typing(`Calling ${toolName} on ${serverId}...`).start();
      try {
        const callResult = await callMcpTool(serverId, toolName, toolArgs);
        spin.stop();
        console.log('');
        console.log(`  ${T.aurora(Sym.check)} Result:`);
        const display = typeof callResult === 'object'
          ? JSON.stringify(callResult, null, 2)
          : String(callResult);
        for (const line of display.split('\n').slice(0, 40)) {
          console.log(`  ${T.white(line)}`);
        }
        console.log('');
      } catch (err) {
        spin.stop(`  ${T.nova('Call failed:')} ${String(err)}`);
      }
      break;
    }

    case 'autoconnect': {
      const spin = new Typing('Auto-connecting all enabled servers...').start();
      await autoConnectAll();
      spin.stop(`  ${T.aurora(Sym.check)} Auto-connect complete.`);
      break;
    }

    default:
      console.log(`  ${T.muted('Commands:')} status, serve [port], stop, list, add, rm <id>,`);
      console.log(`  ${T.muted('         ')} connect <id>, disconnect <id>, disconnect-all,`);
      console.log(`  ${T.muted('         ')} tools <id>, call <id> <tool> [json], autoconnect`);
  }
}

// ─── Memory handler ─────────────────────────────────────────────────────────────
async function handleMemory(args: string): Promise<void> {
  const [sub, ...rest] = args.split(' ');

  switch (sub || 'list') {
    case 'list':
    case 'ls': {
      const entries = await listMemory();
      console.log('');
      console.log(divider(`MEMORY (${entries.length} entries)`));
      if (entries.length === 0) {
        console.log(`  ${T.muted('No memories stored.')}`);
      } else {
        for (const e of entries.slice(-20)) {
          const ts = new Date(e.createdAt).toLocaleDateString();
          console.log(`  ${T.dim(ts)}  ${T.muted(e.type.padEnd(12))}  ${T.white(e.content.slice(0, 60))}`);
        }
      }
      console.log('');
      break;
    }

    case 'add':
    case 'save': {
      const content = rest.join(' ');
      if (!content) { console.log(`  ${T.muted('Usage: /mem add <content>')}`); break; }
      await remember(content, { source: 'user' });
      console.log(`  ${T.aurora(Sym.check)} Remembered: ${T.white(content)}`);
      break;
    }

    case 'search':
    case 'find':
    case 'recall': {
      const q = rest.join(' ');
      if (!q) { console.log(`  ${T.muted('Usage: /mem search <query>')}`); break; }
      const results = await recall(q);
      console.log('');
      console.log(divider(`MEMORY SEARCH: "${q}"`));
      if (results.length === 0) {
        console.log(`  ${T.muted('No results.')}`);
      } else {
        for (const e of results) {
          console.log(`  ${T.aura(e.type.padEnd(12))} ${T.white(e.content)}`);
        }
      }
      console.log('');
      break;
    }

    case 'clear': {
      await clearMemory();
      console.log(`  ${T.aurora(Sym.check)} Memory cleared.`);
      break;
    }

    default:
      console.log(`  ${T.muted('Commands:')} list, add <text>, search <query>, clear`);
  }
}

// ─── Profile handler ───────────────────────────────────────────────────────────
async function handleProfile(args: string, profile: UserProfile): Promise<void> {
  if (!args || args === 'view') {
    console.log('');
    console.log(divider('YOUR PROFILE'));
    console.log('');
    console.log(`  ${T.muted('Name:'.padEnd(16))} ${T.white(profile.name)}`);
    console.log(`  ${T.muted('Email:'.padEnd(16))} ${T.white(profile.email)}`);
    console.log(`  ${T.muted('Role:'.padEnd(16))} ${T.ice(profile.role)}`);
    console.log(`  ${T.muted('Purpose:'.padEnd(16))} ${T.white(profile.purpose)}`);
    console.log(`  ${T.muted('Model:'.padEnd(16))} ${T.white(profile.preferences.defaultModel)}`);
    console.log(`  ${T.muted('Email setup:'.padEnd(16))} ${profile.preferences.emailConfigured ? T.aurora('yes') : T.muted('no')}`);
    console.log('');
  } else if (args === 'edit') {
    console.log(`  ${T.muted('Use /profile set <field> <value>')}`);
    console.log(`  ${T.muted('Fields: name, email, purpose')}`);
  } else if (args.startsWith('set ')) {
    const parts = args.slice(4).split(' ');
    const field = parts[0];
    const value = parts.slice(1).join(' ');
    if (!value) { console.log(`  ${T.muted('Usage: /profile set <field> <value>')}`); return; }
    if (field === 'name') { profile.name = value; }
    else if (field === 'email') { profile.email = value; }
    else if (field === 'purpose') { profile.purpose = value; }
    else { console.log(`  ${T.nova('Unknown field.')} Valid: name, email, purpose`); return; }
    await saveProfileFn(profile);
    console.log(`  ${T.aurora(Sym.check)} Updated ${field} → ${T.white(value)}`);
  }
}

// ─── Status screen ─────────────────────────────────────────────────────────────
async function handleStatus(profile: UserProfile): Promise<void> {
  clearScreen(profile);
  console.log(divider('SYSTEM STATUS'));
  console.log('');
  const model = getActiveModel();
  console.log(`  ${T.aura('OS')}         Aura OS v1.0.0`);
  console.log(`  ${T.aura('User')}       ${T.white(profile.name)} ${T.muted('·')} ${T.ice(profile.role)}`);
  console.log(`  ${T.aura('Model')}      ${T.white(model.provider)} / ${T.white(model.model)}`);
  console.log(`  ${T.aura('Uptime')}     ${T.white(formatUptime(process.uptime()))}`);
  console.log(`  ${T.aura('Memory')}     ${T.white(Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB')} used`);

  const agentStatus = getAgentStatus();
  const running = Object.values(agentStatus).filter(Boolean).length;
  console.log(`  ${T.aura('Agents')}     ${T.aurora(String(running))} running / ${Object.keys(agentStatus).length} registered`);

  const emailConfig = await loadEmailConfig();
  console.log(`  ${T.aura('Email')}      ${emailConfig ? T.aurora('configured') : T.muted('not configured')}`);
  console.log('');
}

function formatUptime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${h}h ${m}m ${s}s`;
}

// ─── Quit ─────────────────────────────────────────────────────────────────────
async function handleQuit(): Promise<void> {
  console.clear();
  printBanner();
  console.log(T.dim('  ' + '─'.repeat(72)));
  console.log(`  ${T.aura(Sym.sparkle)}  ${T.auraBold('Session ended.')}  ${T.muted('All agents stopped. Session destroyed.')}`);
  console.log(T.dim('  ' + '─'.repeat(72)));
  console.log('');
  stopAllAgents();
  stopMcpServer();
  await disconnectAll();
  await destroySession();
  process.exit(0);
}

// ─── App / Integration handler ─────────────────────────────────────────────────
async function handleApp(args: string, rl: readline.Interface): Promise<void> {
  const parts = args.split(' ');
  const [sub, ...rest] = parts;
  const restStr = rest.join(' ').trim();

  // Use the shared readline so there's no double-echo
  const ask = (p: string): Promise<string> => new Promise(resolve => {
    rl.question(p, ans => resolve(ans.trim()));
  });

  // No args or "list" → show all integrations
  if (!sub || sub === 'list') {
    const integrations = listIntegrations();
    console.log('');
    console.log(divider('APP INTEGRATIONS'));
    console.log('');
    for (const def of integrations) {
      const connected = await isConnected(def.id);
      const status = connected ? T.aurora(Sym.check + ' connected') : T.muted('○ not connected');
      console.log(
        `  ${T.aura((def.icon + ' ' + def.name).padEnd(18))} ${status.padEnd(22)}  ${T.muted(def.description)}`
      );
    }
    console.log('');
    console.log(`  ${T.muted('Use')} ${T.aura('/app connect <id>')} ${T.muted('to set up an integration.')}`);
    console.log(`  ${T.muted('IDs:')} ${integrations.map(d => T.aura(d.id)).join(T.muted(', '))}`);
    console.log('');
    return;
  }

  // "connect <id>" → setup wizard
  if (sub === 'connect') {
    const id = restStr;
    if (!id) {
      console.log(`  ${T.muted('Usage: /app connect <id>')}`);
      return;
    }
    const def = getIntegration(id);
    if (!def) {
      console.log(`  ${T.nova(Sym.cross)} Unknown integration: ${T.white(id)}`);
      return;
    }
    console.clear();
    console.log('');
    console.log(divider(`CONNECT ${def.name.toUpperCase()}`));
    console.log('');
    console.log(`  ${T.muted(def.description)}`);
    console.log('');

    const config: Record<string, string> = {};
    for (const field of def.setupFields) {
      if (field.hint) {
        console.log(`  ${T.dim(Sym.arrow)} ${T.muted(field.hint)}`);
      }
      const value = field.secret
        ? await askHidden(`  ${T.aura(field.label)}: `)
        : await ask(`  ${T.aura(field.label)}: `);
      if (!value) {
        console.log(`  ${T.nova('Aborted — no value entered for')} ${field.label}`);
        return;
      }
      config[field.key] = value;
    }

    await saveIntegrationConfig(id, config);
    console.log('');
    console.log(`  ${T.aurora(Sym.check)} ${def.name} connected. Run ${T.aura(`/app ${id}`)} to fetch messages.`);
    console.log('');
    return;
  }

  // "disconnect <id>" → remove config
  if (sub === 'disconnect') {
    const id = restStr;
    if (!id) { console.log(`  ${T.muted('Usage: /app disconnect <id>')}`); return; }
    const def = getIntegration(id);
    if (!def) { console.log(`  ${T.nova('Unknown integration:')} ${id}`); return; }
    await deleteIntegrationConfig(id);
    console.log(`  ${T.aurora(Sym.check)} ${def.name} disconnected. Config removed.`);
    return;
  }

  // "/app <id>" or "/app <id> <subcommand> ..." → integration-specific commands
  const id = sub;
  const def = getIntegration(id);
  if (!def) {
    // Unknown — maybe they typed /app with a bad sub-command
    console.log(`  ${T.nova(Sym.cross)} Unknown command or integration: ${T.white(id)}`);
    console.log(`  ${T.muted('Use')} ${T.aura('/app list')} ${T.muted('to see available integrations.')}`);
    return;
  }

  const connected = await isConnected(id);
  if (!connected) {
    console.log(`  ${T.nova(Sym.cross)} ${def.name} is not connected.`);
    console.log(`  ${T.muted('Run')} ${T.aura(`/app connect ${id}`)} ${T.muted('to set it up.')}`);
    return;
  }

  const config = (await loadIntegrationConfig(id))!;
  const [action, ...actionRest] = rest;
  const actionRestStr = actionRest.join(' ').trim();

  // Default: no action = show messages
  if (!action || action === 'messages') {
    const spin = new Typing(`Fetching ${def.name} messages...`).start();
    try {
      const msgs = await def.fetchMessages(config, 15);
      spin.stop();
      console.log('');
      console.log(divider(`${def.icon} ${def.name.toUpperCase()} MESSAGES (${msgs.length})`));
      console.log('');
      if (msgs.length === 0) {
        console.log(`  ${T.muted('No messages found.')}`);
      } else {
        for (const m of msgs) {
          const ts = new Date(m.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          const ch = m.channel ? T.dim(`[${m.channel}]`) + ' ' : '';
          console.log(`  ${T.dim(ts)}  ${ch}${T.aurora(m.from.slice(0, 18).padEnd(18))}  ${T.white(m.text.slice(0, 60))}`);
        }
      }
      console.log('');
    } catch (err) {
      spin.stop(`  ${T.nova('Error:')} ${String(err)}`);
    }
    return;
  }

  if (action === 'send') {
    // /app <id> send <target> <text>
    const spaceIdx = actionRestStr.indexOf(' ');
    if (spaceIdx === -1) {
      console.log(`  ${T.muted(`Usage: /app ${id} send <target> <message>`)}`);
      if (id === 'github') console.log(`  ${T.muted('target = owner/repo (creates an issue)')}`);
      if (id === 'slack') console.log(`  ${T.muted('target = #channel-name or channel ID')}`);
      if (id === 'discord') console.log(`  ${T.muted('target = channel ID')}`);
      if (id === 'telegram') console.log(`  ${T.muted('target = chat ID (numeric)')}`);
      return;
    }
    const target = actionRestStr.slice(0, spaceIdx).trim();
    const text = actionRestStr.slice(spaceIdx + 1).trim();
    const spin = new Typing(`Sending to ${target}...`).start();
    try {
      await def.sendMessage(config, target, text);
      spin.stop(`  ${T.aurora(Sym.check)} Sent to ${T.white(target)}`);
    } catch (err) {
      spin.stop(`  ${T.nova('Send failed:')} ${String(err)}`);
    }
    return;
  }

  if (action === 'notify' || action === 'notifications') {
    if (!def.fetchNotifications) {
      console.log(`  ${T.muted(`${def.name} has no notifications endpoint.`)}`);
      return;
    }
    const spin = new Typing(`Fetching ${def.name} notifications...`).start();
    try {
      const msgs = await def.fetchNotifications(config);
      spin.stop();
      console.log('');
      console.log(divider(`${def.icon} ${def.name.toUpperCase()} NOTIFICATIONS (${msgs.length})`));
      console.log('');
      if (msgs.length === 0) {
        console.log(`  ${T.muted('No unread notifications.')}`);
      } else {
        for (const m of msgs) {
          const ts = new Date(m.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          const ch = m.channel ? T.dim(`[${m.channel}]`) + ' ' : '';
          console.log(`  ${T.dim(ts)}  ${ch}${T.aurora(m.from.slice(0, 20).padEnd(20))}  ${T.white(m.text.slice(0, 55))}`);
        }
      }
      console.log('');
    } catch (err) {
      spin.stop(`  ${T.nova('Error:')} ${String(err)}`);
    }
    return;
  }

  // GitHub-specific extras
  if (id === 'github') {
    if (action === 'repos') {
      const spin = new Typing('Fetching repos...').start();
      try {
        const repos = await fetchRepos(config.pat, 20);
        spin.stop();
        console.log('');
        console.log(divider('GITHUB REPOS'));
        console.log('');
        console.log(`  ${T.muted('REPO'.padEnd(35))} ${T.muted('LANG'.padEnd(14))} ${T.muted('★').padEnd(6)} ${T.muted('ISSUES')}`);
        console.log(T.dim('  ' + '─'.repeat(70)));
        for (const r of repos) {
          const lang = (r.language ?? '—').slice(0, 12);
          const stars = String(r.stargazers_count);
          const issues = String(r.open_issues_count);
          console.log(`  ${T.white(r.full_name.padEnd(35))} ${T.ice(lang.padEnd(14))} ${T.solar(stars.padEnd(6))} ${T.muted(issues)}`);
        }
        console.log('');
      } catch (err) {
        spin.stop(`  ${T.nova('Error:')} ${String(err)}`);
      }
      return;
    }

    if (action === 'issues') {
      const repo = actionRestStr;
      if (!repo) { console.log(`  ${T.muted('Usage: /app github issues <owner/repo>')}`); return; }
      const spin = new Typing(`Fetching issues for ${repo}...`).start();
      try {
        const issues = await fetchIssues(config.pat, repo, 20);
        spin.stop();
        console.log('');
        console.log(divider(`ISSUES: ${repo}`));
        console.log('');
        for (const i of issues) {
          const date = new Date(i.created_at).toLocaleDateString();
          console.log(`  ${T.dim('#' + String(i.number).padEnd(6))} ${T.white(i.title.slice(0, 55).padEnd(55))} ${T.muted(i.user.login.padEnd(16))} ${T.dim(date)}`);
        }
        console.log('');
      } catch (err) {
        spin.stop(`  ${T.nova('Error:')} ${String(err)}`);
      }
      return;
    }

    if (action === 'prs') {
      const repo = actionRestStr;
      if (!repo) { console.log(`  ${T.muted('Usage: /app github prs <owner/repo>')}`); return; }
      const spin = new Typing(`Fetching PRs for ${repo}...`).start();
      try {
        const prs = await fetchPRs(config.pat, repo, 20);
        spin.stop();
        console.log('');
        console.log(divider(`PULL REQUESTS: ${repo}`));
        console.log('');
        for (const p of prs) {
          const date = new Date(p.created_at).toLocaleDateString();
          console.log(`  ${T.dim('#' + String(p.number).padEnd(6))} ${T.white(p.title.slice(0, 55).padEnd(55))} ${T.muted(p.user.login.padEnd(16))} ${T.dim(date)}`);
        }
        console.log('');
      } catch (err) {
        spin.stop(`  ${T.nova('Error:')} ${String(err)}`);
      }
      return;
    }
  }

  // Fallthrough — show usage
  console.log('');
  console.log(`  ${T.muted('Commands for')} ${T.aura(def.name)}:`);
  console.log(`  ${T.aura(`/app ${id}`)}               ${T.muted('— fetch recent messages')}`);
  console.log(`  ${T.aura(`/app ${id} messages`)}      ${T.muted('— same as above')}`);
  console.log(`  ${T.aura(`/app ${id} send <t> <msg>`)}  ${T.muted('— send a message')}`);
  if (def.fetchNotifications) {
    console.log(`  ${T.aura(`/app ${id} notify`)}       ${T.muted('— unread notifications')}`);
  }
  if (id === 'github') {
    console.log(`  ${T.aura('/app github repos')}      ${T.muted('— list your repos')}`);
    console.log(`  ${T.aura('/app github issues <repo>')} ${T.muted('— open issues')}`);
    console.log(`  ${T.aura('/app github prs <repo>')}   ${T.muted('— open pull requests')}`);
  }
  console.log('');
}
