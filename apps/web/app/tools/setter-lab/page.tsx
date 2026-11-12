import { connection } from 'next/server';
import { newLab } from '../../../lib/front-office/setter/lab';
import { labUsageToday } from '../../../lib/front-office/lab-usage';
import SetterLab from './lab';
import { getLabSession } from './actions';

// Isolated test page for the AI Setter (tasks A-3, A-23b). Customer messages run through the real inbound router and
// Setter pipeline with an in-memory store and calendar. Demo mode uses the scripted model; Live AI Test uses the real
// model for signed-in users only, capped per day (server side), with all other side effects sandboxed.
// Lab sandbox (task A-34): loading this page adds no conversation rows, but a signed-in visitor with the lab key set gets
// their sandbox workspace created on first visit (ensureLabSandbox in getLabSession).
export default async function SetterLabPage() {
  await connection();
  const { persistence, scenarios } = await getLabSession();
  return <SetterLab initial={newLab('owner_approval')} initialUsage={await labUsageToday()} initialPersistence={persistence} initialScenarios={scenarios} />;
}
