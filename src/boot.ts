#!/usr/bin/env node
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });
// Also try cwd
dotenv.config({ path: path.join(process.cwd(), '.env') });

import { T, Sym, boxLine, Typing } from './tui/theme';
import { bootScreen } from './tui/screens';
import { playDinoAnimation } from './tui/agent-banner';
import { pinExists, verifyPin, getLockoutRemaining, askHidden } from './security/auth';
import { createSession, destroySession } from './security/session';
import { profileExists, loadProfile } from './data/profile';
import { runOnboarding } from './security/onboarding';
import { setModel, type ModelProvider } from './tools/llm-router';
import { injectKeysToEnv } from './security/apikeys';
import { startInteractive } from './interactive';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function handlePinAuth(): Promise<boolean> {
  const locked = await getLockoutRemaining();
  if (locked > 0) {
    const mins = Math.ceil(locked / 60000);
    console.log('');
    console.log(`  ${T.nova(Sym.lock + '  LOCKED')}  ${T.muted(`Try again in ${mins} min.`)}`);
    console.log('');
    return false;
  }

  for (let attempt = 1; attempt <= 5; attempt++) {
    const pin = await askHidden(`  ${T.aura(Sym.key)} PIN: `);
    const result = await verifyPin(pin);
    if (result === 'ok') return true;
    if (result === 'locked') {
      const mins = Math.ceil((await getLockoutRemaining()) / 60000);
      console.log(`  ${T.nova('Locked.')} Try again in ${mins} min.`);
      return false;
    }
    const left = 5 - attempt;
    if (left > 0) console.log(`  ${T.nova('Wrong PIN.')} ${T.muted(`${left} attempt(s) left.`)}`);
  }
  return false;
}

async function main() {
  bootScreen();

  // Cute dino welcome animation
  await playDinoAnimation();

  const spin = new Typing('Initializing...').start();
  await injectKeysToEnv(); // load stored API keys before anything else
  await sleep(500);
  spin.stop();

  const hasPin = await pinExists();
  const hasProfile = await profileExists();

  // ── First launch: full onboarding ──────────────────────────────────────────
  if (!hasPin || !hasProfile) {
    const profile = await runOnboarding();
    await createSession();
    await startInteractive(profile);
    return;
  }

  // ── Every launch: PIN required ─────────────────────────────────────────────
  console.log('');
  console.log(boxLine('AUTHENTICATION', 'aura'));
  console.log('');

  const ok = await handlePinAuth();
  if (!ok) {
    console.log(`  ${T.nova('Access denied.')}`);
    console.log('');
    console.log(`  ${T.muted('Forgot your PIN? Run:')} ${T.aura('npm run reset-pin')}`);
    console.log('');
    process.exit(1);
  }

  const profile = await loadProfile();
  if (!profile) {
    console.log(`  ${T.nova('Profile missing. Delete ~/.aura and restart.')}`);
    process.exit(1);
  }

  // Restore preferred model from profile
  if (profile.preferences.defaultModel) {
    const { listModels } = await import('./tools/llm-router');
    const match = listModels().find(m => m.model === profile.preferences.defaultModel);
    if (match) setModel(match.provider as ModelProvider, match.model);
  }

  // ── Boot-time provider health check ─────────────────────────────────────
  {
    const { getActiveModel, listModels: lm } = await import('./tools/llm-router');
    const active = getActiveModel();
    const providerKeyMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      gemini: 'GEMINI_API_KEY',
      mistral: 'MISTRAL_API_KEY',
    };
    if (active.provider !== 'ollama') {
      const envKey = providerKeyMap[active.provider];
      if (envKey && !process.env[envKey]) {
        // Active provider has no key — try to find one that does
        let switched = false;
        for (const [prov, ek] of Object.entries(providerKeyMap)) {
          if (prov === active.provider) continue;
          if (process.env[ek]) {
            const models = lm().filter(m => m.provider === prov);
            if (models.length > 0) {
              setModel(prov as ModelProvider, models[0].model);
              console.log(`  ${T.solar(Sym.warn)} ${T.white(active.provider)} has no API key — auto-switched to ${T.aurora(prov + '/' + models[0].model)}`);
              switched = true;
              break;
            }
          }
        }
        if (!switched) {
          console.log('');
          console.log(`  ${T.solar(Sym.warn)} No valid API keys found.`);
          console.log(`  ${T.muted('Set one with:')} ${T.aura('/apikey gemini')} ${T.muted('or')} ${T.aura('/apikey openai')} ${T.muted('or')} ${T.aura('/apikey mistral')}`);
          console.log(`  ${T.muted('Or use local AI:')} ${T.aura('/ollama install')}`);
          console.log('');
        }
      }
    }
  }

  await createSession();

  const { getActiveModel: gam } = await import('./tools/llm-router');
  const currentModel = gam();
  const spin2 = new Typing(`Loading ${profile.name}...`).start();
  await sleep(350);
  spin2.stop(`  ${T.aurora(Sym.check)} ${T.auraBold(profile.name)}  ${T.dim('·')}  ${T.ice(profile.role)}  ${T.dim('·')}  ${T.muted(currentModel.provider + '/' + currentModel.model)}`);
  console.log('');

  await startInteractive(profile);
}

main().catch(err => {
  console.error(`\n  ${T.nova('FATAL:')} ${err.message}`);
  destroySession().finally(() => process.exit(1));
});
