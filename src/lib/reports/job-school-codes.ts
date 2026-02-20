export function normalizeSchoolCode(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function uniqueNormalizedSchoolCodes(values: unknown[]): string[] {
  const set = new Set<string>();
  for (const v of values) {
    const normalized = normalizeSchoolCode(v);
    if (!normalized) continue;
    set.add(normalized);
  }
  return [...set];
}

/**
 * Prefer explicit job school codes from tasks; if they are missing/null (legacy jobs),
 * fall back to whatever school codes appear in the student dataset for the job date.
 */
export function resolveJobSchoolCodes(options: {
  taskSchoolCodes: unknown[];
  studentSchoolCodes: unknown[];
}): { codes: string[]; source: 'tasks' | 'students' } {
  const fromTasks = uniqueNormalizedSchoolCodes(options.taskSchoolCodes);
  if (fromTasks.length > 0) {
    return { codes: fromTasks, source: 'tasks' };
  }

  const fromStudents = uniqueNormalizedSchoolCodes(options.studentSchoolCodes);
  return { codes: fromStudents, source: 'students' };
}
