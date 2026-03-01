/**
 * Agent Banner — unique ASCII art per agent + dino animation + greeting system.
 * Every agent has its own icon art and color. Boot shows a cute animated dino.
 */
import { T, Sym, Colors } from './theme';
import chalk from 'chalk';

// ─── Cute Dino ASCII Art ──────────────────────────────────────────────────────
const DINO_FRAMES = [
    [
        '               __',
        '              / _)',
        '     _.----._/ /',
        '    /         /',
        ' __/ (  | (  |',
        '/__.-\'|_|--|_|',
    ],
    [
        '               __',
        '              / _)',
        '     _.----._/ /',
        '    /         /',
        ' __/ (  | (  |',
        '/__.-\'|_|--|_|',
        '    🌿',
    ],
    [
        '               __',
        '              / _) 💬',
        '     _.----._/ /',
        '    /         /',
        ' __/ (  | (  |',
        '/__.-\'|_|--|_|',
    ],
];

// ─── Walking Dino (animated) ──────────────────────────────────────────────────
const WALK_FRAMES = [
    [
        '            ▄▄▄',
        '           ▀█ █',
        '     ▄▀▀▀▀▀ █',
        '    █  ▄▄  ▀▀▀▀▄',
        ' ▄▄█ █  █    ▄ █',
        '█   ▀▀  ▀▀▀▀▀ █▀',
        ' █ ▄   ▄ █',
        '  ▀█   █▀',
    ],
    [
        '            ▄▄▄',
        '           ▀█ █',
        '     ▄▀▀▀▀▀ █',
        '    █  ▄▄  ▀▀▀▀▄',
        ' ▄▄█ █  █    ▄ █',
        '█   ▀▀  ▀▀▀▀▀ █▀',
        '  █ ▄  ▄  █',
        '   ▀█  █▀',
    ],
];

// ─── Unique Agent ASCII Art ───────────────────────────────────────────────────
const AGENT_ART: Record<string, { art: string[]; color: (s: string) => string; emoji: string; greeting: string }> = {
    'aura': {
        art: [
            '     ╭─────────────────╮',
            '     │  ✦  A U R A  ✦  │',
            '     ╰─────────────────╯',
            '         ╱  ╲',
            '        ╱ ◉◉ ╲',
            '       ╱  ▽▽  ╲',
            '      ╱________╲',
            '       ║      ║',
            '       ╚══════╝',
        ],
        color: T.aura,
        emoji: '✦',
        greeting: 'Hey there! I\'m Aura, your OS assistant. What can I help you with?',
    },
    'memory-keeper': {
        art: [
            '    ╔═══════════════╗',
            '    ║  ⬡  MEMORY  ⬡ ║',
            '    ╚═══════════════╝',
            '      ┌──────────┐',
            '      │ ░░░░░░░░ │',
            '      │ █▓▒░  ▒█ │',
            '      │ ░░▒▓██▓░ │',
            '      └──────────┘',
        ],
        color: T.aurora,
        emoji: '⬡',
        greeting: 'Memory Keeper online. I\'ll remember everything for you. 🧠',
    },
    'task-tracker': {
        art: [
            '    ╔═══════════════╗',
            '    ║  ◈  TASKS  ◈  ║',
            '    ╚═══════════════╝',
            '      ☑ ─────────',
            '      ☐ ─────────',
            '      ☐ ─────────',
            '      ☑ ─────────',
        ],
        color: T.solar,
        emoji: '◈',
        greeting: 'Task Tracker activated! Let\'s get things done. ✅',
    },
    'research-agent': {
        art: [
            '    ╔═══════════════╗',
            '    ║ 🔍 RESEARCH 🔍║',
            '    ╚═══════════════╝',
            '        ╭───╮',
            '       (  ◎  )',
            '        ╰─┬─╯',
            '       ┌──┴──┐',
            '       │SCAN │',
            '       └─────┘',
        ],
        color: T.ice,
        emoji: '🔍',
        greeting: 'Research Agent here. I\'ll dig deep and find what you need. 📚',
    },
    'briefing-agent': {
        art: [
            '    ╔═══════════════╗',
            '    ║ 📋 BRIEFING 📋║',
            '    ╚═══════════════╝',
            '      ┌──────────┐',
            '      │ ● Today   │',
            '      │ ● Key pts │',
            '      │ ● Action  │',
            '      └──────────┘',
        ],
        color: T.aurora,
        emoji: '📋',
        greeting: 'Good day! Your briefing agent is ready. Let me catch you up. 📰',
    },
    'calendar-agent': {
        art: [
            '    ╔═══════════════╗',
            '    ║ 📅 CALENDAR 📅║',
            '    ╚═══════════════╝',
            '      ┌──────────┐',
            '      │ Mo Tu We  │',
            '      │  1  2 [3] │',
            '      │  4  5  6  │',
            '      └──────────┘',
        ],
        color: T.ice,
        emoji: '📅',
        greeting: 'Calendar Agent ready! Let me check your schedule. 🗓️',
    },
    'writing-agent': {
        art: [
            '    ╔═══════════════╗',
            '    ║ ✏️  WRITING  ✏️ ║',
            '    ╚═══════════════╝',
            '       ╱╲',
            '      ╱  ╲',
            '     ╱ ✎  ╲',
            '    ╱______╲',
            '       ││',
        ],
        color: T.aurora,
        emoji: '✏️',
        greeting: 'Writing Agent activated. Let\'s craft something beautiful! ✍️',
    },
    'study-agent': {
        art: [
            '    ╔═══════════════╗',
            '    ║ 📖  STUDY  📖 ║',
            '    ╚═══════════════╝',
            '       ┌────┐',
            '      ╱│    │╲',
            '     ╱ │ 📖 │ ╲',
            '    ╱  │    │  ╲',
            '   ╱───┴────┴───╲',
        ],
        color: T.ice,
        emoji: '📖',
        greeting: 'Study Agent here! Let\'s learn something new today. 🎓',
    },
};

