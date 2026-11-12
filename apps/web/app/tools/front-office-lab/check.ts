// Pure helpers for the Front Office Lab page (task A-27). No I/O, no Next imports. Everything here reuses production logic:
// crm.ts (the one customer record: phone and email keys, duplicate collapsing) and receptionist/identity.ts (the A-20
// identity check). Nothing is sent and FRONT_OFFICE_SEND_LIVE is never read.
import { collapseDuplicates, contactKeys, normaliseEmail, readPhone } from '../../../lib/front-office/crm';
import type { Contact, OperatingMode } from '../../../lib/front-office/contracts';
import { nameMatches } from '../../../lib/front-office/receptionist/identity';

export const MODE_LABELS: Record<OperatingMode, string> = { automatic: 'Automatic', owner_approval: 'Owner approval', enquiry_only: 'Enquiry only' };
export const modeLabel = (m: unknown): string => (typeof m === 'string' && m in MODE_LABELS ? MODE_LABELS[m as OperatingMode] : MODE_LABELS.enquiry_only);

/** States a contact reaches only after the Setter's qualifying questions. The stored state does not say WHICH agent moved
 * it, so this is "qualified by the Setter flow", read from fo_contacts.state. */
export const SETTER_QUALIFIED_STATES: readonly string[] = ['qualified', 'booked', 'customer'];
export const isSetterQualified = (c: Pick<Contact, 'state'>): boolean => SETTER_QUALIFIED_STATES.includes(c.state);

export type CrossChannelStatus =
  | 'bad_input'        // no readable phone or email
  | 'not_found'        // nobody on this number or email in the workspace
  | 'needs_identity'   // a record matches the number, but no identity detail was given: NOT recognised
  | 'identity_failed'  // detail given and it does not match: NOT recognised
  | 'recognised';      // number matches and the identity check passed

export type CrossChannelResult = {
  status: CrossChannelStatus;
  /** Plain English for the owner. */
  message: string;
  recognised: boolean;
  /** True when the Receptionist would still be refused account details until identity is confirmed. */
  identityRequired: true;
  matches: number;
  /** Only filled once recognised (before that the page shows nothing about the person, like the caller-facing rule). */
  contact: { name: string | null; state: string; setterQualified: boolean } | null;
};

export const IDENTITY_NOTE = 'Caller ID can be spoofed, so a matching number alone never counts as recognition. The caller must also give the name on the record (the A-20 identity check).';

const result = (status: CrossChannelStatus, message: string, matches = 0, contact: CrossChannelResult['contact'] = null): CrossChannelResult =>
  ({ status, message, recognised: status === 'recognised', identityRequired: true, matches, contact });

/** Would the Receptionist recognise this person? `contacts` are fo_contacts rows already read for ONE workspace.
 * A record found by phone or email is only a candidate; recognition needs `verifyName` to match the name on file. */
export function crossChannelCheck(input: { phone?: string; email?: string; verifyName?: string }, contacts: readonly Contact[]): CrossChannelResult {
  const phoneText = (input.phone ?? '').trim(), emailText = (input.email ?? '').trim();
  const p = phoneText ? readPhone(phoneText) : null, e = emailText ? normaliseEmail(emailText) : null;
  if (p && !p.ok) return result('bad_input', p.reason);
  if (emailText && !e) return result('bad_input', 'That email does not look right.');
  const phone = p && p.ok ? p.phone : null;
  if (!phone && !e) return result('bad_input', 'Enter a phone number or an email address.');
  const wanted = new Set(contactKeys({ phone, email: e }));
  const found = collapseDuplicates(contacts).filter(c => contactKeys(c).some(k => wanted.has(k)));
  if (!found.length) return result('not_found', 'Nobody in this workspace has that number or email, so the Receptionist would treat the caller as new.');
  // Several distinct people on one key should not happen (the database is unique per key); refuse rather than guess.
  if (found.length > 1) return result('needs_identity', 'More than one record matches. Nothing is shown until the records are merged.', found.length);
  const c = found[0];
  const given = (input.verifyName ?? '').trim();
  if (!given) return result('needs_identity', `A record matches this number, but the Receptionist does not recognise the caller yet: it must ask for the name on the booking first. ${IDENTITY_NOTE}`, 1);
  if (!nameMatches(given, c.name)) return result('identity_failed', 'The name given does not match the record. The Receptionist would not recognise the caller, would reveal nothing and would pass the request to staff.', 1);
  const qualified = isSetterQualified(c);
  return result('recognised', qualified
    ? 'Recognised after the identity check. This person was qualified by the Setter flow, so the Receptionist continues from the same customer record.'
    : 'Recognised after the identity check. The record is not at a Setter-qualified state yet.', 1, { name: c.name, state: c.state, setterQualified: qualified });
}

/** Today's lab spend as one line for the page. */
export function usageLine(u: { spentAud: number; capAud: number; day: string; persistent: boolean }): string {
  return `A$${u.spentAud.toFixed(2)} of A$${u.capAud.toFixed(2)} on ${u.day} (estimate${u.persistent ? '' : ', server memory only'})`;
}
