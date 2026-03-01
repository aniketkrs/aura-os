import { T, Sym, divider, tag } from './theme';
import type { UserProfile } from '../data/profile';
import type { Task } from '../data/tasks';

// ─── Full ASCII Banner (boot / dash / clear only) ─────────────────────────────
export function printBanner(profile?: UserProfile): void {
  const art = [
    '  ██████╗ ██████╗  ██████╗      ██╗███████╗ ██████╗████████╗     ███████╗',
    '  ██╔══██╗██╔══██╗██╔═══██╗     ██║██╔════╝██╔════╝╚══██╔══╝     ╚══███╔╝',
    '  ██████╔╝██████╔╝██║   ██║     ██║█████╗  ██║        ██║           ███╔╝ ',
    '  ██╔═══╝ ██╔══██╗██║   ██║██   ██║██╔══╝  ██║        ██║          ███╔╝  ',
    '  ██║     ██║  ██║╚██████╔╝╚█████╔╝███████╗╚██████╗   ██║         ███████╗',
    '  ╚═╝     ╚═╝  ╚═╝ ╚═════╝  ╚════╝ ╚══════╝ ╚═════╝   ╚═╝         ╚══════╝',
  ];
  for (const line of art) console.log(T.aura(line));
  console.log('');
  printStatusBar(profile);
}

