/**
 * Provider ASCII art logos — compact terminal-friendly branding
 */
import { T } from './theme';

const LOGOS: Record<string, string[]> = {
  anthropic: [
    '    ╱╲    ',
    '   ╱  ╲   ',
    '  ╱ /\\ ╲  ',
    ' ╱ /  \\ ╲ ',
    '╱________╲',
  ],
  openai: [
    ' ╭──────╮ ',
    ' │ ◉  ◉ │ ',
    ' │  ╰╯  │ ',
    ' ╰──────╯ ',
    '  OpenAI   ',
  ],
  ollama: [
    '  🦙      ',
    ' ╭───────╮',
    ' │ OLLAMA│',
    ' ╰───────╯',
    '  local AI ',
  ],
  gemini: [
    '  ✦   ✦  ',
    '   ╲ ╱   ',
    '    ╳    ',
    '   ╱ ╲   ',
    '  ✦   ✦  ',
  ],
};

const COLOR_FN: Record<string, (s: string) => string> = {
  anthropic: T.aura,
  openai:    T.aurora,
  ollama:    T.solar,
  gemini:    T.ice,
};

/**
 * Get a compact ASCII art logo for a provider.
 * Returns a multi-line string with color applied.
 */
export function getProviderLogo(provider: string): string {
  const lines = LOGOS[provider];
  if (!lines) return '';
  const colorFn = COLOR_FN[provider] || T.muted;
  return lines.map(l => `  ${colorFn(l)}`).join('\n');
}

/**
 * Get a single-line provider badge (icon + name).
 */
export function getProviderBadge(provider: string): string {
  const badges: Record<string, string> = {
    anthropic: T.aura('▲ Anthropic'),
    openai:    T.aurora('◉ OpenAI'),
    ollama:    T.solar('🦙 Ollama'),
    gemini:    T.ice('✦ Gemini'),
  };
  return badges[provider] || T.muted(provider);
}

/**
 * Get all provider logos side by side (for /models display).
 */
export function getAllProviderBadges(): string {
  return [
    getProviderBadge('anthropic'),
    getProviderBadge('openai'),
    getProviderBadge('ollama'),
    getProviderBadge('gemini'),
  ].join(T.dim('  │  '));
}
