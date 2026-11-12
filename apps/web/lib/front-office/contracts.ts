// Shared front-office contracts (task A-1): the one definition of the shapes the AI Setter, the AI Receptionist and the
// UI exchange over /api/front-office/*. Documented endpoint by endpoint in docs/agents/API_CONTRACTS.md.
//
// - Shapes are camelCase API shapes. Each one maps to a real fo_* table or RPC result (column noted per field), so a
//   route maps rows to these and the UI never sees raw rows, channel keys or provider secrets.
// - Every parse function takes untrusted JSON and returns { ok: true, value } or { ok: false, error } with a plain-English
//   error naming the first bad field. They never throw and need no dependencies.
// - The value lists below must match the database checks and the existing modules (state.ts, handoff.ts,
//   receptionist/agent.ts); test/front-office-contracts.test.ts fails if they drift.
// - No runtime imports on purpose: this file loads in the browser, in routes and in node --test without a bundler.

// ---------------------------------------------------------------------------------------------------------------------
// Value lists
// ---------------------------------------------------------------------------------------------------------------------

/** How much the AI may do on its own, per business and per product (Setter, Receptionist).
 * automatic: performs bookings, changes, sends and transfers within the business rules.
 * owner_approval: prepares the action, holds it as a PendingAction, commits only after the owner approves.
 * enquiry_only: answers from approved information and captures the enquiry; never books, changes, sends or transfers. */
export const operatingModes = ['automatic', 'owner_approval', 'enquiry_only'] as const;
export type OperatingMode = typeof operatingModes[number];
/** The safe default until the owner chooses: nothing is committed. */
export const DEFAULT_OPERATING_MODE: OperatingMode = 'enquiry_only';

export const products = ['setter', 'receptionist'] as const;
export type Product = typeof products[number];

/** fo_contacts.state (same list and order as state.ts contactStates and fo_transition_ok). */
export const contactStates = ['new', 'contacted', 'qualifying', 'qualified', 'booked', 'no-show', 'disqualified', 'nurture', 'customer'] as const;
export type ContactState = typeof contactStates[number];
/** fo_contacts.source. */
export const contactSources = ['inbound', 'organic', 'import', 'manual'] as const;
export type ContactSource = typeof contactSources[number];

/** fo_channels.kind: where a conversation happens. */
export const channelKinds = ['sms', 'web-chat', 'email', 'voice', 'instagram', 'messenger'] as const;
export type ChannelKind = typeof channelKinds[number];
/** fo_handoffs.channel (handoff.ts channels): channel kinds plus web forms. */
export const handoffChannels = ['sms', 'web-chat', 'email', 'voice', 'form', 'instagram', 'messenger'] as const;
export type HandoffChannel = typeof handoffChannels[number];

/** fo_handoffs.from_agent / owner (handoff.ts agents). */
export const agents = ['setter', 'sales', 'receptionist', 'onboarding', 'human'] as const;
export type Agent = typeof agents[number];
/** fo_messages.agent: who wrote an outbound message. */
export const messageAuthors = ['setter', 'sales', 'receptionist', 'onboarding', 'human', 'system'] as const;
export type MessageAuthor = typeof messageAuthors[number];
export const messageDirections = ['inbound', 'outbound'] as const;
export type MessageDirection = typeof messageDirections[number];

/** fo_events.kind. */
export const activityKinds = ['created', 'inbound', 'state', 'dispatch', 'opt-out', 'opt-in', 'handoff', 'call', 'booking', 'message'] as const;
export type ActivityKind = typeof activityKinds[number];

/** fo_appointments.status and .provider. */
export const bookingStatuses = ['booked', 'attended', 'no-show', 'cancelled'] as const;
export type BookingStatus = typeof bookingStatuses[number];
export const calendarProviders = ['google'] as const;
export type CalendarProviderId = typeof calendarProviders[number];

/** fo_calls.outcomes entries (fo_voice_outcome). 'not-live': the call came in while the AI was off. */
export const callOutcomes = ['faq', 'faq-miss', 'qualified', 'booked', 'rescheduled', 'cancelled', 'message', 'transfer', 'not-live'] as const;
export type CallOutcome = typeof callOutcomes[number];
/** What the voice platform must do after a Receptionist turn (receptionist/agent.ts TurnSummary.action). */
export const callActions = ['transfer', 'end'] as const;
export type CallAction = typeof callActions[number];

