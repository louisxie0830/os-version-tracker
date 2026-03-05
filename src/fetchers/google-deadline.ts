import type { SubmissionDeadline, SDKRequirement } from '../types.js';

export async function fetchGooglePlayDeadline(): Promise<SubmissionDeadline | null> {
  const res = await fetch('https://developer.android.com/google/play/requirements/target-sdk', {
    headers: { 'User-Agent': 'os-version-tracker/1.0' },
  });
  if (!res.ok) {
    throw new Error(`Google Play target SDK page failed: ${res.status}`);
  }

  const html = await res.text();

  // Match "Starting August 31 2025:" or "Starting August 31, 2025"
  const dateMatch = html.match(/Starting\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/);
  if (!dateMatch) {
    return null;
  }

  const deadline = dateMatch[1].replace(/(\d)\s+(\d{4})/, '$1, $2');

  const requirements: SDKRequirement[] = [];

  // Match patterns like "target Android 15 (API level 35) or higher"
  const reqPattern = /(?:must\s+)?target\s+(Android\s+\d+\s*\(API\s+level\s+\d+\)(?:\s+or\s+higher)?)/gi;
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = reqPattern.exec(html)) !== null) {
    const sdk = match[1].trim();
    if (!seen.has(sdk)) {
      seen.add(sdk);
      requirements.push({ platform: 'Android', sdk });
    }
  }

  // Check for extension date
  const extMatch = html.match(/extension\s+to\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
  const extensionDate = extMatch ? extMatch[1].replace(/(\d)\s+(\d{4})/, '$1, $2') : undefined;

  return {
    source: 'google',
    deadline,
    requirements,
    extensionDate,
  };
}
