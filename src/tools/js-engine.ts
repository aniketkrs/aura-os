/**
 * JSDOM + Node vm sandbox — JavaScript execution for Aura OS terminal browser
 * No osascript, no open -a — terminal only
 * Returns data, never writes to stdout
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import * as vm from 'vm';
import { URL } from 'url';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface JsEngineOpts {
  timeout?:              number;   // ms, default 5000
  allowNetworkRequests?: boolean;  // default false
  maxScripts?:           number;   // default 50
}

export interface JsResult {
  html:       string;
  title:      string;
  errors:     string[];
  scriptsRun: number;
  console:    string[];
}

export interface ScriptResult {
  result:  unknown;
  console: string[];
  error?:  string;
}

export interface JsdomSandbox {
  dom:       JSDOM;
  window:    any;
  document:  any;
  runScript: (code: string) => Promise<ScriptResult>;
  serialize: () => string;
  destroy:   () => void;
}

// ─── Defaults ───────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT     = 5000;
const DEFAULT_MAX_SCRIPTS = 50;

// ─── Dangerous globals to strip from sandbox ────────────────────────────────────

const DANGEROUS_GLOBALS = [
  'require',
  'process',
  'Buffer',
  'global',
  'globalThis',
  '__dirname',
  '__filename',
  'module',
  'exports',
] as const;

// ─── Console capture helper ─────────────────────────────────────────────────────

function createConsoleTrap(): { logs: string[]; consoleObj: Record<string, Function> } {
  const logs: string[] = [];

  const fmt = (args: unknown[]): string =>
    args.map(a => {
      if (a === null)      return 'null';
      if (a === undefined) return 'undefined';
      if (typeof a === 'object') {
        try { return JSON.stringify(a, null, 2); } catch { return String(a); }
      }
      return String(a);
    }).join(' ');

  const consoleObj: Record<string, Function> = {
    log:   (...args: unknown[]) => { logs.push(fmt(args)); },
    warn:  (...args: unknown[]) => { logs.push(`[warn] ${fmt(args)}`); },
    error: (...args: unknown[]) => { logs.push(`[error] ${fmt(args)}`); },
    info:  (...args: unknown[]) => { logs.push(fmt(args)); },
    debug: (...args: unknown[]) => { logs.push(`[debug] ${fmt(args)}`); },
    dir:   (...args: unknown[]) => { logs.push(fmt(args)); },
    trace: (...args: unknown[]) => { logs.push(`[trace] ${fmt(args)}`); },
    clear: ()                   => { /* noop */ },
    time:  ()                   => { /* noop */ },
    timeEnd: ()                 => { /* noop */ },
  };

  return { logs, consoleObj };
}

// ─── Strip dangerous APIs from a context object ────────────────────────────────

function sanitizeContext(ctx: Record<string, unknown>): void {
  for (const name of DANGEROUS_GLOBALS) {
    ctx[name] = undefined;
  }
  // Remove eval and Function constructor to prevent escapes
  ctx['eval']     = undefined;
  ctx['Function'] = undefined;
}

// ─── Run code in a vm sandbox with timeout ──────────────────────────────────────

function vmRun(
  code: string,
  context: vm.Context,
  timeout: number,
): { result: unknown; error?: string } {
  try {
    const script = new vm.Script(code, {
      filename: 'sandbox.js',
    });
    const result = script.runInContext(context, { timeout });
    return { result };
  } catch (err: any) {
    const msg = err?.message || String(err);
    return { result: undefined, error: msg };
  }
}

// ─── executePageScripts ─────────────────────────────────────────────────────────

