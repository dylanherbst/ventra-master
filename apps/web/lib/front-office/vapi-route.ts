// Request handling for the Vapi endpoints (route files only export handlers, so the logic lives here).
// Two URL shapes, same behaviour:
//   /api/front-office/voice/vapi/chat/completions and /webhook            channel = FRONT_OFFICE_VOICE_CHANNEL_ID (Ventra)
//   /api/front-office/voice/vapi/<channel id>/chat/completions and /webhook  one Vapi assistant per business
// The token Vapi sends (Bearer or X-Vapi-Secret) is that voice channel's key; the database checks it against the hash.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createSupabaseClient } from '../supabase/client';
import { routeLimits } from '../rate-limit';
import { readBoundedRequestBody, RequestBodyTooLarge } from '../request-body';
import { supabaseConfigured } from '../workspace-route';
import { googleCalendar, googleConfigFromEnv } from './calendar/google';
import { emailSenderFromEnv } from './email';
import { anthropicConfigFromEnv, anthropicStream } from './llm';
import type { StreamLlm } from './llm';
import type { ChannelAuth, Rpc } from './orchestrator';
import { receptionistSession, runReceptionistTurn } from './receptionist/agent';
import { recordDroppedCall } from './receptionist/dropped';
import { greeting, notLiveMessage, RECEPTIONIST_GREETING_VERSION, RECEPTIONIST_NOT_LIVE_VERSION } from './receptionist/prompt';
import { checkedAgentSettings, templateSettings } from './settings';
import type { AgentSettings } from './settings';
import { senderFromEnv } from './sms-send';
import { chunkWriter, parseVapiChat, parseVapiEvent, sameSecret, sseHeaders, vapiToken } from './vapi';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export type VoiceEnv = { rpc?: Rpc; llm?: StreamLlm | null; now?: () => number };

type Opened = { auth: ChannelAuth; rpc: Rpc; settings: AgentSettings; saved: boolean; body: unknown };
/** Rate limit, channel, token, settings, body. Returns a response to send instead when anything is wrong. */
async function open(req: NextRequest, channelParam: string | null, env: VoiceEnv): Promise<Opened | Response> {
  const flood = routeLimits.voiceGlobal('vapi');
  if (!flood.allowed) return json({ error: 'Busy.' }, 429);
  const fromEnv = channelParam === null;
  const channel = (fromEnv ? process.env.FRONT_OFFICE_VOICE_CHANNEL_ID ?? '' : channelParam).trim();
  const key = vapiToken(req.headers);
  if (!UUID.test(channel)) return json({ error: 'Voice is not connected yet.', configured: false }, 503);
  if (key.length < 32) return json({ error: 'Not allowed.' }, 401);
  // The env route also checks the configured key in constant time before touching the database.
  const envKey = (process.env.FRONT_OFFICE_VOICE_CHANNEL_KEY ?? '').trim();
  if (fromEnv && envKey && !sameSecret(key, envKey)) return json({ error: 'Not allowed.' }, 401);
  if (!env.rpc && !supabaseConfigured()) return json({ error: 'Voice is not connected yet.', configured: false }, 503);
  const rpc: Rpc = env.rpc ?? (() => { const db = createSupabaseClient(); return async (fn, args) => { const r = await db.rpc(fn, args); if (r.error) throw new Error(r.error.message); return r.data; }; })();
  const auth = { channel, key };
  let raw: unknown;
  try { raw = await rpc('fo_channel_settings', { channel, channel_key: key }); }
  catch (e) { return e instanceof Error && /Channel not recognised/.test(e.message) ? json({ error: 'Not allowed.' }, 401) : json({ error: 'Storage unavailable.' }, 503); }
  let settings: AgentSettings, saved = false;
  try { settings = raw ? checkedAgentSettings(raw) : templateSettings('ventra'); saved = !!raw; } catch { settings = templateSettings('ventra'); }
  let body: unknown;
  try { body = JSON.parse(await readBoundedRequestBody(req, 512_000)); } catch (e) { return json({ error: 'Invalid request.' }, e instanceof RequestBodyTooLarge ? 413 : 400); }
  return { auth, rpc, settings, saved, body };
}

/** The Receptionist answers only when the owner switched it on (settings) and approved live voice (env). */
export function voiceLive(settings: AgentSettings, saved: boolean, hasAi: boolean): boolean {
  return process.env.FRONT_OFFICE_VOICE_LIVE === '1' && hasAi && saved && settings.receptionistOn && settings.voiceOn;
}

