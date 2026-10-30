import { courseDraftFromInput, editEducationCourseDraft, restoreEducationCourseDraft, type EducationCourseDraftInput } from './local-education-course.ts';

/** Explicit adapter boundary: no generated content is fabricated when a provider is absent. */
export type CourseGenerationAdapter = { generate: (brief: string, signal?: AbortSignal) => Promise<unknown> };
export async function generateCourse(brief: string, adapter?: CourseGenerationAdapter, signal?: AbortSignal): Promise<EducationCourseDraftInput> {
  if (!brief.trim() || brief.length > 4000) throw new Error('Describe your course in 1–4000 characters.');
  if (!adapter) throw new Error('AI generation is not configured. Connect a trusted generation adapter; manual course creation works without credentials.');
  const output = await adapter.generate(brief.trim(), signal);
  if (!output || typeof output !== 'object') throw new Error('Provider returned an invalid course. Your draft is unchanged.');
  const checked = courseDraftFromInput(output as EducationCourseDraftInput, {id: 'provider-validation', profileId: 'provider-validation'});
  return editEducationCourseDraft(checked);
}
export function importCourse(raw: string, profileId: string): EducationCourseDraftInput {
  const course = restoreEducationCourseDraft(raw, profileId);
  if (!course) throw new Error('Select a course export to import.');
  return editEducationCourseDraft(course);
}