/** Actions that need the shared permission check before they happen (planned A-2). */
export const pendingActionKinds = ['book', 'reschedule', 'cancel', 'send', 'follow_up', 'transfer'] as const;
export type PendingActionKind = typeof pendingActionKinds[number];
export const pendingActionStatuses = ['pending', 'approved', 'rejected', 'expired', 'performed', 'failed', 'cancelled'] as const;
export type PendingActionStatus = typeof pendingActionStatuses[number];
/** The shared permission check's answer for one action in one mode (planned A-2 permissions.ts decide()). */
export const permissionDecisions = ['perform', 'hold_for_approval', 'refuse'] as const;
export type PermissionDecision = typeof permissionDecisions[number];

/** Things a business connects. Channel kinds plus WhatsApp (planned A-11) and the calendar (planned A-12). */
export const connectionTargets = ['web-chat', 'sms', 'email', 'voice', 'instagram', 'messenger', 'whatsapp', 'google-calendar'] as const;
export type ConnectionTarget = typeof connectionTargets[number];
/** Same words as lib/integration-status.ts, plus 'failed' for a check that ran and did not pass. */
export const connectionStatuses = ['not-configured', 'configured', 'verified', 'blocked', 'failed'] as const;
export type ConnectionStatus = typeof connectionStatuses[number];
/** Same as lib/connection-state.ts: LIVE only when real sending/answering is switched on and verified. */
export const connectionModes = ['DEMO', 'LIVE'] as const;
export type ConnectionMode = typeof connectionModes[number];

// ---------------------------------------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------------------------------------

/** One person, shared by every agent and channel (fo_contacts). A lead is a contact before they become a customer. */
export type Contact = {
  id: string;                       // id
  workspaceId: string;              // workspace_id
  name: string | null;              // name
  phone: string | null;             // phone, E.164
  email: string | null;             // email, lower case
  webVisitor: string | null;        // web_visitor (website chat visitor id)
  instagramId: string | null;       // instagram_id (Meta scoped id)
  messengerId: string | null;       // messenger_id (Meta scoped id)
  state: ContactState;              // state
  source: ContactSource;            // source
  optedOut: boolean;                // opted_out_at is not null
  optedOutAt: string | null;        // opted_out_at
  answers: Record<string, string>;  // answers, keyed by the business's question ids
  createdAt: string;                // created_at
  updatedAt: string;                // updated_at
};
export type Lead = Contact;

/** One message in or out (fo_messages). */
export type Message = {
  id: string;                       // id
  contactId: string;                // contact_id
  channelId: string | null;         // channel_id
  channel: ChannelKind | null;      // fo_channels.kind of channel_id
  direction: MessageDirection;      // direction
  body: string;                     // body
  agent: MessageAuthor | null;      // agent (null on inbound)
  promptVersion: string | null;     // prompt_version (set on every automated send)
  createdAt: string;                // created_at
};

/** fo_contact_context contact.consent (migration 202611110004, A-38): true only while the contact has an open, explicit
 * grant for that channel. Older databases do not return it: missing means no consent on either channel. A grant never
 * overrides an opt-out; callers still refuse opted-out contacts first. */
export type ContactConsent = { sms: boolean; email: boolean };
/** An email that mail can really reach. Placeholder addresses (the `.invalid` TLD, e.g. the withheld-caller contact's
 * withheld-...@call.invalid) are never deliverable: nothing is ever sent or invited to one. */
export function isDeliverableEmail(email: unknown): email is string {
  if (typeof email !== 'string') return false;
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !/\.invalid$/.test(e);
}
/** The email if it is deliverable, otherwise null. */
export const deliverableEmail = (email: unknown): string | null => isDeliverableEmail(email) ? email : null;
/** Explicit consent for one channel from a raw contact.consent value. Only the boolean true counts. */
export function hasConsent(consent: unknown, channel: 'sms' | 'email'): boolean {
  return !!consent && typeof consent === 'object' && (consent as Record<string, unknown>)[channel] === true;
}

