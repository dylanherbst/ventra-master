import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { sameOrigin } from '../lib/request-security.ts';
import { blankProfile } from '../lib/onboarding.ts';
import { checkedImport, checkedOffer, checkedProfile, uuid } from '../lib/workspace-validation.ts';
const profile = { ...blankProfile(), name: 'Learning studio', audience: 'Designers', goal: 'Teach', expertise: 'Design', pathways: ['education', 'business'] as ('education'|'business')[], industry: 'Training' };
const offer = { version: 1 as const, id: 'local-offer-one', profileId: 'local-business', name: 'Design class', audience: 'Designers', outcome: 'Learn design', delivery: 'Online lessons', amountMinor: 9007199254740991, currency: 'AUD' as const, kind: 'education' as const };
test('mutation origin checks accept exact browser origin and reject foreign, missing or forwarded origins', () => {
  assert.equal(sameOrigin('http://127.0.0.1:3100','127.0.0.1:3100','http:'), true);
  assert.equal(sameOrigin('http://localhost:3100','127.0.0.1:3100','http:'), false);
  assert.equal(sameOrigin(null,'localhost:3100','http:'), false);
  assert.equal(sameOrigin('https://evil.invalid','app.example','https:'), false);
  assert.equal(sameOrigin('https://evil.invalid','evil.invalid','https:','https://app.example'), false);
});
test('server validation preserves exact prices and legacy business pathway; rejects invalid imports', () => {
  assert.deepEqual(checkedProfile(profile), profile);
  assert.equal(checkedOffer(offer, profile).amountMinor, 9007199254740991);
  assert.throws(() => checkedOffer({ ...offer, amountMinor: 1.1 }, profile));
  assert.throws(() => checkedOffer({ ...offer, profileId: 'another' }, profile));
  assert.throws(() => checkedImport({ profile, offers: [offer, offer] }));
  assert.throws(() => checkedImport({ profile, offers: [{ ...offer, currency: 'XXX' }] }));
  assert.throws(() => checkedProfile({ ...profile, website: 'javascript:alert(1)' }));
  assert.throws(() => checkedProfile({ ...profile, name: 'x'.repeat(501) }));
  assert.throws(() => uuid('workspace-a'));
});
test('fresh PostgreSQL migration, real DB roles and tenant isolation (fixture Auth claims, NOT Supabase integration)', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key);
      create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema public,auth to authenticated,anon;
      grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
    await db.exec(await readFile('../../supabase/migrations/202610160001_s01.sql', 'utf8'));
    await db.exec(await readFile('../../supabase/migrations/202610300001_courses.sql', 'utf8'));
    const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
    const sa = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sb = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await db.query('insert into auth.users values ($1),($2)', [a,b]);
    await db.query('insert into auth.sessions(id,user_id) values ($1,$2),($3,$4)', [sa,a,sb,b]);
    async function actor(id: string, session: string) {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub:id,session_id:session})]);
      await db.exec('set role authenticated');
    }
    async function scalar(sql: string, params: unknown[] = []) { return (await db.query<Record<string, unknown>>(sql,params)).rows[0]?.result; }
    await actor(a,sa);
    const wa = await scalar("select public.create_workspace('Alpha') as result") as string;
    const courseId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const course={title:'SQL fixture',summary:'Private',lessons:[{id:'one',title:'Intro',content:'Learn',durationMinutes:'10'}]};
    assert.equal(await scalar('select public.save_course($1,$2,$3,0) as result',[wa,courseId,course]),1);
    assert.equal(await scalar('select public.save_course($1,$2,$3,1) as result',[wa,courseId,course]),2);
    await assert.rejects(db.query('select public.save_course($1,$2,$3,1)',[wa,courseId,course]),/Revision conflict/);
    await assert.rejects(db.query('update public.course_drafts set revision=99'),/permission denied/);
    await db.query('select public.save_profile($1,$2,0)', [wa,profile]);
    const oid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await db.query('select public.save_offer($1,$2,$3,0)', [wa,oid,offer]);
    assert.equal(await scalar('select count(*)::int as result from public.offers'),1);
    await assert.rejects(db.query("update public.memberships set role='owner'"), /permission denied/);
    await assert.rejects(db.query('select public.save_profile($1,$2,0)',[wa,profile]), /duplicate key/);
    await assert.rejects(db.query('select public.save_offer($1,$2,$3,0)',[wa,'dddddddd-dddd-4ddd-8ddd-dddddddddddd',{...offer,amountMinor:null}]), /constraint/);
    await assert.rejects(db.query('select public.save_profile($1,$2,1)',[wa,{...profile,pathways:['business'],primary:'business'}]), /active pathways/);
    await actor(b,sb);
    assert.equal(await scalar('select count(*)::int as result from public.course_drafts'),0);
    await assert.rejects(db.query('select public.save_course($1,$2,$3,2)',[wa,courseId,course]),/Owner access/);
    const wb = await scalar("select public.create_workspace('Beta') as result") as string;
    assert.equal(await scalar('select count(*)::int as result from public.offers'),0);
    assert.equal(await scalar('select count(*)::int as result from public.business_profiles'),0);
    await assert.rejects(db.query('select public.save_offer($1,$2,$3,1)',[wa,oid,offer]), /Owner access/);
    await assert.rejects(db.query('select public.save_offer($1,$2,$3,1)',[wb,oid,offer]), /Activate/);
    const payload = {profile,offers:[offer]};
    assert.equal(await scalar('select public.import_drafts($1,$2) as result',[wb,payload]),'imported');
    assert.equal(await scalar('select public.import_drafts($1,$2) as result',[wb,payload]),'already_imported');
    assert.equal(await scalar('select count(*)::int as result from public.offers'),1);
    await assert.rejects(db.query('select public.import_drafts($1,$2)',[wb,{...payload,offers:[]}]), /different import/);
    await assert.rejects(db.query('select public.save_offer($1,$2,$3,1)',[wb,oid,offer]), /Offer changed/);
    // Failed import is atomic: profile and offers are rolled back.
    const wc = await scalar("select public.create_workspace('Rollback') as result") as string;
    await assert.rejects(db.query('select public.import_drafts($1,$2)',[wc,{profile,offers:[offer,{...offer,id:'bad-second',name:''}]}]), /constraint/);
    assert.equal(await scalar('select count(*)::int as result from public.business_profiles where workspace_id=$1',[wc]),0);
    // Only test-fixture superuser assigns staff. No app API may assign any role.
    await db.exec('reset role');
    await db.query("insert into public.memberships values ($1,$2,'staff',true)",[wa,b]);
    await actor(b,sb);
    assert.equal(await scalar('select count(*)::int as result from public.offers where workspace_id=$1',[wa]),1);
    await assert.rejects(db.query('select public.save_offer($1,$2,$3,1)',[wa,oid,offer]), /Owner access/);
    await db.exec('reset role');
    await db.query('update public.memberships set active=false where workspace_id=$1 and user_id=$2',[wa,b]);
    await actor(b,sb);
    assert.equal(await scalar('select count(*)::int as result from public.offers where workspace_id=$1',[wa]),0);
    // A still-signed JWT cannot use revoked session rows.
    await db.exec('reset role'); await db.query('delete from auth.sessions where id=$1',[sb]); await actor(b,sb);
    assert.equal(await scalar('select public.session_active() as result'),false);
    assert.equal(await scalar('select count(*)::int as result from public.workspaces'),0);
    await assert.rejects(db.query("select public.create_workspace('Revoked')"), /Sign in/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from public.offers'), /permission denied/);
    await assert.rejects(db.query("select public.create_workspace('Anonymous')"), /permission denied/);
  } finally { await db.close(); }
});
