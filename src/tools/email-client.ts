import * as fs from 'fs-extra';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { getDataDir } from '../data/profile';
dotenv.config();

export interface EmailConfig {
  imap: { host: string; port: number; tls: boolean };
  smtp: { host: string; port: number; secure: boolean };
  address: string;
  password: string;
}

export interface EmailMessage {
  seqno: number;
  uid?: number;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  isRead: boolean;
}

const EMAIL_CREDS_PATH = () => path.join(getDataDir(), '.email-creds.json');

export async function saveEmailConfig(config: EmailConfig): Promise<void> {
  await fs.ensureDir(getDataDir());
  await fs.writeJson(EMAIL_CREDS_PATH(), config);
  try { await fs.chmod(EMAIL_CREDS_PATH(), 0o600); } catch { /* ignore */ }
}

export async function loadEmailConfig(): Promise<EmailConfig | null> {
  const p = EMAIL_CREDS_PATH();
  if (!(await fs.pathExists(p))) return null;
  try { return await fs.readJson(p); } catch { return null; }
}

export async function fetchInbox(limit = 20): Promise<EmailMessage[]> {
  const config = await loadEmailConfig();
  if (!config) throw new Error('Email not configured. Run /mail setup');

  const Imap = (await import('imap')).default;
  const simpleParser = (await import('mailparser')).simpleParser;

  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: config.address,
      password: config.password,
      host: config.imap.host,
      port: config.imap.port,
      tls: config.imap.tls,
      tlsOptions: { rejectUnauthorized: false },
    });

    const messages: EmailMessage[] = [];

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) { imap.end(); return reject(err); }

        const total = box.messages.total;
        if (total === 0) { imap.end(); return resolve([]); }

        const start = Math.max(1, total - limit + 1);
        const fetch = imap.seq.fetch(`${start}:${total}`, {
          bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', 'TEXT'],
          struct: true,
          markSeen: false,
        });

        fetch.on('message', (msg, seqno) => {
          let header = '';
          let body = '';
          const attrs: { flags?: string[] } = {};

          msg.on('body', (stream, info) => {
            const chunks: Buffer[] = [];
            stream.on('data', (c: Buffer) => chunks.push(c));
            stream.once('end', () => {
              const text = Buffer.concat(chunks).toString();
              if (info.which.includes('HEADER')) header = text;
              else body = text;
            });
          });

          msg.once('attributes', (a: { flags?: string[] }) => {
            Object.assign(attrs, a);
          });

          msg.once('end', async () => {
            try {
              const parsed = await simpleParser(header + '\n\n' + body);
              messages.push({
                seqno,
                from: parsed.from?.text || '',
                to: typeof parsed.to === 'string' ? parsed.to : (parsed.to as { text: string } | undefined)?.text || '',
                subject: parsed.subject || '(no subject)',
                date: parsed.date?.toLocaleString() || '',
                body: (parsed.text || '').slice(0, 2000),
                isRead: (attrs.flags || []).includes('\\Seen'),
              });
            } catch { /* skip malformed */ }
          });
        });

        fetch.once('error', reject);
        fetch.once('end', () => {
          imap.end();
          resolve(messages.reverse());
        });
      });
    });

    imap.once('error', reject);
    imap.connect();
  });
}

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const config = await loadEmailConfig();
  if (!config) throw new Error('Email not configured. Run /mail setup');

  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.address, pass: config.password },
    tls: { rejectUnauthorized: false },
  });

  await transporter.sendMail({
    from: config.address,
    to,
    subject,
    text,
  });
}

export function formatEmailList(emails: EmailMessage[]): string {
  if (emails.length === 0) return '  No messages found.';
  return emails.map((e, i) => {
    const read = e.isRead ? '  ' : '● ';
    const idx = String(i + 1).padStart(3);
    const from = e.from.slice(0, 30).padEnd(30);
    const subj = e.subject.slice(0, 40).padEnd(40);
    return `  ${read}${idx}  ${from}  ${subj}  ${e.date}`;
  }).join('\n');
}

export function formatEmail(e: EmailMessage): string {
  return [
    `From:    ${e.from}`,
    `To:      ${e.to}`,
    `Subject: ${e.subject}`,
    `Date:    ${e.date}`,
    '',
    '─'.repeat(60),
    '',
    e.body || '(no body)',
  ].join('\n');
}
