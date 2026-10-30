# Course next-phase contract

Ownership: Feature VENTRA-FEATURES; UI VENTRA-UI; backend VENTRA-BACKEND. Protected VENTRA-CLEAN is read-only. This child runtime cannot spawn workers (depth 1/1, no spawn capability); roles are executed serially in isolated checkouts, not claimed as independent agents.

Generation: POST /api/courses/generate, same-origin JSON {brief}; authenticated bearer token validated through Supabase Auth; no browser provider keys. Returns {course: EducationCourseDraftInput}, error {error}; 401 auth, 400 validation, 403 origin, 503 configuration, 502 provider. Server OPENAI_API_KEY and OPENAI_MODEL required. Fixed OpenAI endpoint; bounded request, 30s timeout, validated structured JSON. Output replaces editor only after confirmation, never auto-saves.

Persistence: course records private to authenticated workspace members; owner writes only, optimistic revision. Existing /api/workspace cookie is path-scoped and must not be incorrectly assumed available to /api/courses. Bearer auth contract explicit.

UI: retain /tools/course-creator manual sandbox and accessible labels; shared input shape title/summary/lessons. Production shell max-width 1120px, 24px desktop/16px mobile padding, 44px control minimum; responsive single column; no motion required, respect reduced motion. Existing page remains compatible.

Verification: fixtures are not live provider/Auth/DB evidence. No deployments or purchases.