/** One contact on one channel, for an inbox list. Derived from fo_messages (planned A-9). */
export type Conversation = {
  contactId: string;
  channel: ChannelKind;
  contactName: string | null;
  state: ContactState;
  optedOut: boolean;
  lastMessageAt: string;
  lastDirection: MessageDirection;
  /** First characters of the last message, at most 160. */
  preview: string;
  messageCount: number;
  /** Pending actions for this contact waiting on the owner. */
  pendingActions: number;
  /** A handoff to a person (owner 'human') that nobody has answered yet. */
  needsOwner: boolean;
};

/** A booked time (fo_appointments). The calendar event id is internal and not part of the contract. */
export type Booking = {
  id: string;                       // id
  contactId: string;                // contact_id
  startsAt: string;                 // starts_at
  endsAt: string;                   // ends_at
  provider: CalendarProviderId;     // provider
  status: BookingStatus;            // status
  createdAt: string;                // created_at
};

/** What a held action would do, by kind. Times are ISO 8601; timeZone is the business's IANA zone. */
export type PendingActionPayload =
  | { kind: 'book'; start: string; end: string; timeZone: string }
  | { kind: 'reschedule'; bookingId: string; start: string; end: string; timeZone: string }
  | { kind: 'cancel'; bookingId: string; reason: string }
  | { kind: 'send'; channel: ChannelKind; body: string; promptVersion: string }
  | { kind: 'follow_up'; channel: ChannelKind; body: string; promptVersion: string; step: number }
  | { kind: 'transfer'; reason: string };

/** An action the AI prepared but may not commit on its own: the owner approval queue (planned A-2, fo_pending_actions).
 * Approving performs it exactly once; rejecting or expiry discards it. */
export type PendingAction = {
  id: string;
  workspaceId: string;
  product: Product;
  contactId: string | null;
  callId: string | null;            // fo_calls.id when raised on a call
  mode: OperatingMode;              // the mode in force when it was requested
  payload: PendingActionPayload;
  /** Plain-English line for the owner: "Book Sam for Tue 10:00". */
  summary: string;
  status: PendingActionStatus;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedBy: string | null;         // auth user id
  note: string | null;              // result or reason, at most 500 characters
};

/** The modes one business runs (planned A-2). */
export type OperatingModes = { setter: OperatingMode; receptionist: OperatingMode };

/** Whether one connection is set up and checked, without any key, token or secret. */
export type ChannelConnectionState = {
  target: ConnectionTarget;
  status: ConnectionStatus;
  mode: ConnectionMode;
  /** Public address only: the phone number, inbox or page name. Never a key. */
  address: string | null;
  checkedAt: string | null;
  /** Plain-English line for the owner: what works, or what is missing. */
  detail: string;
};

/** One entry in a contact's history (fo_events). */
export type ActivityEvent = {
  id: number;                       // id (identity)
  contactId: string;                // contact_id
  kind: ActivityKind;               // kind
  fromState: ContactState | null;   // from_state
  toState: ContactState | null;     // to_state
  agent: Agent | null;              // agent
  detail: string | null;            // detail
  createdAt: string;                // created_at
};

/** One phone call (fo_calls). */
export type CallRecord = {
  id: string;                       // id
  channelId: string;                // channel_id
  contactId: string | null;         // contact_id (null while the number is withheld)
  caller: string | null;            // caller, E.164
  outcomes: CallOutcome[];          // outcomes
  endedReason: string | null;       // ended_reason
  summary: string | null;           // summary
  startedAt: string;                // started_at
  endedAt: string | null;           // ended_at
};

/** One Setter turn (setter/agent.ts SetterTurn, plus mode and held actions from A-8). */
export type SetterRunResult = {
  reply: string | null;
  state: ContactState;
  booked: boolean;
  handedTo: Agent | null;
  tools: string[];
  mode: OperatingMode;
  pendingActionIds: string[];
};

/** One Receptionist caller turn (receptionist/agent.ts TurnSummary, plus call, contact, mode and held actions from A-7). */
export type ReceptionistRunResult = {
  said: string;
  tools: string[];
  outcomes: CallOutcome[];
  action: CallAction | null;
  callId: string | null;
  contactId: string | null;
  mode: OperatingMode;
  pendingActionIds: string[];
};

/** POST /api/front-office/chat response (exists today: app/api/front-office/chat/route.ts). */
export type ChatReply = {
  reply: string | null;
  /** True when the AI answered; false when the message was recorded for a person. */
  live: boolean;
  demo: boolean;
  booked: boolean;
  state: ContactState | null;
  note: string | null;
};

