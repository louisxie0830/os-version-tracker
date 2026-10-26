import { fetchText, NETWORK_TIMEOUT_MS } from '../net.js';

/**
 * Apple Developer System Status (App Store Connect, TestFlight, APNs, Xcode Cloud…): the data behind
 * https://developer.apple.com/system-status/. Only the service, the kind of problem, its state and times are
 * kept; Apple's message text isn't republished. The site refreshes twice a day, so this is a record of recent
 * incidents rather than live status; the page links to Apple's own page for that.
 */

export const DEVELOPER_STATUS_PAGE = 'https://developer.apple.com/system-status/';
const DATA_URL = 'https://www.apple.com/support/systemstatus/data/developer/system_status_en_US.js';
/** Resolved incidents stay listed this long */
const RECENT_DAYS = 7;

export interface DeveloperStatusEvent {
  id: string;
  service: string;
  /** Apple's type: "Outage", "Issue" or "Maintenance" */
  type: string;
  /** "ongoing", "upcoming", "resolved", "completed"… */
  state: string;
  start: string; // ISO
  end?: string; // ISO
}

export interface DeveloperStatus {
  /** How many services Apple reports on */
  services: number;
  /** Ongoing and upcoming events first, then recently ended ones, newest first */
  events: DeveloperStatusEvent[];
  url: string;
}

interface RawEvent {
  messageId?: string;
  statusType?: string;
  eventStatus?: string;
  epochStartDate?: number;
  epochEndDate?: number | null;
}

/** An event that hasn't ended yet (or hasn't started) */
export function isActive(e: DeveloperStatusEvent, now = new Date()): boolean {
  return !/^(resolved|completed)$/i.test(e.state) && (!e.end || new Date(e.end).getTime() > now.getTime());
}

/** Parses the JSONP file ("jsonCallback({...});") */
export function parseDeveloperStatus(js: string, now = new Date()): DeveloperStatus {
  const json = js.trim().replace(/^[\w$.]+\(/, '').replace(/\);?$/, '');
  const data = JSON.parse(json) as { services?: Array<{ serviceName?: string; events?: RawEvent[] }> };
  if (!Array.isArray(data.services) || !data.services.length) throw new Error('No services in Apple developer system status');
  const since = now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const iso = (ms?: number | null) => (typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : undefined);
  const events = data.services.flatMap(service => (service.events ?? []).flatMap(raw => {
    // Epoch milliseconds (seconds would date everything 1970) and a state: without one, an old resolved incident
    // would show as ongoing, so a changed format fails the source instead
    if (typeof raw.epochStartDate === 'number' && raw.epochStartDate < 1e12) throw new Error('Apple status: epochStartDate is no longer in milliseconds');
    if (!raw.eventStatus) throw new Error('Apple status: an event has no eventStatus');
    const start = iso(raw.epochStartDate);
    if (!start || !service.serviceName) return [];
    const event: DeveloperStatusEvent = {
      id: `${raw.messageId ?? start}:${service.serviceName.trim()}`,
      service: service.serviceName.trim(),
      type: raw.statusType ?? 'Issue',
      state: raw.eventStatus ?? 'ongoing',
      start,
      end: iso(raw.epochEndDate),
    };
    const recent = new Date(event.end ?? event.start).getTime() >= since;
    return isActive(event, now) || recent ? [event] : [];
  }));
  events.sort((a, b) => Number(isActive(b, now)) - Number(isActive(a, now)) || b.start.localeCompare(a.start));
  return { services: data.services.length, events, url: DEVELOPER_STATUS_PAGE };
}

export async function fetchDeveloperStatus(): Promise<DeveloperStatus> {
  return parseDeveloperStatus(await fetchText(DATA_URL, {}, NETWORK_TIMEOUT_MS, status => `HTTP ${status}`));
}
