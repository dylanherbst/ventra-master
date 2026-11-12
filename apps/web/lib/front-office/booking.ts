// Setter booking flow (tracker 1.3): offer two or three concrete times from the live calendar, book the chosen slot,
// record it and move the contact to booked, then send the confirmation (the calendar invite goes from Google).
import { createHash } from 'node:crypto';
import type { CalendarProvider } from './calendar/google';
import { formatSlot, openSlots, pickOffers } from './calendar/slots';
import type { Availability, Interval } from './calendar/slots';
import { deliverableEmail } from './contracts';
import type { ChannelAuth, Rpc } from './orchestrator';
import type { SmsSender } from './sms-send';

export const BOOKING_CONFIRMATION_PROMPT = 'setter/booking-confirmation@1';
const DAY = 86_400_000;

export type BookingContact = { id: string; name: string | null; phone: string | null; email: string | null };
export type Offer = Interval & { label: string };
export class SlotTaken extends Error { constructor() { super('That time was just taken. Here are the next open times.'); this.name = 'SlotTaken'; } }

/** Two or three open times, as labels the Setter can put straight into a message. */
export async function offerTimes(calendar: CalendarProvider, availability: Availability, now: number, count = 3): Promise<Offer[]> {
  const busy = await calendar.busy(now, now + (availability.horizonDays + 1) * DAY);
  return pickOffers(openSlots(availability, busy, now), availability.timeZone, count).map(s => ({ ...s, label: formatSlot(s.start, availability.timeZone) }));
}

/** Google event id: base32hex-safe, the same for the same contact and start, so a retry cannot double-book. */
export function bookingEventId(contactId: string, start: number): string {
  return 'vb' + createHash('sha256').update(`${contactId}|${start}`).digest('hex').slice(0, 40);
}

export function confirmationText(businessName: string, start: number, timeZone: string, where: string): string {
  return `You're booked with ${businessName} for ${formatSlot(start, timeZone)} (${where}). We'll send a reminder the day before. Reply here to change it, or STOP to opt out.`;
}

export type BookInput = {
  calendar: CalendarProvider; rpc: Rpc; auth: ChannelAuth; send: SmsSender;
  availability: Availability; contact: BookingContact; start: number; now: number;
  businessName: string; where: string; meetingTitle: string;
};
export type BookResult = { appointment: string; duplicate: boolean; eventId: string; confirmation: string; sent: boolean };

export async function bookSlot(i: BookInput): Promise<BookResult> {
  const dur = i.availability.slotMinutes * 60_000;
  const eventId = bookingEventId(i.contact.id, i.start);
  const auth = { channel: i.auth.channel, channel_key: i.auth.key };
  // Already recorded (a retry after success): return it, change nothing.
  const known = await i.rpc('fo_booking_for_event', { ...auth, calendar_provider: 'google', event_id: eventId }) as string | null;
  if (known) return { appointment: known, duplicate: true, eventId, confirmation: '', sent: false };
  // Re-read the calendar: the slot may have gone since it was offered. If it is busy only because our own earlier
  // attempt created the event and then failed to record it, carry on and record it.
  const busy = await i.calendar.busy(i.start - DAY, i.start + DAY);
  const stillOpen = openSlots(i.availability, busy, i.now).some(s => s.start === i.start);
  const ours = !stillOpen && await i.calendar.hasEvent(eventId);
  if (!stillOpen && !ours) throw new SlotTaken();
  const email = deliverableEmail(i.contact.email); // a placeholder address never gets a calendar invite
  const who = i.contact.name ?? i.contact.phone ?? email ?? 'Lead';
  if (!ours) await i.calendar.createEvent({
    id: eventId, summary: `${i.meetingTitle}: ${who}`, start: i.start, end: i.start + dur, timeZone: i.availability.timeZone,
    description: `Booked by the VENTRA Setter. Contact: ${[i.contact.phone, email].filter(Boolean).join(', ')}`,
    attendeeEmail: email,
  });
  const booked = await i.rpc('fo_book', { ...auth, contact: i.contact.id, starts: new Date(i.start).toISOString(), ends: new Date(i.start + dur).toISOString(), calendar_provider: 'google', event_id: eventId }) as Record<string, unknown>;
  if (booked.duplicate === true) return { appointment: String(booked.appointment), duplicate: true, eventId, confirmation: '', sent: false };
  const confirmation = confirmationText(i.businessName, i.start, i.availability.timeZone, i.where);
  // Logged before anything is sent (tracker 0.6). By SMS when there is a mobile; on chat or email it is the reply itself.
  await i.rpc('fo_log_outbound', { ...auth, contact: i.contact.id, message: confirmation, agent_name: 'setter', prompt: BOOKING_CONFIRMATION_PROMPT });
  let sent = false;
  if (i.contact.phone) sent = (await i.send(i.contact.phone, confirmation)).sent;
  return { appointment: String(booked.appointment), duplicate: false, eventId, confirmation, sent };
}