// ---------------------------------------------------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------------------------------------------------

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

class Invalid extends Error {}
type Obj = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const E164 = /^\+[1-9][0-9]{6,14}$/;

function run<T>(input: unknown, what: string, read: (o: Obj) => T): ParseResult<T> {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Invalid(`${what} must be an object.`);
    return { ok: true, value: read(input as Obj) };
  } catch (e) {
    return { ok: false, error: e instanceof Invalid ? e.message : `${what} is not valid.` };
  }
}
function obj(v: unknown, field: string): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Invalid(`${field} must be an object.`);
  return v as Obj;
}
function str(v: unknown, field: string, max = 4000, min = 0): string {
  if (typeof v !== 'string' || v.length < min || v.length > max) throw new Invalid(min > 0 ? `${field} must be text of 1 to ${max} characters.` : `${field} must be text of at most ${max} characters.`);
  return v;
}
function optStr(v: unknown, field: string, max = 4000): string | null {
  return v === null || v === undefined ? null : str(v, field, max);
}
function id(v: unknown, field: string): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new Invalid(`${field} must be an id.`);
  return v;
}
function optId(v: unknown, field: string): string | null {
  return v === null || v === undefined ? null : id(v, field);
}
function time(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.length > 40 || !Number.isFinite(Date.parse(v))) throw new Invalid(`${field} must be a date and time.`);
  return v;
}
function optTime(v: unknown, field: string): string | null {
  return v === null || v === undefined ? null : time(v, field);
}
function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw new Invalid(`${field} must be true or false.`);
  return v;
}
function count(v: unknown, field: string): number {
  if (!Number.isSafeInteger(v) || (v as number) < 0) throw new Invalid(`${field} must be a whole number of 0 or more.`);
  return v as number;
}
function oneOf<T extends string>(list: readonly T[], v: unknown, field: string): T {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw new Invalid(`${field} must be one of: ${list.join(', ')}.`);
  return v as T;
}
function optOneOf<T extends string>(list: readonly T[], v: unknown, field: string): T | null {
  return v === null || v === undefined ? null : oneOf(list, v, field);
}
function strings(v: unknown, field: string, max = 50): string[] {
  if (!Array.isArray(v) || v.length > max) throw new Invalid(`${field} must be a list of at most ${max}.`);
  return v.map((x, i) => str(x, `${field} ${i + 1}`, 200));
}
function ids(v: unknown, field: string): string[] {
  if (!Array.isArray(v) || v.length > 50) throw new Invalid(`${field} must be a list of at most 50 ids.`);
  return v.map((x, i) => id(x, `${field} ${i + 1}`));
}
function optPhone(v: unknown, field: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' || !E164.test(v)) throw new Invalid(`${field} must be a number like +61412345678.`);
  return v;
}
function answers(v: unknown): Record<string, string> {
  const o = obj(v ?? {}, 'Answers');
  const out: Record<string, string> = {};
  const entries = Object.entries(o);
  if (entries.length > 50) throw new Invalid('Answers has too many entries.');
  for (const [k, a] of entries) out[str(k, 'Answer id', 80, 1)] = str(a, `Answer ${k}`, 1000);
  return out;
}

export const isOperatingMode = (v: unknown): v is OperatingMode => typeof v === 'string' && (operatingModes as readonly string[]).includes(v);
export const isContactState = (v: unknown): v is ContactState => typeof v === 'string' && (contactStates as readonly string[]).includes(v);
export const isChannelKind = (v: unknown): v is ChannelKind => typeof v === 'string' && (channelKinds as readonly string[]).includes(v);

export function parseOperatingMode(v: unknown): ParseResult<OperatingMode> {
  return isOperatingMode(v) ? { ok: true, value: v } : { ok: false, error: `Operating mode must be one of: ${operatingModes.join(', ')}.` };
}

export function parseOperatingModes(input: unknown): ParseResult<OperatingModes> {
  return run(input, 'Operating modes', o => ({
    setter: oneOf(operatingModes, o.setter, 'Setter mode'),
    receptionist: oneOf(operatingModes, o.receptionist, 'Receptionist mode'),
  }));
}

