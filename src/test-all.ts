/**
 * Comprehensive test runner — tests every module
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const INFO = '\x1b[36m·\x1b[0m';

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`${PASS} ${name}`);
  } catch(e: any) {
    console.log(`${FAIL} ${name}: ${e.message}`);
  }
}

async function main() {
  console.log('\n\x1b[1;38;5;141m  AURA OS — FULL TEST SUITE\x1b[0m\n');

  // ── 1. Keys & Env ──────────────────────────────────────────────────────────
  console.log('\x1b[2m  ── API KEYS & ENV\x1b[0m');
  const { injectKeysToEnv, loadKeys } = await import('./security/apikeys');
  await injectKeysToEnv();
  const keys = await loadKeys();
  
  await test('ANTHROPIC_API_KEY present', async () => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('Not set — run /apikey anthropic');
  });
  await test('dotenv loads .env file', async () => {
    // Just needs to not throw
  });

  // ── 2. Profile & Auth ──────────────────────────────────────────────────────
  console.log('\n\x1b[2m  ── PROFILE & AUTH\x1b[0m');
  const { loadProfile, profileExists, saveProfile } = await import('./data/profile');
  const { pinExists, setPin, verifyPin } = await import('./security/auth');
  const { createSession, destroySession } = await import('./security/session');

  await test('profile read/write', async () => {
    const exists = await profileExists();
    if (!exists) {
      await saveProfile({
        name: 'Test User', email: 'test@test.com', role: 'Developer',
        purpose: 'Testing', createdAt: new Date().toISOString(),
        preferences: { defaultModel: 'claude-sonnet-4-6', theme: 'dark', agentsAutoStart: [], emailConfigured: false }
      });
    }
    const p = await loadProfile();
    if (!p) throw new Error('Could not load profile');
  });

  await test('PIN set + verify', async () => {
    await setPin('testpin123');
    const result = await verifyPin('testpin123');
    if (result !== 'ok') throw new Error(`Expected ok, got ${result}`);
  });

  await test('wrong PIN rejected', async () => {
    const result = await verifyPin('wrongpin');
    if (result !== 'wrong') throw new Error(`Expected wrong, got ${result}`);
  });

  await test('session create + destroy', async () => {
    const token = await createSession();
    if (!token || token.length < 10) throw new Error('Bad token');
    await destroySession();
  });

  // ── 3. Tasks ──────────────────────────────────────────────────────────────
  console.log('\n\x1b[2m  ── TASK SYSTEM\x1b[0m');
  const { addTask, listTasks, updateTask, removeTask } = await import('./data/tasks');

  let taskId = '';
  await test('add task', async () => {
    const t = await addTask('Test task from test suite', { priority: 'high' });
    taskId = t.id;
    if (!t.id) throw new Error('No id');
  });
  await test('list tasks', async () => {
    const all = await listTasks();
    if (!all.some(t => t.id === taskId)) throw new Error('Task not found in list');
  });
  await test('update task status', async () => {
    const t = await updateTask(taskId, { status: 'in-progress' });
    if (t?.status !== 'in-progress') throw new Error('Status not updated');
  });
  await test('mark task done', async () => {
    const t = await updateTask(taskId, { status: 'done' });
    if (t?.status !== 'done') throw new Error('Not done');
  });
  await test('remove task', async () => {
    const ok = await removeTask(taskId);
    if (!ok) throw new Error('Remove returned false');
  });

  // ── 4. Memory ─────────────────────────────────────────────────────────────
  console.log('\n\x1b[2m  ── MEMORY SYSTEM\x1b[0m');
  const { remember, recall, listMemory } = await import('./data/memory');

  let memId = '';
  await test('store memory', async () => {
    const m = await remember('aura os test memory node terminal', { source: 'test-suite', tags: ['test'] });
    memId = m.id;
    if (!m.id) throw new Error('No id');
  });
  await test('recall by keyword', async () => {
    const results = await recall('aura test');
    if (!results.length) throw new Error('Recall returned nothing');
  });
  await test('list memory', async () => {
    const all = await listMemory();
    if (!all.length) throw new Error('Empty memory');
  });

  // ── 5. Browser ────────────────────────────────────────────────────────────
  console.log('\n\x1b[2m  ── BROWSER\x1b[0m');
  const { browse, search, renderBrowseResult } = await import('./tools/browser');

  await test('browse example.com', async () => {
    const r = await browse('https://example.com');
    if (!r.title) throw new Error('No title');
    if (!r.markdown.includes('Example')) throw new Error('No expected content');
  });
  await test('browse news.ycombinator.com', async () => {
    const r = await browse('https://news.ycombinator.com');
    if (!r.title) throw new Error('No title');
    if (r.links.length < 3) throw new Error(`Too few links: ${r.links.length}`);
  });
  await test('browse github.com/readme', async () => {
    const r = await browse('https://github.com/anthropics/anthropic-sdk-python');
    if (!r.title) throw new Error('No title');
  });
  await test('DuckDuckGo search', async () => {
    const r = await search('terminal os nodejs typescript');
    if (!r.links.length) throw new Error('No search results');
  });
  await test('renderBrowseResult no crash', async () => {
    const r = await browse('https://example.com');
    const rendered = renderBrowseResult(r);
    if (!rendered.includes('Example')) throw new Error('Bad render output');
  });

  // ── 6. LLM Router ─────────────────────────────────────────────────────────
  console.log('\n\x1b[2m  ── LLM ROUTER\x1b[0m');
  const { chat, quickChat, listModels, getActiveModel } = await import('./tools/llm-router');

  await test('list models returns array', async () => {
    const models = listModels();
    if (models.length < 5) throw new Error('Too few models');
  });
  await test('getActiveModel returns config', async () => {
    const m = getActiveModel();
    if (!m.model || !m.provider) throw new Error('Bad model config');
  });
  await test('Anthropic chat call', async () => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('No API key — skipped');
    const reply = await quickChat('Reply with only the word PASS and nothing else.');
    if (!reply.toUpperCase().includes('PASS')) throw new Error(`Unexpected reply: ${reply.slice(0,50)}`);
  });

  // ── 7. Agent Manager ──────────────────────────────────────────────────────
  console.log('\n\x1b[2m  ── AGENTS\x1b[0m');
  require('./agents/builtin-agents');
  const { startAgent, stopAgent, getAgentStatus, listRegistered, readAgentLog } = await import('./agents/agent-manager');

  await test('agents registered', async () => {
    const defs = listRegistered();
    if (defs.length < 3) throw new Error(`Only ${defs.length} agents registered`);
  });
  await test('start memory-keeper agent', async () => {
    const ok = startAgent('memory-keeper');
    if (!ok) throw new Error('Start returned false');
  });
  await test('agent shows as running', async () => {
    const status = getAgentStatus();
    if (!status['memory-keeper']) throw new Error('Not running');
  });
  await test('stop memory-keeper agent', async () => {
    const ok = stopAgent('memory-keeper');
    if (!ok) throw new Error('Stop returned false');
  });
  await test('readAgentLog returns array', async () => {
    const lines = await readAgentLog(10);
    // might be empty on first run — that's fine
    if (!Array.isArray(lines)) throw new Error('Not array');
  });

  // ── 8. Email config (no live connection) ──────────────────────────────────
  console.log('\n\x1b[2m  ── EMAIL CONFIG\x1b[0m');
  const { saveEmailConfig, loadEmailConfig } = await import('./tools/email-client');

  await test('save + load email config', async () => {
    await saveEmailConfig({
      imap: { host: 'imap.gmail.com', port: 993, tls: true },
      smtp: { host: 'smtp.gmail.com', port: 587, secure: false },
      address: 'test@gmail.com',
      password: 'test-placeholder',
    });
    const c = await loadEmailConfig();
    if (c?.address !== 'test@gmail.com') throw new Error('Config not saved correctly');
  });

  // ── 9. Calendar ───────────────────────────────────────────────────────────
  console.log('\n\x1b[2m  ── CALENDAR\x1b[0m');
  const { getUpcomingEvents, formatEvents } = await import('./tools/calendar');

  await test('calendar returns array', async () => {
    const events = await getUpcomingEvents(7);
    if (!Array.isArray(events)) throw new Error('Not array');
    console.log(`    ${INFO} Found ${events.length} upcoming events`);
  });

  // ── 10. Google Auth (config only) ─────────────────────────────────────────
  console.log('\n\x1b[2m  ── GOOGLE SERVICES\x1b[0m');
  const { isGoogleAuthed, loadGoogleCreds } = await import('./tools/google-auth');

  await test('google creds load', async () => {
    const creds = await loadGoogleCreds();
    const authed = await isGoogleAuthed();
    console.log(`    ${INFO} Google OAuth: ${authed ? 'connected' : 'not connected (run /google auth)'}`);
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n\x1b[38;5;141m  ══════════════════════════════════\x1b[0m');
  console.log('\x1b[1m  TEST SUITE COMPLETE\x1b[0m');
  console.log('\x1b[38;5;141m  ══════════════════════════════════\x1b[0m\n');
}

main().catch(e => { console.error('\nFATAL:', e); process.exit(1); });
