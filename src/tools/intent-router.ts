/**
 * Natural Language Intent Router
 * 
 * Detects user intent from natural language and maps to slash commands.
 * Uses simple keyword matching — no LLM call needed = instant response.
 * Falls through to null if no intent matches (chat as normal).
 */

export interface DetectedIntent {
    command: string;   // e.g., '/mail'
    args: string;      // e.g., 'inbox'
    display: string;   // human-readable description, e.g., "Opening inbox..."
}

interface IntentPattern {
    keywords: RegExp;
    command: string;
    args: string | ((match: RegExpMatchArray, input: string) => string);
    display: string;
}

const INTENT_PATTERNS: IntentPattern[] = [
    // ── Mail ────────────────────────────────────────────────────────────────────
    {
        keywords: /\b(check|show|open|read|get|view|see)\b.+\b(mail|email|inbox|messages)\b/i,
        command: '/mail', args: 'inbox',
        display: 'Opening inbox...',
    },
    {
        keywords: /\b(any|new|unread)\b.+\b(mail|email|messages)\b/i,
        command: '/mail', args: 'inbox',
        display: 'Checking for new emails...',
    },
    {
        keywords: /\b(send|compose|write|draft)\b.+\b(mail|email|message)\b/i,
        command: '/mail', args: 'send',
        display: 'Opening email composer...',
    },
    {
        keywords: /^(mail|email|inbox)\s*$/i,
        command: '/mail', args: 'inbox',
        display: 'Opening inbox...',
    },

    // ── Tasks ───────────────────────────────────────────────────────────────────
    {
        keywords: /\b(show|list|view|see|what)\b.+\b(task|todo|to-do|my list)\b/i,
        command: '/task', args: 'list',
        display: 'Listing tasks...',
    },
    {
        keywords: /\b(add|create|new)\b\s+\b(task|todo)\b[:\s]+(.+)/i,
        command: '/task',
        args: (match) => `add ${match[3]?.trim() || ''}`,
        display: 'Adding task...',
    },
    {
        keywords: /^(tasks|my tasks|todo|todos)\s*$/i,
        command: '/task', args: 'list',
        display: 'Listing tasks...',
    },

    // ── Search ──────────────────────────────────────────────────────────────────
    {
        keywords: /\b(search|google|look\s+up|find)\b\s+(?:for\s+)?(.+)/i,
        command: '/search',
        args: (match) => match[2]?.trim() || '',
        display: 'Searching the web...',
    },

    // ── Browse ──────────────────────────────────────────────────────────────────
    {
        keywords: /\b(open|browse|go\s+to|visit|navigate)\b\s+(https?:\/\/\S+|[\w.-]+\.\w{2,}[\S]*)/i,
        command: '/browse',
        args: (match) => {
            let url = match[2]?.trim() || '';
            if (!url.startsWith('http')) url = 'https://' + url;
            return url;
        },
        display: 'Opening page...',
    },

    // ── Calendar ────────────────────────────────────────────────────────────────
    {
        keywords: /\b(show|check|view|see|what)\b.+\b(calendar|schedule|meetings|events|agenda)\b/i,
        command: '/cal', args: '',
        display: 'Loading calendar...',
    },
    {
        keywords: /\b(any|upcoming|today|tomorrow)\b.+\b(meeting|event|call|appointment)\b/i,
        command: '/cal', args: '',
        display: 'Checking schedule...',
    },
    {
        keywords: /^(calendar|schedule|agenda|meetings)\s*$/i,
        command: '/cal', args: '',
        display: 'Loading calendar...',
    },

    // ── Dashboard ───────────────────────────────────────────────────────────────
    {
        keywords: /\b(show|open)\b.+\b(dashboard|dash|home)\b/i,
        command: '/dash', args: '',
        display: 'Opening dashboard...',
    },
    {
        keywords: /^(dashboard|dash)\s*$/i,
        command: '/dash', args: '',
        display: 'Opening dashboard...',
    },

    // ── Profile ─────────────────────────────────────────────────────────────────
    {
        keywords: /\b(who\s+am\s+i|my\s+profile|show\s+profile|my\s+info)\b/i,
        command: '/profile', args: '',
        display: 'Showing profile...',
    },

    // ── Status ──────────────────────────────────────────────────────────────────
    {
        keywords: /\b(system|status|health|sys\s+info)\b/i,
        command: '/status', args: '',
        display: 'Loading system status...',
    },

    // ── Help ────────────────────────────────────────────────────────────────────
    {
        keywords: /\b(help|what\s+can\s+you\s+do|commands|how\s+to)\b\s*\??\s*$/i,
        command: '/help', args: '',
        display: 'Showing help...',
    },

    // ── Agent management ────────────────────────────────────────────────────────
    {
        keywords: /\b(show|list|view)\b.+\b(agent|agents)\b/i,
        command: '/agent', args: 'list',
        display: 'Listing agents...',
    },

    // ── Memory ──────────────────────────────────────────────────────────────────
    {
        keywords: /\b(remember|memorize)\b\s+(.+)/i,
        command: '/remember',
        args: (match) => match[2]?.trim() || '',
        display: 'Saving to memory...',
    },
    {
        keywords: /\b(recall|what\s+do\s+you\s+remember|memories)\b/i,
        command: '/memory', args: 'list',
        display: 'Recalling memories...',
    },

    // ── Models ──────────────────────────────────────────────────────────────────
    {
        keywords: /\b(show|list|which|what)\b.+\b(model|models|llm|ai)\b/i,
        command: '/models', args: '',
        display: 'Listing available models...',
    },
    {
        keywords: /\b(switch|change|use)\b.+\b(model|llm)\b\s+(?:to\s+)?(\S+)/i,
        command: '/model',
        args: (match) => match[3]?.trim() || '',
        display: 'Switching model...',
    },
];

/**
 * Try to detect a command intent from natural language input.
 * Returns null if no intent is matched (should fall through to LLM chat).
 */
export function detectIntent(input: string): DetectedIntent | null {
    const trimmed = input.trim();

    for (const pattern of INTENT_PATTERNS) {
        const match = trimmed.match(pattern.keywords);
        if (match) {
            const args = typeof pattern.args === 'function'
                ? pattern.args(match, trimmed)
                : pattern.args;
            return {
                command: pattern.command,
                args,
                display: pattern.display,
            };
        }
    }

    return null;
}