export function parseContact(input: unknown): ParseResult<Contact> {
  return run(input, 'Contact', o => {
    const c: Contact = {
      id: id(o.id, 'Contact id'),
      workspaceId: id(o.workspaceId, 'Workspace id'),
      name: optStr(o.name, 'Name', 160),
      phone: optPhone(o.phone, 'Phone'),
      email: optStr(o.email, 'Email', 254),
      webVisitor: optStr(o.webVisitor, 'Web visitor', 64),
      instagramId: optStr(o.instagramId, 'Instagram id', 30),
      messengerId: optStr(o.messengerId, 'Messenger id', 30),
      state: oneOf(contactStates, o.state, 'State'),
      source: oneOf(contactSources, o.source, 'Source'),
      optedOut: bool(o.optedOut, 'Opted out'),
      optedOutAt: optTime(o.optedOutAt, 'Opted out at'),
      answers: answers(o.answers),
      createdAt: time(o.createdAt, 'Created at'),
      updatedAt: time(o.updatedAt, 'Updated at'),
    };
    if (c.email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) throw new Invalid('Email is not valid.');
    if (!c.phone && !c.email && !c.webVisitor && !c.instagramId && !c.messengerId) throw new Invalid('Contact needs a phone, email, visitor or social id.');
    if (c.optedOut !== (c.optedOutAt !== null)) throw new Invalid('Opted out and opted out at disagree.');
    return c;
  });
}

export function parseMessage(input: unknown): ParseResult<Message> {
  return run(input, 'Message', o => {
    const m: Message = {
      id: id(o.id, 'Message id'),
      contactId: id(o.contactId, 'Contact id'),
      channelId: optId(o.channelId, 'Channel id'),
      channel: optOneOf(channelKinds, o.channel, 'Channel'),
      direction: oneOf(messageDirections, o.direction, 'Direction'),
      body: str(o.body, 'Body', 4000),
      agent: optOneOf(messageAuthors, o.agent, 'Agent'),
      promptVersion: optStr(o.promptVersion, 'Prompt version', 160),
      createdAt: time(o.createdAt, 'Created at'),
    };
    // Same rules as the fo_messages checks: every outbound message has an author; every automated one a prompt version.
    if (m.direction === 'outbound' && !m.agent) throw new Invalid('Outbound message needs an agent.');
    if (m.direction === 'outbound' && m.agent !== 'human' && !m.promptVersion) throw new Invalid('Automated message needs a prompt version.');
    return m;
  });
}

export function parseConversation(input: unknown): ParseResult<Conversation> {
  return run(input, 'Conversation', o => ({
    contactId: id(o.contactId, 'Contact id'),
    channel: oneOf(channelKinds, o.channel, 'Channel'),
    contactName: optStr(o.contactName, 'Contact name', 160),
    state: oneOf(contactStates, o.state, 'State'),
    optedOut: bool(o.optedOut, 'Opted out'),
    lastMessageAt: time(o.lastMessageAt, 'Last message at'),
    lastDirection: oneOf(messageDirections, o.lastDirection, 'Last direction'),
    preview: str(o.preview, 'Preview', 160),
    messageCount: count(o.messageCount, 'Message count'),
    pendingActions: count(o.pendingActions, 'Pending actions'),
    needsOwner: bool(o.needsOwner, 'Needs owner'),
  }));
}

export function parseBooking(input: unknown): ParseResult<Booking> {
  return run(input, 'Booking', o => {
    const b: Booking = {
      id: id(o.id, 'Booking id'),
      contactId: id(o.contactId, 'Contact id'),
      startsAt: time(o.startsAt, 'Starts at'),
      endsAt: time(o.endsAt, 'Ends at'),
      provider: oneOf(calendarProviders, o.provider, 'Provider'),
      status: oneOf(bookingStatuses, o.status, 'Status'),
      createdAt: time(o.createdAt, 'Created at'),
    };
    const len = Date.parse(b.endsAt) - Date.parse(b.startsAt);
    if (len <= 0 || len > 8 * 3_600_000) throw new Invalid('Booking must end after it starts and last at most 8 hours.');
    return b;
  });
}

