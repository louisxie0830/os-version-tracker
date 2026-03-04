import { fetchAllVersions } from './fetch-all.js';
import type { OSVersionInfo } from './types.js';

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

async function main() {
  console.log('\n📱 OS Version Tracker\n');

  const { ios, android } = await fetchAllVersions();

  console.log(formatPlatform('iOS', ios));
  console.log(formatPlatform('Android', android));
  console.log();
}

main();
