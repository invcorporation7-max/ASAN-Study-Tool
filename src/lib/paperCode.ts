/**
 * Generates a unique uppercase alphanumeric Paper Code per ASAN Exam Master blueprint:
 * - Subject: 1 uppercase char
 * - Exam Date: 1-char Day (base36 1..V) + 1-char Month (1..9, A..C) + 2-int Year (YY)
 * - Full Marks: 2-char uppercase alphanumeric (01-99 decimal, 100+ base36)
 * - Chapters in syllabus: 2-char hexcode (00-FF)
 * - Disambiguator: 1 random uppercase alphanumeric char
 */
export function generateUniqueExamPaperCode(params: {
  subject: string;
  examDate: string;
  totalMarks: number;
  syllabusCount: number;
  existingCodes?: Iterable<string>;
}): string {
  const existing = new Set(
    Array.from(params.existingCodes || []).map((c) => c.trim().toUpperCase())
  );

  // 1. Subject (1 char)
  const subjMatch = (params.subject || 'X').toUpperCase().match(/[A-Z0-9]/);
  const subjChar = subjMatch ? subjMatch[0] : 'X';

  // 2. Date: 1-char day + 1-char month + 2-int year
  const parsed = params.examDate ? new Date(`${params.examDate}T00:00:00`) : new Date();
  const validDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const day = validDate.getDate(); // 1..31 -> base36 single char (1..V)
  const month = validDate.getMonth() + 1; // 1..12 -> hex single char (1..C)
  const year2 = String(validDate.getFullYear()).slice(-2).padStart(2, '0');
  const dayChar = day.toString(36).toUpperCase();
  const monthChar = month.toString(16).toUpperCase();

  // 3. Full marks (2 char uppercase alphanumeric)
  const clampedMarks = Math.max(1, Math.min(1295, Math.round(params.totalMarks || 100)));
  const marksCode =
    clampedMarks <= 99
      ? String(clampedMarks).padStart(2, '0')
      : clampedMarks.toString(36).toUpperCase().padStart(2, '0');

  // 4. Number of chapters in syllabus (2-char hexcode)
  const clampedChapters = Math.max(0, Math.min(255, Math.round(params.syllabusCount || 0)));
  const chapHex = clampedChapters.toString(16).toUpperCase().padStart(2, '0');

  const prefix = `${subjChar}${dayChar}${monthChar}${year2}${marksCode}${chapHex}`;
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  for (let attempt = 0; attempt < 64; attempt++) {
    const rnd = chars[Math.floor(Math.random() * chars.length)];
    const candidate = `${prefix}${rnd}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }

  return `${prefix}${chars[Date.now() % chars.length]}`;
}