function payload(v: unknown): PendingActionPayload {
  const p = obj(v, 'Payload');
  const kind = oneOf(pendingActionKinds, p.kind, 'Action');
  const span = () => {
    const start = time(p.start, 'Start'), end = time(p.end, 'End');
    if (Date.parse(end) <= Date.parse(start)) throw new Invalid('End must be after start.');
    return { start, end, timeZone: str(p.timeZone, 'Time zone', 60, 1) };
  };
  switch (kind) {
    case 'book': return { kind, ...span() };
    case 'reschedule': return { kind, bookingId: id(p.bookingId, 'Booking id'), ...span() };
    case 'cancel': return { kind, bookingId: id(p.bookingId, 'Booking id'), reason: str(p.reason, 'Reason', 400) };
    // 1000 = fo_outbox.body limit (migration 202611060005), where held sends are stored.
    case 'send': return { kind, channel: oneOf(channelKinds, p.channel, 'Channel'), body: str(p.body, 'Body', 1000, 1), promptVersion: str(p.promptVersion, 'Prompt version', 160, 1) };
    case 'follow_up': {
      const step = count(p.step, 'Step');
      if (step < 1 || step > 50) throw new Invalid('Step must be 1 to 50.');
      return { kind, channel: oneOf(channelKinds, p.channel, 'Channel'), body: str(p.body, 'Body', 1000, 1), promptVersion: str(p.promptVersion, 'Prompt version', 160, 1), step };
    }
    case 'transfer': return { kind, reason: str(p.reason, 'Reason', 400) };
  }
}

export function parsePendingAction(input: unknown): ParseResult<PendingAction> {
  return run(input, 'Pending action', o => {
    const a: PendingAction = {
      id: id(o.id, 'Pending action id'),
      workspaceId: id(o.workspaceId, 'Workspace id'),
      product: oneOf(products, o.product, 'Product'),
      contactId: optId(o.contactId, 'Contact id'),
      callId: optId(o.callId, 'Call id'),
      mode: oneOf(operatingModes, o.mode, 'Mode'),
      payload: payload(o.payload),
      summary: str(o.summary, 'Summary', 300, 1),
      status: oneOf(pendingActionStatuses, o.status, 'Status'),
      createdAt: time(o.createdAt, 'Created at'),
      expiresAt: time(o.expiresAt, 'Expires at'),
      decidedAt: optTime(o.decidedAt, 'Decided at'),
      decidedBy: optId(o.decidedBy, 'Decided by'),
      note: optStr(o.note, 'Note', 500),
    };
    // Only owner_approval holds actions: automatic performs them, enquiry_only refuses them.
    if (a.mode !== 'owner_approval') throw new Invalid('Only owner approval mode holds actions.');
    if (a.status === 'pending' && a.decidedAt !== null) throw new Invalid('A pending action has no decision yet.');
    if (Date.parse(a.expiresAt) <= Date.parse(a.createdAt)) throw new Invalid('Expires at must be after created at.');
    return a;
  });
}

export function parseChannelConnectionState(input: unknown): ParseResult<ChannelConnectionState> {
  return run(input, 'Connection', o => {
    const c: ChannelConnectionState = {
      target: oneOf(connectionTargets, o.target, 'Connection'),
      status: oneOf(connectionStatuses, o.status, 'Status'),
      mode: oneOf(connectionModes, o.mode, 'Mode'),
      address: optStr(o.address, 'Address', 254),
      checkedAt: optTime(o.checkedAt, 'Checked at'),
      detail: str(o.detail, 'Detail', 300),
    };
    if (c.mode === 'LIVE' && c.status !== 'verified') throw new Invalid('Only a verified connection can be LIVE.');
    return c;
  });
}

export function parseActivityEvent(input: unknown): ParseResult<ActivityEvent> {
  return run(input, 'Activity', o => {
    const n = o.id;
    if (!Number.isSafeInteger(n) || (n as number) < 1) throw new Invalid('Activity id must be a positive whole number.');
    return {
      id: n as number,
      contactId: id(o.contactId, 'Contact id'),
      kind: oneOf(activityKinds, o.kind, 'Kind'),
      fromState: optOneOf(contactStates, o.fromState, 'From state'),
      toState: optOneOf(contactStates, o.toState, 'To state'),
      agent: optOneOf(agents, o.agent, 'Agent'),
      detail: optStr(o.detail, 'Detail', 500),
      createdAt: time(o.createdAt, 'Created at'),
    };
  });
}

