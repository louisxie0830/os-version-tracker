import { createHash } from 'node:crypto';
import type { Deadline } from './types.js';
import { safeUrl } from './safe-url.js';

/** RFC 5545 text escaping */
function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
    // Any other control character could break the line structure; drop it
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
}

/** Lines longer than 75 octets must be folded with CRLF + space */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const len = Buffer.byteLength(ch, 'utf8');
    if (size + len > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += len;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const compactDate = (iso: string) => iso.replace(/-/g, '');

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Stable across refreshes so calendar apps update events instead of duplicating them */
export function deadlineId(d: Pick<Deadline, 'platform' | 'date' | 'title' | 'detail'>, suffix = ''): string {
  // Several Play policies can share a title and date, so include the start of the description
  // (only the start: details may end with changing text such as the latest library version)
  return createHash('sha1').update(`${d.platform}|${d.date}|${d.title}|${d.detail.slice(0, 40)}${suffix}`).digest('hex').slice(0, 16);
}

function allDayEvent(uid: string, date: string, summary: string, description: string, url: string, stamp: string): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}@os-version-tracker`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compactDate(date)}`,
    `DTEND;VALUE=DATE:${compactDate(nextDay(date))}`,
    `SUMMARY:${icsText(summary)}`,
    `DESCRIPTION:${icsText(description)}`,
    ...(safeUrl(url) ? [`URL:${safeUrl(url)}`] : []),
    'TRANSP:TRANSPARENT',
    // Remind a week before and on the day
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(summary)}`, 'TRIGGER:-P7D', 'END:VALARM',
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(summary)}`, 'TRIGGER:PT9H', 'END:VALARM',
    'END:VEVENT',
  ];
}

export function buildCalendar(deadlines: Deadline[], siteUrl: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OS Version Tracker//Developer Deadlines//ZH-TW',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:iOS / Android 上架期限',
    'X-WR-CALDESC:App Store 與 Google Play 的上架規定、SDK 與政策期限（OS Version Tracker）',
    'X-WR-TIMEZONE:Asia/Taipei',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];

  for (const d of deadlines) {
    const description = `${d.detail}\n\n來源：${d.source}${safeUrl(d.url) ? `\n${safeUrl(d.url)}` : ''}\n\n${siteUrl}/#deadlines`;
    lines.push(...allDayEvent(deadlineId(d), d.date, `[${d.platform}] ${d.title}`, description, d.url, stamp));
    if (d.extensionDate && d.extensionDate > d.date) {
      lines.push(...allDayEvent(
        deadlineId(d, '|extension'),
        d.extensionDate,
        `[${d.platform}] 延長期限截止：${d.title}`,
        description,
        d.url,
        stamp,
      ));
    }
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
