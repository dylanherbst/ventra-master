import { connection } from 'next/server';
import { googleConfigFromEnv } from '../../../lib/front-office/calendar/google';
import { anthropicConfigFromEnv } from '../../../lib/front-office/llm';
import { fixtures } from '../../../lib/front-office/receptionist/simulate';
import ReceptionistLab from './lab';
import LiveCall from './live-call';
import { startCall, usageForPage } from './live';
import { getReceptionistLabSession } from './actions';

// Isolated test page for the AI Receptionist (task A-4). It runs a simulated inbound call through the real Receptionist
// pipeline. The connection list below only reports whether each real connection is set up (yes or no, never a value);
// the lab itself uses none of them.
export default async function ReceptionistLabPage() {
  await connection();
  const status = [
    { name: 'Live voice switch (FRONT_OFFICE_VOICE_LIVE)', on: process.env.FRONT_OFFICE_VOICE_LIVE === '1', onText: 'ON', offText: 'OFF' },
    { name: 'Voice channel (Vapi)', on: !!process.env.FRONT_OFFICE_VOICE_CHANNEL_ID?.trim(), onText: 'CONNECTED', offText: 'NOT CONNECTED' },
    { name: 'AI model', on: !!anthropicConfigFromEnv(), onText: 'CONFIGURED', offText: 'NOT CONFIGURED' },
    { name: 'Google Calendar', on: !!googleConfigFromEnv(), onText: 'CONNECTED', offText: 'NOT CONNECTED' },
    { name: 'Live sending (FRONT_OFFICE_SEND_LIVE)', on: process.env.FRONT_OFFICE_SEND_LIVE === '1', onText: 'ON', offText: 'OFF' },
  ].map(s => ({ name: s.name, state: s.on ? s.onText : s.offText }));
  // Live AI Test (task A-41): only a yes/no that the model is configured reaches the page, never a value.
  // Neither read can break the demo section above: startCall returns a fixed error string instead of throwing, and
  // usageForPage falls back to a NOT READ line if the usage store fails.
  // Lab sandbox (task A-34): in database mode no call is started on page load (it would add a call row on every visit); the
  // visitor presses New call. Opening the page still creates the user's sandbox workspace on first visit (ensureLabSandbox). In memory mode the greeting call is started in memory as before.
  const { persistence, scenarios } = await getReceptionistLabSession();
  const first = persistence.mode === 'database' ? { state: null, error: null } : await startCall();
  const usage = await usageForPage();
  return <>
    <ReceptionistLab status={status} fixtures={fixtures.map(f => ({ id: f.id, title: f.title, covers: f.covers, lines: f.turns.map(t => t.says) }))} />
    <LiveCall modelConfigured={!!anthropicConfigFromEnv()} initial={first.state} initialError={first.error} initialUsage={usage} initialPersistence={persistence} initialScenarios={scenarios} />
  </>;
}