export async function executePageScripts(
  html: string,
  url: string,
  opts?: JsEngineOpts,
): Promise<JsResult> {
  const timeout    = opts?.timeout    ?? DEFAULT_TIMEOUT;
  const maxScripts = opts?.maxScripts ?? DEFAULT_MAX_SCRIPTS;

  const errors:  string[] = [];
  const consoleLogs: string[] = [];
  let scriptsRun = 0;

  // Build a JSDOM with a virtual console that captures output
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('log',   (msg: string) => consoleLogs.push(String(msg)));
  virtualConsole.on('warn',  (msg: string) => consoleLogs.push(`[warn] ${msg}`));
  virtualConsole.on('error', (msg: string) => consoleLogs.push(`[error] ${msg}`));
  virtualConsole.on('info',  (msg: string) => consoleLogs.push(String(msg)));

  const dom = new JSDOM(html, {
    url,
    virtualConsole,
    runScripts:        'outside-only',   // we control script execution
    pretendToBeVisual: true,
    resources:         opts?.allowNetworkRequests ? 'usable' : undefined,
  });

  const window   = dom.window as any;
  const document = window.document;

  // Create a vm context from the JSDOM window for sandboxed execution
  const context = vm.createContext(window, {
    name: `jsdom-sandbox:${url}`,
    codeGeneration: { strings: false, wasm: false },
  });

  // Inject a safe console into the context
  const trap = createConsoleTrap();
  context.console = trap.consoleObj;

  // Strip dangerous globals from the sandbox
  sanitizeContext(context);

  // Provide benign stubs for common browser APIs that JSDOM may not implement
  if (!context.requestAnimationFrame) {
    context.requestAnimationFrame = (cb: Function) => setTimeout(cb, 16);
  }
  if (!context.cancelAnimationFrame) {
    context.cancelAnimationFrame = (id: number) => clearTimeout(id);
  }

  // Collect all <script> elements
  const scriptElements = document.querySelectorAll('script');
  const scripts: Array<{ code: string; src: string | null }> = [];

  for (const el of Array.from(scriptElements) as any[]) {
    const src  = el.getAttribute('src');
    const code = el.textContent || '';

    // Skip external scripts (network fetch not supported by default)
    if (src) {
      if (opts?.allowNetworkRequests) {
        scripts.push({ code: '', src });
      }
      // External scripts silently skipped when network disabled
      continue;
    }

    if (code.trim()) {
      scripts.push({ code: code.trim(), src: null });
    }
  }

  // Execute collected scripts up to maxScripts
  const perScriptTimeout = Math.max(Math.floor(timeout / Math.max(scripts.length, 1)), 500);

  for (const script of scripts.slice(0, maxScripts)) {
    if (script.src) {
      // External script loading would require network — skip with a note
      errors.push(`Skipped external script: ${script.src}`);
      continue;
    }

    const { error } = vmRun(script.code, context, perScriptTimeout);
    scriptsRun++;

    if (error) {
      errors.push(error);
    }
  }

  if (scripts.length > maxScripts) {
    errors.push(`Script limit reached: ran ${maxScripts} of ${scripts.length} scripts`);
  }

  // Merge captured console output
  consoleLogs.push(...trap.logs);

  const title = document.title || '';
  const resultHtml = dom.serialize();

  dom.window.close();

  return {
    html:       resultHtml,
    title,
    errors,
    scriptsRun,
    console:    consoleLogs,
  };
}

// ─── evaluateScript ─────────────────────────────────────────────────────────────

export async function evaluateScript(
  code: string,
  userContext?: Record<string, unknown>,
): Promise<ScriptResult> {
  const trap = createConsoleTrap();
  const timeout = DEFAULT_TIMEOUT;

  // Build a minimal sandbox with safe globals
  const sandbox: Record<string, unknown> = {
    console:    trap.consoleObj,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Math,
    Date,
    JSON,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Symbol,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    ReferenceError,
    URIError,
    ...userContext,
  };

  // Strip any dangerous APIs the user might have sneaked in
  sanitizeContext(sandbox);

  const context = vm.createContext(sandbox, {
    name: 'eval-sandbox',
    codeGeneration: { strings: false, wasm: false },
  });

  const { result, error } = vmRun(code, context, timeout);

  return {
    result,
    console: trap.logs,
    ...(error ? { error } : {}),
  };
}

// ─── createSandboxedDom ─────────────────────────────────────────────────────────

export function createSandboxedDom(html: string, url: string): JsdomSandbox {
  const virtualConsole = new VirtualConsole();
  const consoleLogs: string[] = [];

  virtualConsole.on('log',   (msg: string) => consoleLogs.push(String(msg)));
  virtualConsole.on('warn',  (msg: string) => consoleLogs.push(`[warn] ${msg}`));
  virtualConsole.on('error', (msg: string) => consoleLogs.push(`[error] ${msg}`));
  virtualConsole.on('info',  (msg: string) => consoleLogs.push(String(msg)));

  const dom = new JSDOM(html, {
    url,
    virtualConsole,
    runScripts:        'outside-only',
    pretendToBeVisual: true,
  });

  const window   = dom.window as any;
  const document = window.document;

  const context = vm.createContext(window, {
    name: `persistent-sandbox:${url}`,
    codeGeneration: { strings: false, wasm: false },
  });

  // Inject safe console
  const trap = createConsoleTrap();
  context.console = trap.consoleObj;

  sanitizeContext(context);

  // Stubs for missing browser APIs
  if (!context.requestAnimationFrame) {
    context.requestAnimationFrame = (cb: Function) => setTimeout(cb, 16);
  }
  if (!context.cancelAnimationFrame) {
    context.cancelAnimationFrame = (id: number) => clearTimeout(id);
  }

  const runScript = async (code: string): Promise<ScriptResult> => {
    const localTrap = createConsoleTrap();
    context.console = localTrap.consoleObj;

    const { result, error } = vmRun(code, context, DEFAULT_TIMEOUT);

    // Collect console output into the persistent log as well
    consoleLogs.push(...localTrap.logs);

    return {
      result,
      console: localTrap.logs,
      ...(error ? { error } : {}),
    };
  };

  const serialize = (): string => dom.serialize();

  const destroy = (): void => {
    dom.window.close();
  };

  return {
    dom,
    window,
    document,
    runScript,
    serialize,
    destroy,
  };
}