// ─── Compact header — reprinted before every command output ───────────────────
export function printHeader(profile?: UserProfile): void {
  const now  = new Date();
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const left  = `${T.aura('██')} ${T.auraBold('PROJECT Z')} ${T.dim('·')} ${T.muted('AURA OS')}`;
  const mid   = profile
    ? `${T.aurora(profile.name)} ${T.dim('·')} ${T.ice(profile.role)}`
    : '';
  const right = `${T.muted(date)} ${T.dim('·')} ${T.ice(time)}`;

  const W = process.stdout.columns || 80;
  // Strip ANSI to measure true length
  const strip = (s: string) => s.replace(/\x1B\[[0-9;]*m/g, '');
  const gap   = Math.max(1, W - strip(left).length - strip(mid).length - strip(right).length - 4);
  const sp    = ' '.repeat(Math.floor(gap / 2));

  console.log('');
  console.log(`  ${left}${sp}${mid}${sp}${right}`);
  console.log(T.dim('  ' + '═'.repeat(W - 4)));
}

// ─── Status bar (used below full banner) ─────────────────────────────────────
function printStatusBar(profile?: UserProfile): void {
  const now   = new Date();
  const time  = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const date  = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const user  = profile ? `${T.aurora(profile.name)} ${T.dim('·')} ${T.ice(profile.role)} ${T.dim('·')} ` : '';
  const W     = process.stdout.columns || 80;
  console.log(`  ${T.auraBold('AURA OS')} ${T.dim('·')} ${T.muted('v1.0.0')} ${T.dim('·')} ${user}${T.muted(date)} ${T.dim('·')} ${T.ice(time)}`);
  console.log(T.dim('  ' + '═'.repeat(W - 4)));
  console.log('');
}

// ─── Boot screen ──────────────────────────────────────────────────────────────
export function bootScreen(): void {
  console.clear();
  console.log('');
  printBanner();
}

// ─── Clear screen (full banner) ───────────────────────────────────────────────
export function clearScreen(profile?: UserProfile): void {
  console.clear();
  console.log('');
  printBanner(profile);
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export function dashboardScreen(
  profile: UserProfile,
  tasks: Task[],
  agentStatus: Record<string, boolean>,
): void {
  console.clear();
  console.log('');
  printBanner(profile);

  // Tasks
  const active = tasks.filter(t => t.status !== 'done');
  console.log(`  ${T.auraBold(Sym.task + '  TASKS')}  ${T.muted(`(${active.length} active)`)}`);
  console.log('');
  if (active.length === 0) {
    console.log(`  ${T.muted(Sym.dot + '  No tasks — try')} ${T.aura('/task add <title>')}`);
  } else {
    for (const t of active.slice(0, 6)) {
      const icon = t.status === 'in-progress' ? T.aurora(Sym.arrow) : T.muted(Sym.dot);
      const prio = t.priority === 'high' ? T.nova('[!]') : t.priority === 'med' ? T.solar('[~]') : T.muted('[ ]');
      console.log(`  ${icon} ${prio} ${T.white(t.title)}  ${T.dim(t.id.slice(0, 6))}`);
    }
  }

  // Agents
  console.log('');
  console.log(T.dim('  ' + '─'.repeat(72)));
  console.log('');
  console.log(`  ${T.auraBold(Sym.agent + '  AGENTS')}`);
  console.log('');
  for (const [name, running] of Object.entries(agentStatus)) {
    const dot = running ? T.aurora('●') : T.dim('○');
    console.log(`  ${dot}  ${T.white(name.padEnd(22))} ${running ? T.aurora('running') : T.muted('idle')}`);
  }

  // Quick bar
  console.log('');
  console.log(T.dim('  ' + '─'.repeat(72)));
  console.log('');
  console.log(
    `  ` +
    ['/chat', '/task', '/mail', '/browse', '/search', '/agent', '/status', '/help', '/quit']
      .map(c => T.aura(c)).join(T.muted('  ·  '))
  );
  console.log('');
}

// ─── Help screen ──────────────────────────────────────────────────────────────
export function helpScreen(profile: UserProfile): void {
  console.clear();
  console.log('');
  printBanner(profile);

  const sections: Array<{ title: string; cmds: Array<[string, string]> }> = [
    { title: 'SHELL',   cmds: [['/dash','Dashboard'],['/clear','Clear + banner'],['/status','System info'],['/quit','Exit']] },
    { title: 'AI CHAT', cmds: [['/chat [msg]','Chat with Aura'],['/chat','Chat mode'],['/model <n>','Switch model (persists)'],['/models','List models + providers'],['/apikey <p>','Set API key (masked)'],['/ollama','Ollama status, models, pull, install']] },
    { title: 'TASKS',   cmds: [['/task list','All tasks'],['/task add <t>','New task'],['/task done <id>','Complete'],['/task start <id>','In progress'],['/task rm <id>','Delete']] },
    { title: 'EMAIL',   cmds: [['/mail inbox','Inbox'],['/mail read <n>','Read email'],['/mail send','Compose'],['/mail setup','Configure IMAP/SMTP']] },
    { title: 'BROWSER', cmds: [['/browse <url>','Open URL in terminal'],['/search <q>','Web search'],['/click <n>','Follow numbered link'],['/tab','Manage virtual tabs'],['/bookmark','Manage bookmarks'],['/history','Browse history'],['/render <src>','Render image in terminal'],['/js <code>','Run sandboxed JavaScript']] },
    { title: 'AGENTS',  cmds: [['/agent list','All agents'],['/agent status','Status'],['/agent start <n>','Start'],['/agent stop <n>','Stop'],['/agent templates','Agent templates'],['/agent create','Create custom agent'],['/agent custom','List custom agents']] },
    { title: 'MCP',     cmds: [['/mcp','MCP status overview'],['/mcp serve [port]','Start MCP server'],['/mcp stop','Stop MCP server'],['/mcp list','List MCP connections'],['/mcp add','Add MCP server'],['/mcp connect <id>','Connect to server'],['/mcp tools <id>','List server tools'],['/mcp call <id> <t>','Call tool']] },
    { title: 'APPS',    cmds: [['/app list','All integrations + status'],['/app connect <id>','Setup wizard'],['/app <id>','Fetch messages'],['/app <id> notify','Notifications'],['/app disconnect <id>','Remove config']] },
    { title: 'SYSTEM',  cmds: [['/profile','View profile'],['/keys','API key status'],['/pin','Change PIN'],['/memory','Memory store'],['/log','Agent log'],['/cal','Calendar'],['/google auth','Google OAuth (auto-configured)'],['/google status','Google connection status']] },
  ];

  for (const sec of sections) {
    console.log(divider(sec.title));
    for (const [cmd, desc] of sec.cmds) {
      console.log(`  ${T.aura(cmd.padEnd(22))} ${T.muted(desc)}`);
    }
    console.log('');
  }
}