// ─── Default agent art for unknown agents ─────────────────────────────────────
const DEFAULT_AGENT_ART = {
    art: [
        '    ╔═══════════════╗',
        '    ║  ◎  AGENT  ◎  ║',
        '    ╚═══════════════╝',
        '        ╭───╮',
        '       ( ◉ ◉ )',
        '        ╰───╯',
        '       ┌──┴──┐',
        '       │ RUN │',
        '       └─────┘',
    ],
    color: T.aura,
    emoji: '◎',
    greeting: 'Agent online and ready to assist! 🤖',
};

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Animated dino boot sequence — cute walking dino with typing effect.
 */
export async function playDinoAnimation(): Promise<void> {
    const dinoColor = chalk.hex('#6EE7B7'); // aurora green

    // Show cute dino
    console.log('');
    for (const line of DINO_FRAMES[0]) {
        console.log('  ' + dinoColor(line));
    }
    console.log('');

    // Dino "speaks" with typing effect
    const messages = [
        '🦕 Rawr! Booting up Aura OS...',
        '🦕 Loading your workspace...',
        '🦕 Almost ready!',
    ];

    for (const msg of messages) {
        await typeText('    ' + T.aurora(msg), 30);
        await sleep(300);
    }
    console.log('');
}

/**
 * Type text character by character for a typing effect.
 */
async function typeText(text: string, delayMs: number = 40): Promise<void> {
    // We need to handle ANSI codes properly — write them instantly
    const chars = text.split('');
    let i = 0;
    while (i < chars.length) {
        // Detect ANSI escape sequence start
        if (chars[i] === '\x1B') {
            // Write entire escape sequence at once
            let seq = '';
            while (i < chars.length && (seq.length < 2 || !chars[i - 1]?.match(/[A-Za-z]/))) {
                seq += chars[i];
                i++;
            }
            process.stdout.write(seq);
        } else {
            process.stdout.write(chars[i]);
            i++;
            await sleep(delayMs);
        }
    }
    process.stdout.write('\n');
}

/**
 * Show a unique banner for a specific agent.
 */
export function showAgentBanner(name: string): void {
    const agent = AGENT_ART[name] || {
        ...DEFAULT_AGENT_ART,
        art: DEFAULT_AGENT_ART.art.map(l => l.replace('AGENT', name.toUpperCase().slice(0, 5).padEnd(5))),
    };

    console.log('');
    for (const line of agent.art) {
        console.log('  ' + agent.color(line));
    }
    console.log('');
    console.log('  ' + agent.color(`${agent.emoji} ${agent.greeting}`));
    console.log('');
}

/**
 * Print a generic text banner (for entering modes like AURA CHAT).
 */
export function printAgentBanner(name: string, colorFn?: (s: string) => string): void {
    const agent = AGENT_ART[name.toLowerCase()];
    if (agent) {
        showAgentBanner(name.toLowerCase());
        return;
    }

    // Fallback: render using block letters
    const color = colorFn || T.aura;
    const rows = renderBannerText(name);
    console.log('');
    for (const row of rows) {
        console.log('  ' + color(row));
    }
    console.log('');
}

