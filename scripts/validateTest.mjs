export const PARTIAL_MODES = ["perOption", "proportional", "none"];

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const isIdx = (x, len) => Number.isInteger(x) && x >= 0 && x < len;

export function validateTest(test) {
  const errors = [];
  const warnings = [];

  if (!test || typeof test !== "object" || Array.isArray(test)) {
    return { errors: ["Test must be a JSON object."], warnings };
  }
  if (typeof test.title !== "string" || !test.title.trim())
    errors.push("Missing title.");
  if (!isNum(test.duration) || test.duration <= 0)
    errors.push("duration must be a positive number (in seconds).");
  if (!Array.isArray(test.subjects) || test.subjects.length === 0) {
    errors.push("subjects must be a non-empty array.");
    return { errors, warnings };
  }

  test.subjects.forEach((subject, i) => {
    const sName = subject?.name || `Subject ${i + 1}`;
    if (!Array.isArray(subject?.sections) || subject.sections.length === 0) {
      errors.push(`${sName}: sections must be a non-empty array.`);
      return;
    }

    subject.sections.forEach((section, j) => {
      const where = `${sName} / ${section?.name || `Section ${j + 1}`}`;
      if (!isNum(section?.posM))
        errors.push(`${where}: posM must be a number.`);
      if (!isNum(section?.negM))
        errors.push(`${where}: negM must be a number.`);
      if (section?.partial && !PARTIAL_MODES.includes(section.partial))
        errors.push(
          `${where}: partial must be one of ${PARTIAL_MODES.join(", ")}.`,
        );
      if (
        !Array.isArray(section?.questions) ||
        section.questions.length === 0
      ) {
        errors.push(`${where}: questions must be a non-empty array.`);
        return;
      }

      section.questions.forEach((q, k) => {
        const at = `${where} / Q${k + 1}`;
        if (typeof q?.text !== "string")
          errors.push(`${at}: text must be a string.`);
        if (q?.partial && !PARTIAL_MODES.includes(q.partial))
          errors.push(
            `${at}: partial must be one of ${PARTIAL_MODES.join(", ")}.`,
          );
        for (const key of ["image", "simage", "solution"]) {
          if (q?.[key] != null && typeof q[key] !== "string")
            errors.push(`${at}: ${key} must be a string.`);
        }

        if (q?.type === "SMCQ" || q?.type === "MMCQ") {
          if (!Array.isArray(q.options) || q.options.length < 2) {
            errors.push(`${at}: needs at least 2 options.`);
            return;
          }
          if (q.options.some((o) => typeof o !== "string"))
            errors.push(`${at}: options must be strings.`);

          const len = q.options.length;
          if (q.type === "SMCQ") {
            if (!Number.isInteger(q.answer))
              errors.push(
                `${at}: SMCQ answer must be an option index (0 = first).`,
              );
            else if (!isIdx(q.answer, len))
              warnings.push(
                `${at}: answer ${q.answer} is out of range, options are 0-${len - 1}.`,
              );
          } else {
            if (!Array.isArray(q.answer) || q.answer.length === 0)
              errors.push(
                `${at}: MMCQ answer must be a non-empty array of option indices.`,
              );
            else if (!q.answer.every((a) => isIdx(a, len)))
              warnings.push(
                `${at}: answer has indices out of range, options are 0-${len - 1}.`,
              );
          }
        } else if (q?.type === "NUM") {
          if (!isNum(q.answer))
            errors.push(`${at}: NUM answer must be a number.`);
          if (q.tolerance != null && !(isNum(q.tolerance) && q.tolerance >= 0))
            errors.push(`${at}: tolerance must be a number >= 0.`);
        } else {
          errors.push(`${at}: type must be SMCQ, MMCQ or NUM.`);
        }
      });
    });
  });

  return { errors, warnings };
}
