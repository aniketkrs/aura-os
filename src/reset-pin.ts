/**
 * PIN Reset — identity verified by name + email from profile
 * Run: npm run reset-pin
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as readline from 'readline';
dotenv.config({ path: path.join(__dirname, '../.env') });

import { T, Sym, boxLine, divider } from './tui/theme';
import { askHidden } from './security/auth';
import { setPin } from './security/auth';
import { loadProfile, profileExists } from './data/profile';

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => { rl.question(prompt, ans => { rl.close(); r(ans.trim()); }); });
}

async function main() {
  console.clear();
  console.log('');
  console.log(boxLine('AURA OS — PIN RESET', 'nova'));
  console.log('');
  console.log(`  ${T.muted('To reset your PIN, verify your identity first.')}`);
  console.log(`  ${T.muted('Your name and email must match your saved profile.')}`);
  console.log('');

  // Check profile exists
  if (!(await profileExists())) {
    console.log(`  ${T.nova('No profile found.')} Run ${T.aura('npm run setup')} to create one.`);
    process.exit(1);
  }

  const profile = await loadProfile();
  if (!profile) {
    console.log(`  ${T.nova('Could not load profile.')} Delete ~/.aura and run ${T.aura('npm run setup')}.`);
    process.exit(1);
  }

  // Identity verification
  console.log(divider('IDENTITY VERIFICATION'));
  console.log('');

  const name = await ask(`  ${T.aura(Sym.arrow)} Your name: `);
  const email = await ask(`  ${T.aura(Sym.arrow)} Your email: `);

  const nameMatch  = name.trim().toLowerCase()  === profile.name.toLowerCase();
  const emailMatch = email.trim().toLowerCase() === profile.email.toLowerCase();

  if (!nameMatch || !emailMatch) {
    console.log('');
    console.log(`  ${T.nova(Sym.cross + '  Identity verification failed.')}`);
    console.log(`  ${T.muted('Name and email must exactly match your profile.')}`);
    console.log('');
    process.exit(1);
  }

  console.log(`  ${T.aurora(Sym.check)} Identity verified — ${T.white(profile.name)}`);
  console.log('');

  // Set new PIN
  console.log(divider('SET NEW PIN'));
  console.log('');

  let newPin = '';
  while (true) {
    const p1 = await askHidden(`  ${T.aura(Sym.key)} New PIN (min 4 chars): `);
    if (p1.length < 4) {
      console.log(`  ${T.nova('Too short.')} Must be at least 4 characters.`);
      continue;
    }
    const p2 = await askHidden(`  ${T.aura(Sym.key)} Confirm new PIN:       `);
    if (p1 !== p2) {
      console.log(`  ${T.nova("PINs don't match.")} Try again.`);
      continue;
    }
    newPin = p1;
    break;
  }

  await setPin(newPin);

  console.log('');
  console.log(boxLine('PIN RESET COMPLETE', 'aurora'));
  console.log('');
  console.log(`  ${T.aurora(Sym.check)} New PIN saved securely.`);
  console.log(`  ${T.muted('Run')} ${T.aura('npm start')} ${T.muted('to launch Aura OS.')}`);
  console.log('');
}

main().catch(e => { console.error(`\n  ${T.nova('Error:')} ${e.message}`); process.exit(1); });
