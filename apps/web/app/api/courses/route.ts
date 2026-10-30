import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseClient } from '../../../lib/supabase/client';
import { sameOrigin } from '../../../lib/request-security';
import { readBoundedRequestBody, RequestBodyTooLarge } from '../../../lib/request-body';
import { courseDraftFromInput, editEducationCourseDraft } from '../../../lib/local-education-course';
import { uuid } from '../../../lib/workspace-validation';
export const dynamic = 'force-dynamic';
async function handle(req: NextRequest) {
 const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(req.method==='POST' && (!sameOrigin(req.headers.get('origin'),req.headers.get('host'),req.nextUrl.protocol,process.env.LAUNCHPAD_APP_ORIGIN) || !req.headers.get('content-type')?.startsWith('application/json'))) return reply({error:'Use same-origin JSON.'},403);
 if(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return reply({error:'Account storage is not configured. Browser drafts are unchanged.'},503);
 const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
 if(!token)return reply({error:'Sign in to use account storage.'},401);
 try {
  const auth=await createSupabaseClient().auth.getUser(token);
  if(auth.error || !auth.data.user)return reply({error:'Sign in again.'},401);
  const db=createSupabaseClient({fetch:(url,init)=>{const headers=new Headers(init?.headers);headers.set('Authorization','Bearer '+token);return fetch(url,{...init,headers,cache:'no-store'});}});
  if(req.method==='GET') {
   const w=uuid(req.nextUrl.searchParams.get('workspace'));
   const result=await db.from('course_drafts').select('id,data,revision').eq('workspace_id',w);
   return result.error?reply({error:'Unable to load courses. Check migration and membership.'},503):reply({courses:result.data});
  }
  const input=JSON.parse(await readBoundedRequestBody(req));
  const w=uuid(input.workspace),id=uuid(input.id);
  if(!Number.isSafeInteger(input.revision)||input.revision<0)return reply({error:'Refresh before saving.'},400);
  const course=editEducationCourseDraft(courseDraftFromInput(input.course,{id,profileId:w}));
  const result=await db.rpc('save_course',{w,course_id:id,payload:course,expected_revision:input.revision});
  return result.error?reply({error:'Save not committed. Check owner access and refresh revision; browser draft is unchanged.'},409):reply({saved:true,revision:result.data});
 }catch(error){return reply({error:error instanceof RequestBodyTooLarge?'Request too large.':'Invalid course request. Review fields and identifiers.'},error instanceof RequestBodyTooLarge?413:400);}
}
export const GET=handle;
export const POST=handle;