// ─── Block Letter Font (5 lines tall) — used for unknown names ────────────────
const FONT: Record<string, string[]> = {
    'A': ['█████', '█   █', '█████', '█   █', '█   █'],
    'B': ['████ ', '█   █', '████ ', '█   █', '████ '],
    'C': ['█████', '█    ', '█    ', '█    ', '█████'],
    'D': ['████ ', '█   █', '█   █', '█   █', '████ '],
    'E': ['█████', '█    ', '████ ', '█    ', '█████'],
    'F': ['█████', '█    ', '████ ', '█    ', '█    '],
    'G': ['█████', '█    ', '█ ███', '█   █', '█████'],
    'H': ['█   █', '█   █', '█████', '█   █', '█   █'],
    'I': ['█████', '  █  ', '  █  ', '  █  ', '█████'],
    'J': ['█████', '    █', '    █', '█   █', '█████'],
    'K': ['█   █', '█  █ ', '███  ', '█  █ ', '█   █'],
    'L': ['█    ', '█    ', '█    ', '█    ', '█████'],
    'M': ['█   █', '██ ██', '█ █ █', '█   █', '█   █'],
    'N': ['█   █', '██  █', '█ █ █', '█  ██', '█   █'],
    'O': ['█████', '█   █', '█   █', '█   █', '█████'],
    'P': ['█████', '█   █', '█████', '█    ', '█    '],
    'Q': ['█████', '█   █', '█ █ █', '█  █ ', '████ '],
    'R': ['█████', '█   █', '█████', '█  █ ', '█   █'],
    'S': ['█████', '█    ', '█████', '    █', '█████'],
    'T': ['█████', '  █  ', '  █  ', '  █  ', '  █  '],
    'U': ['█   █', '█   █', '█   █', '█   █', '█████'],
    'V': ['█   █', '█   █', '█   █', ' █ █ ', '  █  '],
    'W': ['█   █', '█   █', '█ █ █', '██ ██', '█   █'],
    'X': ['█   █', ' █ █ ', '  █  ', ' █ █ ', '█   █'],
    'Y': ['█   █', ' █ █ ', '  █  ', '  █  ', '  █  '],
    'Z': ['█████', '   █ ', '  █  ', ' █   ', '█████'],
    '-': ['     ', '     ', '█████', '     ', '     '],
    ' ': ['  ', '  ', '  ', '  ', '  '],
};

function renderBannerText(name: string): string[] {
    const upper = name.toUpperCase();
    const rows: string[] = ['', '', '', '', ''];
    for (const ch of upper) {
        const glyph = FONT[ch] || FONT[' '];
        for (let r = 0; r < 5; r++) {
            rows[r] += (glyph[r] || '') + ' ';
        }
    }
    return rows;
}

// ─── Time-aware Greetings ─────────────────────────────────────────────────────
function getTimeGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 5) return '🌙 Working late? ';
    if (hour < 12) return '☀️ Good morning! ';
    if (hour < 17) return '🌤️ Good afternoon! ';
    if (hour < 21) return '🌅 Good evening! ';
    return '🌙 Burning the midnight oil? ';
}

function getRandomTip(): string {
    const tips = [
        `Type naturally — "${T.aura('check my mail')}" just works!`,
        `Try "${T.aura('show my tasks')}" instead of /task list`,
        `Say "${T.aura('search for anything')}" to search the web`,
        `Use "${T.aura('/chat')}" for a full conversation with me`,
        `Need help? Just type "${T.aura('help')}"!`,
        `Type "${T.aura('show dashboard')}" for an overview`,
        `Say "${T.aura('who am I')}" to see your profile`,
    ];
    return tips[Math.floor(Math.random() * tips.length)];
}

/**
 * Boot greeting — shown once after login. Aura speaks first!
 */
export async function showBootGreeting(name: string): Promise<void> {
    const greeting = getTimeGreeting();
    const tip = getRandomTip();

    console.log('');
    console.log(T.dim('  ╭────────────────────────────────────────────────────────────╮'));
    console.log(T.dim('  │') + T.aura('  ✦ ') + T.auraBold('  AURA') + '                                                ' + T.dim('│'));
    console.log(T.dim('  ├────────────────────────────────────────────────────────────┤'));

    // Greeting line
    const greetLine = `  ${greeting}${T.white(name)}! Welcome back.`;
    console.log(T.dim('  │') + greetLine + ' '.repeat(Math.max(1, 60 - stripAnsi(greetLine).length)) + T.dim('│'));

    // Tip line
    const tipLine = `  💡 ${T.muted('Tip:')} ${tip}`;
    console.log(T.dim('  │') + tipLine + ' '.repeat(Math.max(1, 60 - stripAnsi(tipLine).length)) + T.dim('│'));

    console.log(T.dim('  │') + ' '.repeat(60) + T.dim('│'));
    console.log(T.dim('  │') + `  ${T.muted('Type anything to get started, or')} ${T.aura('/help')} ${T.muted('for commands.')}` + '  ' + T.dim('│'));
    console.log(T.dim('  ╰────────────────────────────────────────────────────────────╯'));
    console.log('');
}

// eslint-disable-next-line no-control-regex
function stripAnsi(s: string): string {
    return s.replace(/\x1B\[[0-9;]*m/g, '');
}
