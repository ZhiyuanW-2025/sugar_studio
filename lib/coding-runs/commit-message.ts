type CodingCommitSummaryInput = {
  implementationSummary: string;
  changedFiles: string[];
};

const genericCompletionLine = /^(?:已完成(?:修改|调整|实现|处理)?[。.!！]?|修改完成[。.!！]?|完成[。.!！]?|变更文件[：:]?|修改文件[：:]?|实现摘要[：:]?|验证[：:]?|测试[：:]?)$/i;
const commandOrPathLine = /^(?:npm|pnpm|yarn|npx|bun|pytest|git)\s|^(?:[\w@.-]+\/)+[\w@.()[\]{}+-]+$/i;

function normalizeSummaryLine(line: string) {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)、]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/^(?:改动|修改内容|完成内容|实现|结果|摘要)[：:]\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/[。；;.!！]+$/, "")
    .trim();
}

function truncateSubject(value: string, maximumLength: number) {
  if (value.length <= maximumLength) return value;
  const shortened = value.slice(0, maximumLength + 1);
  const boundary = Math.max(
    shortened.lastIndexOf("，"),
    shortened.lastIndexOf(","),
    shortened.lastIndexOf("；"),
    shortened.lastIndexOf(" "),
  );
  return `${shortened.slice(0, boundary >= 24 ? boundary : maximumLength).trim()}…`;
}

/** Build a semantic Git subject from what Codex actually completed, never the user's raw task title. */
export function buildCodingCommitMessage(input: CodingCommitSummaryInput) {
  const candidates = input.implementationSummary
    .split("\n")
    .map(normalizeSummaryLine)
    .filter((line) => line.length >= 4)
    .filter((line) => !genericCompletionLine.test(line))
    .filter((line) => !commandOrPathLine.test(line));

  const fallback = input.changedFiles.length === 1
    ? `更新 ${input.changedFiles[0]}`
    : `更新 ${input.changedFiles.length} 个代码文件`;
  const subject = truncateSubject(candidates[0] || fallback, 176);
  return `Sugar Agent: ${subject}`;
}