export const RESCHEDULE_PROMPT = 'receptionist/booking-moved@1', CANCEL_PROMPT = 'receptionist/booking-cancelled@1';
export type MoveInput = {
  calendar: CalendarProvider; rpc: Rpc; auth: ChannelAuth; send: SmsSender; availability: Availability;
  contact: BookingContact; appointment: { id: string; starts: string }; start: number; now: number; businessName: string; where: string;
};
/** Move a booking to another open time. The record moves first (fo_reschedule returns the stored calendar event id
 * and cancels the old reminder jobs), then the calendar event (same id); if the calendar refuses, the record is moved
 * back. The caller schedules new reminders. */
export async function rescheduleSlot(i: MoveInput): Promise<{ eventId: string; confirmation: string; sent: boolean }> {
  if (!i.calendar.moveEvent) throw new Error('This calendar cannot move bookings.');
  const dur = i.availability.slotMinutes * 60_000, oldStart = Date.parse(i.appointment.starts);
  const busy = await i.calendar.busy(i.start - DAY, i.start + DAY);
  if (!openSlots(i.availability, busy, i.now).some(s => s.start === i.start)) throw new SlotTaken();
  const auth = { channel: i.auth.channel, channel_key: i.auth.key };
  const at = (t: number) => ({ ...auth, contact: i.contact.id, appointment: i.appointment.id, starts: new Date(t).toISOString(), ends: new Date(t + dur).toISOString() });
  const moved = await i.rpc('fo_reschedule', at(i.start)) as { eventId: string };
  try { await i.calendar.moveEvent(moved.eventId, i.start, i.start + dur, i.availability.timeZone); }
  catch (e) { await i.rpc('fo_reschedule', at(oldStart)).catch(() => undefined); throw e; }
  const confirmation = `Done: your booking with ${i.businessName} is now ${formatSlot(i.start, i.availability.timeZone)} (${i.where}). Reply here to change it, or STOP to opt out.`;
  await i.rpc('fo_log_outbound', { ...auth, contact: i.contact.id, message: confirmation, agent_name: 'receptionist', prompt: RESCHEDULE_PROMPT });
  const sent = i.contact.phone ? (await i.send(i.contact.phone, confirmation)).sent : false;
  return { eventId: moved.eventId, confirmation, sent };
}
/** Cancel a booking: record first (reminders stop), then remove the calendar event. */
export async function cancelBooking(i: { calendar: CalendarProvider | null; rpc: Rpc; auth: ChannelAuth; send: SmsSender; contact: BookingContact; appointment: { id: string; starts: string }; reason: string; businessName: string; timeZone: string }): Promise<{ confirmation: string; sent: boolean; calendarUpdated: boolean }> {
  const auth = { channel: i.auth.channel, channel_key: i.auth.key };
  const r = await i.rpc('fo_cancel_booking', { ...auth, contact: i.contact.id, appointment: i.appointment.id, reason: i.reason.slice(0, 400) }) as { eventId?: string };
  let calendarUpdated = false;
  if (i.calendar?.cancelEvent && r.eventId) { await i.calendar.cancelEvent(r.eventId); calendarUpdated = true; }
  const confirmation = `Your booking with ${i.businessName} on ${formatSlot(Date.parse(i.appointment.starts), i.timeZone)} is cancelled. Reply any time to book again, or STOP to opt out.`;
  await i.rpc('fo_log_outbound', { ...auth, contact: i.contact.id, message: confirmation, agent_name: 'receptionist', prompt: CANCEL_PROMPT });
  const sent = i.contact.phone ? (await i.send(i.contact.phone, confirmation)).sent : false;
  return { confirmation, sent, calendarUpdated };
}
