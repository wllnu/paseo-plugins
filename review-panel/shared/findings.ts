import {
  SEVERITIES,
  type Finding,
  type FindingLocation,
  type FindingState,
  type ReviewScope,
  type ReviewState,
  type Severity,
  type SeverityCounts,
} from "./contracts";

export const SEVERITY_META: Record<Severity, { label: string; heading: string }> = {
  blocking: { label: "blocking", heading: "Blocking" },
  "should-fix": { label: "should fix", heading: "Should fix" },
  nit: { label: "nit", heading: "Nitpicks" },
};

export type FindingStatus = "open" | "sent" | "fixed" | "wont-fix" | "dismissed";

/** The agent's resolution wins over the user's dismissal, which wins over "sent". */
export function findingStatus(finding: Finding, state: FindingState | undefined): FindingStatus {
  if (finding.resolution?.status === "fixed") return "fixed";
  if (finding.resolution?.status === "wont-fix") return "wont-fix";
  if (state?.dismissed) return "dismissed";
  if (state?.sentAt) return "sent";
  return "open";
}

/** Closed findings are dimmed and skipped by the "select all" shortcuts. */
export function isClosed(status: FindingStatus): boolean {
  return status === "fixed" || status === "wont-fix" || status === "dismissed";
}

export function statusMap(findings: readonly Finding[], state: ReviewState | undefined): Map<string, FindingStatus> {
  return new Map(findings.map((finding) => [finding.id, findingStatus(finding, state?.findings[finding.id])]));
}

function idNumber(id: string): number {
  const match = /(\d+)$/.exec(id);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

/** Blocking first, then should-fix, then nit; within a severity by the number in the id (B2 before B10). */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) =>
        SEVERITIES.indexOf(a.finding.severity) - SEVERITIES.indexOf(b.finding.severity) ||
        idNumber(a.finding.id) - idNumber(b.finding.id) ||
        a.index - b.index,
    )
    .map(({ finding }) => finding);
}

export function countSeverities(findings: readonly Finding[]): SeverityCounts {
  const counts: SeverityCounts = { blocking: 0, "should-fix": 0, nit: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/** "2 blocking · 1 should fix · 4 nits", skipping zeros. */
export function describeCounts(counts: SeverityCounts): string {
  const parts: string[] = [];
  if (counts.blocking > 0) parts.push(`${counts.blocking} blocking`);
  if (counts["should-fix"] > 0) parts.push(`${counts["should-fix"]} should fix`);
  if (counts.nit > 0) parts.push(`${counts.nit} nit${counts.nit === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" · ") : "no findings";
}

export function endLineOf(location: Pick<FindingLocation, "line" | "endLine">): number {
  return location.endLine && location.endLine > location.line ? location.endLine : location.line;
}

/** "42" or "42-48". */
export function formatLines(location: Pick<FindingLocation, "line" | "endLine">): string {
  const end = endLineOf(location);
  return end > location.line ? `${location.line}-${end}` : String(location.line);
}

/** "src/upload/retry.ts:42-48", with "(removed lines)" for locations on the base side. */
export function formatLocation(location: FindingLocation): string {
  const removed = location.side === "old" ? " (removed lines)" : "";
  return `${location.file}:${formatLines(location)}${removed}`;
}

/** Last two path segments, for chips in a narrow panel. */
export function shortPath(file: string): string {
  return file.split("/").filter(Boolean).slice(-2).join("/");
}

export function shortRef(ref: string): string {
  return /^[0-9a-f]{12,40}$/i.test(ref) ? ref.slice(0, 8) : ref;
}

/** "3f2c1a9e (origin/main) → working tree". */
export function describeScope(scope: ReviewScope): string {
  const base = `${shortRef(scope.base)}${scope.baseLabel ? ` (${scope.baseLabel})` : ""}`;
  const head = scope.head
    ? `${shortRef(scope.head)}${scope.headLabel ? ` (${scope.headLabel})` : ""}`
    : `working tree${scope.headLabel ? ` (${scope.headLabel})` : ""}`;
  return `${base} → ${head}`;
}
