/**
 * One-shot setup: npx ts-node src/setup.ts
 * Interactive — prompts for all config including API key (masked)
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as readline from 'readline';
dotenv.config({ path: path.join(__dirname, '../.env') });

import { setPin } from './security/auth';
import { saveProfile, type UserProfile, type Role } from './data/profile';
import { saveKey } from './security/apikeys';
import { T, Sym, boxLine, divider } from './tui/theme';
import { askHidden } from './security/auth';

const ROLES: Role[] = ['Developer','Researcher','Executive','Product Manager','Project Manager','Designer','Student','Writer','Other'];

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => { rl.question(prompt, ans => { rl.close(); r(ans.trim()); }); });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.clear();
  console.log('');
  console.log(boxLine('AURA OS — QUICK SETUP', 'aura'));
  console.log('');
  console.log(`  ${T.muted('Running interactive setup. All sensitive input is masked.')}`);
  console.log('');

  // Name
  const name = await ask(`  ${T.aura(Sym.arrow)} Your name: `) || 'User';

  // Email
  const email = await ask(`  ${T.aura(Sym.arrow)} Your email: `);

  // Role
  console.log('');
  ROLES.forEach((r, i) => console.log(`  ${T.aura(String(i+1).padStart(2))}  ${T.white(r)}`));
  console.log('');
  let role: Role = 'Developer';
  while (true) {
    const c = await ask(`  ${T.aura(Sym.arrow)} Role (1-${ROLES.length}): `);
    const i = parseInt(c) - 1;
    if (i >= 0 && i < ROLES.length) { role = ROLES[i]; break; }
  }

  // PIN
  console.log('');
  let pin = '';
  while (true) {
    const p1 = await askHidden(`  ${T.aura(Sym.key)} Create PIN (min 4 chars): `);
    if (p1.length < 4) { console.log(`  ${T.nova('Too short.')}`); continue; }
    const p2 = await askHidden(`  ${T.aura(Sym.key)} Confirm PIN: `);
    if (p1 !== p2) { console.log(`  ${T.nova('No match.')}`); continue; }
    pin = p1; break;
  }

  // Anthropic API key
  console.log('');
  console.log(divider('ANTHROPIC API KEY'));
  console.log(`  ${T.muted('Get it at:')} ${T.ice('console.anthropic.com → API Keys')}`);
  console.log(`  ${T.muted('Stored encrypted in ~/.aura/.keys.json — never echoed')}`);
  console.log('');
  const apiKey = await askHidden(`  ${T.aura(Sym.key)} Paste Anthropic API key (or Enter to skip): `);

  // Google API key
  console.log('');
  const gKey = await askHidden(`  ${T.aura(Sym.key)} Paste Google API key (or Enter to skip): `);

  // Save everything
  const profile: UserProfile = {
    name, email, role,
    purpose: `${role} using Aura OS`,
    createdAt: new Date().toISOString(),
    preferences: {
      defaultModel: 'claude-sonnet-4-6',
      theme: 'dark',
      agentsAutoStart: [],
      emailConfigured: false,
    },
  };

  await saveProfile(profile);
  await setPin(pin);
  if (apiKey.trim()) {
    await saveKey('ANTHROPIC_API_KEY', apiKey.trim());
    process.env.ANTHROPIC_API_KEY = apiKey.trim();
  }
  if (gKey.trim()) {
    await saveKey('GOOGLE_API_KEY', gKey.trim());
  }

  console.log('');
  console.log(boxLine('SETUP COMPLETE', 'aurora'));
  console.log('');
  console.log(`  ${T.aurora(Sym.check)} Profile: ${T.white(name)} · ${T.ice(role)}`);
  console.log(`  ${T.aurora(Sym.check)} PIN: configured`);
  console.log(`  ${T.aurora(Sym.check)} Anthropic key: ${apiKey.trim() ? T.aurora('saved') : T.muted('skipped')}`);
  console.log(`  ${T.aurora(Sym.check)} Google key: ${gKey.trim() ? T.aurora('saved') : T.muted('skipped')}`);
  console.log('');
  console.log(`  ${T.muted('Run')} ${T.aura('npm start')} ${T.muted('to launch Aura OS')}`);
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
