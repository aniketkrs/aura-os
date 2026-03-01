import chalk from 'chalk';

// ─── Color Palette ────────────────────────────────────────────────────────────
export const Colors = {
  aura:    '#A78BFA',   // Purple — brand accent
  aurora:  '#6EE7B7',   // Teal-green — success/active
  solar:   '#FCD34D',   // Amber — warning/highlight
  nova:    '#F87171',   // Red — error/alert
  ice:     '#93C5FD',   // Light blue — info
  ghost:   '#4B5563',   // Dark gray — muted bg
  muted:   '#6B7280',   // Gray — secondary text
  dim:     '#374151',   // Very dark — dividers
  white:   '#F9FAFB',   // Near-white text
  black:   '#111827',   // Near-black bg
};

// ─── Text Formatters ──────────────────────────────────────────────────────────
export const T = {
  aura:    (s: string) => chalk.hex(Colors.aura)(s),
  aurora:  (s: string) => chalk.hex(Colors.aurora)(s),
  solar:   (s: string) => chalk.hex(Colors.solar)(s),
  nova:    (s: string) => chalk.hex(Colors.nova)(s),
  ice:     (s: string) => chalk.hex(Colors.ice)(s),
  muted:   (s: string) => chalk.hex(Colors.muted)(s),
  white:   (s: string) => chalk.hex(Colors.white)(s),
  bold:    (s: string) => chalk.bold(s),
  dim:     (s: string) => chalk.dim(s),
  italic:  (s: string) => chalk.italic(s),
  under:   (s: string) => chalk.underline(s),
  auraBold:(s: string) => chalk.bold.hex(Colors.aura)(s),
  auroraB: (s: string) => chalk.bold.hex(Colors.aurora)(s),
  solarB:  (s: string) => chalk.bold.hex(Colors.solar)(s),
  novaB:   (s: string) => chalk.bold.hex(Colors.nova)(s),
  iceB:    (s: string) => chalk.bold.hex(Colors.ice)(s),
};

// ─── Symbols ──────────────────────────────────────────────────────────────────
export const Sym = {
  sparkle:  '✦',
  dot:      '·',
  arrow:    '›',
  arrowL:   '‹',
  bullet:   '•',
  check:    '✓',
  cross:    '✗',
  warn:     '⚠',
  info:     'ℹ',
  lock:     '⬡',
  key:      '⚿',
  mail:     '✉',
  globe:    '⊕',
  task:     '◈',
  agent:    '◎',
  brain:    '⬡',
  dash:     '─',
  pipe:     '│',
  corner:   '╭',
  cornerBR: '╰',
  cornerTR: '╮',
  cornerBL: '╯',
  tee:      '├',
  teeR:     '┤',
  cross4:   '┼',
};

// ─── Box Drawing ──────────────────────────────────────────────────────────────
const W = process.stdout.columns || 80;

export function boxLine(label?: string, color: keyof typeof T = 'aura'): string {
  if (!label) {
    return T.dim('─'.repeat(W));
  }
  const fn = T[color] as (s: string) => string;
  const inner = ` ${fn(label)} `;
  const sides = Math.max(2, Math.floor((W - inner.length - 2) / 2));
  const line = T.dim('─'.repeat(sides));
  return `${line}${inner}${line}`;
}

export function box(title: string, lines: string[], color: keyof typeof T = 'aura'): string {
  const fn = T[color] as (s: string) => string;
  const border = fn;
  const innerW = W - 4;
  const titleLine = ` ${T.bold(title)} `;
  const top = `${border(Sym.corner)}${border('─'.repeat(Math.max(0, innerW - titleLine.length + 4)))}${T.muted(titleLine)}${border(Sym.cornerTR)}`;
  const body = lines.map(l => `${border(Sym.pipe)} ${l.padEnd(innerW)} ${border(Sym.pipe)}`);
  const bot = `${border(Sym.cornerBR)}${'─'.repeat(innerW + 2)}${border(Sym.cornerBL)}`;
  // simplified box
  const w = Math.min(W - 2, 76);
  const hr = '─'.repeat(w);
  const pad = (s: string) => {
    const raw = s.replace(/\x1B\[[0-9;]*m/g, '');
    const diff = s.length - raw.length;
    return s.padEnd(w + diff - 2);
  };
  const t = `${fn(Sym.corner + '─')} ${T.bold(title)} ${fn('─'.repeat(Math.max(0, w - title.length - 4)) + Sym.cornerTR)}`;
  const rows = lines.map(l => `${fn(Sym.pipe)} ${pad(l)} ${fn(Sym.pipe)}`);
  const b = `${fn(Sym.cornerBR + hr + Sym.cornerBL)}`;
  return [t, ...rows, b].join('\n');
}

export function header(title: string, subtitle?: string): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(boxLine());
  lines.push(`  ${T.auraBold(Sym.sparkle + '  ' + title + '  ' + Sym.sparkle)}`);
  if (subtitle) lines.push(`  ${T.muted(subtitle)}`);
  lines.push(boxLine());
  lines.push('');
  return lines.join('\n');
}

export function statusLine(label: string, value: string, status: 'ok' | 'warn' | 'error' | 'info' = 'ok'): string {
  const icons = { ok: T.aurora(Sym.check), warn: T.solar(Sym.warn), error: T.nova(Sym.cross), info: T.ice(Sym.info) };
  return `  ${icons[status]}  ${T.muted(label.padEnd(18))} ${T.white(value)}`;
}

export function divider(label?: string): string {
  if (!label) return T.dim('  ' + Sym.dash.repeat(W - 4));
  return T.dim(`  ${'─'.repeat(4)}`) + T.muted(` ${label} `) + T.dim('─'.repeat(Math.max(0, W - label.length - 12)));
}

export function tag(text: string, color: keyof typeof T = 'aura'): string {
  const fn = T[color] as (s: string) => string;
  return fn(`[${text}]`);
}

export function prompt(role: string): string {
  return `${T.aura(Sym.sparkle)} ${T.auraBold('aura')} ${T.muted(`(${role})`)} ${T.dim('›')} `;
}

// ─── Typing/Spinner wrapper ───────────────────────────────────────────────────
export class Typing {
  private frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  private i = 0;
  private iv: NodeJS.Timeout | null = null;
  private label: string;

  constructor(label: string) {
    this.label = label;
  }

  start(): this {
    process.stdout.write('\x1B[?25l'); // hide cursor
    this.iv = setInterval(() => {
      process.stdout.write(`\r${T.aura(this.frames[this.i % this.frames.length])} ${T.muted(this.label)}`);
      this.i++;
    }, 80);
    return this;
  }

  update(label: string): void {
    this.label = label;
  }

  stop(finalMsg?: string): void {
    if (this.iv) { clearInterval(this.iv); this.iv = null; }
    process.stdout.write('\r\x1B[K'); // clear line
    process.stdout.write('\x1B[?25h'); // show cursor
    if (finalMsg) console.log(finalMsg);
  }
}