export function parseCallRecord(input: unknown): ParseResult<CallRecord> {
  return run(input, 'Call', o => {
    if (!Array.isArray(o.outcomes)) throw new Invalid('Outcomes must be a list.');
    return {
      id: id(o.id, 'Call id'),
      channelId: id(o.channelId, 'Channel id'),
      contactId: optId(o.contactId, 'Contact id'),
      caller: optPhone(o.caller, 'Caller'),
      outcomes: o.outcomes.map((x, i) => oneOf(callOutcomes, x, `Outcome ${i + 1}`)),
      endedReason: optStr(o.endedReason, 'Ended reason', 120),
      summary: optStr(o.summary, 'Summary', 4000),
      startedAt: time(o.startedAt, 'Started at'),
      endedAt: optTime(o.endedAt, 'Ended at'),
    };
  });
}

export function parseSetterRunResult(input: unknown): ParseResult<SetterRunResult> {
  return run(input, 'Setter result', o => {
    const r: SetterRunResult = {
      reply: optStr(o.reply, 'Reply', 4000),
      state: oneOf(contactStates, o.state, 'State'),
      booked: bool(o.booked, 'Booked'),
      handedTo: optOneOf(agents, o.handedTo, 'Handed to'),
      tools: strings(o.tools, 'Tools'),
      mode: oneOf(operatingModes, o.mode, 'Mode'),
      pendingActionIds: ids(o.pendingActionIds, 'Pending actions'),
    };
    if (r.booked && r.mode !== 'automatic') throw new Invalid('Only automatic mode books directly.');
    if (r.pendingActionIds.length && r.mode !== 'owner_approval') throw new Invalid('Only owner approval mode holds actions.');
    return r;
  });
}

export function parseReceptionistRunResult(input: unknown): ParseResult<ReceptionistRunResult> {
  return run(input, 'Receptionist result', o => {
    if (!Array.isArray(o.outcomes)) throw new Invalid('Outcomes must be a list.');
    const r: ReceptionistRunResult = {
      said: str(o.said, 'Said', 8000),
      tools: strings(o.tools, 'Tools'),
      outcomes: o.outcomes.map((x, i) => oneOf(callOutcomes, x, `Outcome ${i + 1}`)),
      action: optOneOf(callActions, o.action, 'Action'),
      callId: optId(o.callId, 'Call id'),
      contactId: optId(o.contactId, 'Contact id'),
      mode: oneOf(operatingModes, o.mode, 'Mode'),
      pendingActionIds: ids(o.pendingActionIds, 'Pending actions'),
    };
    const commits = r.outcomes.some(x => x === 'booked' || x === 'rescheduled' || x === 'cancelled' || x === 'transfer') || r.action === 'transfer';
    if (commits && r.mode !== 'automatic') throw new Invalid('Only automatic mode books, changes or transfers directly.');
    if (r.pendingActionIds.length && r.mode !== 'owner_approval') throw new Invalid('Only owner approval mode holds actions.');
    return r;
  });
}

/** Accepts the chat route's response as sent today (optional fields may be missing) and fills the gaps. */
export function parseChatReply(input: unknown): ParseResult<ChatReply> {
  return run(input, 'Chat reply', o => ({
    reply: optStr(o.reply, 'Reply', 4000),
    live: bool(o.live, 'Live'),
    demo: o.demo === undefined ? false : bool(o.demo, 'Demo'),
    booked: o.booked === undefined ? false : bool(o.booked, 'Booked'),
    state: optOneOf(contactStates, o.state, 'State'),
    note: optStr(o.note, 'Note', 500),
  }));
}

/** A list of items, each checked with the same parser. Stops at the first bad item and says which. */
export function parseList<T>(input: unknown, parse: (v: unknown) => ParseResult<T>, max = 500): ParseResult<T[]> {
  if (!Array.isArray(input)) return { ok: false, error: 'Expected a list.' };
  if (input.length > max) return { ok: false, error: `List has more than ${max} items.` };
  const out: T[] = [];
  for (let i = 0; i < input.length; i++) {
    const r = parse(input[i]);
    if (!r.ok) return { ok: false, error: `Item ${i + 1}: ${r.error}` };
    out.push(r.value);
  }
  return { ok: true, value: out };
}
