import { fetchAllVersions } from './fetch-all.js';
import type { OSVersionInfo, SubmissionDeadline } from './types.js';

function formatVersion(info: OSVersionInfo): string {
  const parts = [info.version];
  if (info.build) parts.push(`(${info.build})`);
  if (info.apiLevel) parts.push(`(API ${info.apiLevel}`
    + (info.codename ? `, ${info.codename}` : '') + ')');
  parts.push(`— ${info.releaseDate}`);
  return parts.join(' ');
}

function formatPlatform(name: string, versions: OSVersionInfo[]): string {
  const header = `── ${name} ${'─'.repeat(37 - name.length)}`;
  const stable = versions.find(v => !v.isBeta);
  const beta = versions.find(v => v.isBeta);

  const lines = [header];
  lines.push(`  Stable:  ${stable ? formatVersion(stable) : 'N/A'}`);
  lines.push(`  Beta:    ${beta ? formatVersion(beta) : 'N/A'}`);
  return lines.join('\n');
}

function formatDeadline(label: string, deadline: SubmissionDeadline | null): string {
  if (!deadline) return '';
  const header = `── ${label} ${'─'.repeat(Math.max(0, 41 - label.length))}`;
  const lines = [header];
  lines.push(`  Deadline: ${deadline.deadline}`);
  for (const req of deadline.requirements) {
    lines.push(`  ${req.platform}: ${req.sdk}`);
  }
  if (deadline.extensionDate) {
    lines.push(`  Extension: ${deadline.extensionDate}`);
  }
  if (deadline.announcedAt) {
    lines.push(`  Announced: ${deadline.announcedAt}`);
  }
  return lines.join('\n');
}

async function main() {
  console.log('\n📱 OS Version Tracker\n');

  const { ios, android, appleDeadline, googleDeadline } = await fetchAllVersions();

  console.log(formatPlatform('iOS', ios));
  console.log(formatPlatform('Android', android));
  const appleOutput = formatDeadline('App Store Deadline', appleDeadline);
  if (appleOutput) console.log(appleOutput);
  const googleOutput = formatDeadline('Google Play Deadline', googleDeadline);
  if (googleOutput) console.log(googleOutput);
  console.log();
}

main();