export async function vapiChat(req: NextRequest, channelParam: string | null, env: VoiceEnv = {}): Promise<Response> {
  const o = await open(req, channelParam, env);
  if (o instanceof Response) return o;
  let chat;
  try { chat = parseVapiChat(o.body); } catch { return json({ error: 'Invalid request.' }, 400); }
  const a = { channel: o.auth.channel, channel_key: o.auth.key };
  const now = env.now?.() ?? Date.now();
  let contact: string | null = null;
  if (chat.callId) {
    try {
      const t = await o.rpc('fo_voice_turn', { ...a, call_id: chat.callId, caller: chat.caller, turn: chat.turn, message: chat.lastUser || null }) as { contact: string | null };
      contact = t?.contact ?? null;
    } catch { contact = null; /* keep answering; the end-of-call report records the call */ }
  }
  const ai = env.llm !== undefined ? env.llm : (() => { const c = anthropicConfigFromEnv(); return c ? anthropicStream(c) : null; })();
  const live = voiceLive(o.settings, o.saved, !!ai);
  const w = chunkWriter(typeof (o.body as { model?: unknown }).model === 'string' ? (o.body as { model: string }).model : 'ventra-receptionist', now);
  const enc = new TextEncoder();
  const rpc = o.rpc, settings = o.settings, auth = o.auth;

  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const put = (s: string) => ctrl.enqueue(enc.encode(s));
      put(w.start());
      try {
        if (!live) {
          const text = notLiveMessage(o.saved ? settings : null, !!contact);
          put(w.text(text));
          if (chat.callId) {
            await rpc('fo_voice_outcome', { ...a, call_id: chat.callId, outcome: 'not-live' }).catch(() => undefined);
            await rpc('fo_voice_reply', { ...a, call_id: chat.callId, message: text, prompt: RECEPTIONIST_NOT_LIVE_VERSION }).catch(() => undefined);
          }
          if (contact) {
            const session = await receptionistSession({ rpc, auth, calendar: null, send: senderFromEnv(), email: emailSenderFromEnv(), settings, now, call: { id: chat.callId, caller: chat.caller, contact } });
            await session.run({ type: 'tool_use', id: 'not-live', name: 'take_message', input: { message: 'Called while the AI receptionist was off. Please call back.' } }).catch(() => undefined);
          }
          put(w.tool('endCall', {}));
        } else if (!chat.turn) {
          // Nobody has spoken yet: the fixed greeting (AI disclosure and recording notice guaranteed, no model wait).
          const text = greeting(settings);
          put(w.text(text));
          if (chat.callId) await rpc('fo_voice_reply', { ...a, call_id: chat.callId, message: text, prompt: RECEPTIONIST_GREETING_VERSION }).catch(() => undefined);
          put(w.stop());
        } else {
          const gcal = googleConfigFromEnv();
          const turn = runReceptionistTurn({ llm: ai as StreamLlm, rpc, auth, calendar: gcal ? googleCalendar(gcal) : null, send: senderFromEnv(), email: emailSenderFromEnv(), settings, now, call: { id: chat.callId, caller: chat.caller, contact }, conversation: chat.conversation });
          let action: 'transfer' | 'end' | null = null;
          for await (const out of turn) {
            if (out.type === 'text') put(w.text(out.text));
            else if (out.type === 'transfer') { put(w.tool('transferCall', { destination: out.number })); action = 'transfer'; }
            else if (out.type === 'end') { put(w.tool('endCall', {})); action = 'end'; }
          }
          if (!action) put(w.stop());
        }
      } catch (e) {
        console.error('front-office receptionist turn failed:', e instanceof Error ? e.message : 'unknown');
        put(w.text(' Sorry, I am having trouble right now. Please call back shortly, or leave a message after the call ends.'));
        put(w.stop());
      }
      put(w.done());
      ctrl.close();
    },
  });
  return new Response(stream, { status: 200, headers: sseHeaders });
}

export async function vapiWebhook(req: NextRequest, channelParam: string | null, env: VoiceEnv = {}): Promise<Response> {
  const o = await open(req, channelParam, env);
  if (o instanceof Response) return o;
  let ev;
  try { ev = parseVapiEvent(o.body); } catch { return json({ error: 'Invalid request.' }, 400); }
  const a = { channel: o.auth.channel, channel_key: o.auth.key };
  const now = env.now?.() ?? Date.now();
  try {
    switch (ev.type) {
      case 'transfer-destination-request':
        return o.settings.transferNumber
          ? json({ destination: { type: 'number', number: o.settings.transferNumber, message: 'Putting you through now.' } })
          : json({ error: 'No one is available to take the call right now. Offer to take a message.' });
      case 'tool-calls': {
        // Only when tools are set up on the Vapi side instead of our custom LLM: run them the same way.
        let contact: string | null = null;
        if (ev.callId) contact = ((await o.rpc('fo_voice_turn', { ...a, call_id: ev.callId, caller: ev.caller, turn: null, message: null })) as { contact: string | null })?.contact ?? null;
        const gcal = googleConfigFromEnv();
        const session = await receptionistSession({ rpc: o.rpc, auth: o.auth, calendar: gcal ? googleCalendar(gcal) : null, send: senderFromEnv(), email: emailSenderFromEnv(), settings: o.settings, now, call: { id: ev.callId, caller: ev.caller, contact } });
        const results = [];
        for (const t of ev.toolCalls) {
          let result: string;
          try { result = await session.run({ type: 'tool_use', id: t.id, name: t.name, input: t.args }); }
          catch (e) { result = (e instanceof Error ? e.message : 'That did not work.') + ' Offer to take a message.'; }
          results.push({ name: t.name, toolCallId: t.id, result });
        }
        return json({ results });
      }
      case 'end-of-call-report':
        if (ev.callId) {
          const reason = ev.endedReason || 'ended';
          const end = await o.rpc('fo_voice_end', { ...a, call_id: ev.callId, caller: ev.caller, reason, call_summary: ev.summary.slice(0, 4000), call_transcript: ev.transcript.slice(0, 20000) }) as { contact: string | null; outcomes: string[] | null; first?: boolean } | null;
          // G5: a call that dropped before anything was settled becomes one call-back handoff for staff (first report only).
          if (end) await recordDroppedCall(o.rpc, o.auth, end, { id: ev.callId, caller: ev.caller, reason, transcript: ev.transcript });
        }
        return json({ received: true });
      default:
        // status-update, transcript, conversation-update and the rest: nothing to do.
        return json({ received: true });
    }
  } catch {
    return json({ error: 'Storage unavailable.' }, 503);
  }
}
