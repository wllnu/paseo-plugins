import { PLAN_DIR } from "./contracts";
import type { HtmlElement, HtmlNode, PlanDocument } from "./html";

/**
 * A roadmap breaks a plan into small work packages that an orchestrator agent runs one by one: a scout agent
 * writes a focused brief per package, a builder agent implements it. It is a markdown file next to its plan
 * (`<slug>.html` → `<slug>.roadmap.md`), with the briefs in a folder beside it. The panel converts it into the
 * same element tree as an HTML plan, so it renders, counts progress, and takes comments like a plan.
 */
const ROADMAP_SUFFIX = ".roadmap.md";

export function isRoadmapName(name: string): boolean {
  return name.endsWith(ROADMAP_SUFFIX);
}

export function roadmapNameFor(planName: string): string {
  return planName.replace(/\.html$/, ROADMAP_SUFFIX);
}

export function planNameForRoadmap(roadmapName: string): string {
  return `${roadmapName.slice(0, -ROADMAP_SUFFIX.length)}.html`;
}

/** Folder holding one brief per work package, `wp-N.md`. */
export function briefsDirFor(roadmapName: string): string {
  return `${PLAN_DIR}/${roadmapName.replace(/\.md$/, "")}/`;
}

/** Labels on the orchestrator agent, so the panel can find the run of a roadmap. */
export const RUN_ROLE_LABEL = "plan-panel";
export const RUN_ROADMAP_LABEL = "plan-roadmap";
export function runLabels(roadmapName: string): Record<string, string> {
  return { [RUN_ROLE_LABEL]: "orchestrator", [RUN_ROADMAP_LABEL]: roadmapName };
}

// ---------------------------------------------------------------------------------------------------------
// Markdown → plan element tree

export type PackageStatus = "open" | "scouting" | "building" | "review" | "done" | "blocked" | "skipped";

const STATUS_CLASS: Record<PackageStatus, string | null> = {
  open: null,
  scouting: "doing",
  building: "doing",
  // Built and verified; the orchestrator pauses until the user says continue.
  review: "ask",
  done: "done",
  blocked: "risk",
  skipped: "no",
};

const STATUS_TAG: Partial<Record<PackageStatus, string>> = {
  scouting: "tag",
  building: "tag",
  review: "tag ask",
  blocked: "tag risk",
};

interface RoadmapPackage {
  id: string;
  title: string;
  status: PackageStatus;
  fields: { key: string; value: string }[];
  notes: string[];
}

type RoadmapBlock =
  | { kind: "package"; pkg: RoadmapPackage }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "p"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "pre"; text: string };

interface RoadmapSection {
  heading: string;
  id: string;
  blocks: RoadmapBlock[];
}

const PACKAGE_HEADING = /^###\s+(wp-[A-Za-z0-9-]+)\b\s*[:.–—-]?\s*(.*)$/i;
const FIELD = /^([A-Za-z][\w ./()-]{0,23}?)\s*:(?:\s+|$)(.*)$/;

function toStatus(value: string): PackageStatus {
  const word = value.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  return word in STATUS_CLASS ? (word as PackageStatus) : "open";
}

function slug(text: string, fallback: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || fallback
  );
}

/** `Key: value`, also written `**Key**: value` or `**Key:** value`. */
function fieldOf(content: string): { key: string; value: string } | null {
  const plain = content.replace(/^\*\*(.+?)\*\*/, "$1");
  const match = FIELD.exec(plain);
  return match ? { key: match[1]!.trim(), value: match[2]!.trim() } : null;
}

function el(tag: string, attrs: Record<string, string> = {}, children: HtmlNode[] = []): HtmlElement {
  return { type: "element", tag, attrs, children };
}

function text(value: string): HtmlNode {
  return { type: "text", text: value };
}

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s][^*]*)\*/g;

/** Inline markdown: code, bold, links, emphasis. Everything else stays text. */
function inline(source: string): HtmlNode[] {
  const out: HtmlNode[] = [];
  let last = 0;
  for (const match of source.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text(source.slice(last, index)));
    if (match[1] !== undefined) out.push(el("code", {}, [text(match[1])]));
    else if (match[2] !== undefined) out.push(el("strong", {}, inline(match[2])));
    else if (match[3] !== undefined) out.push(el("a", { href: match[4]! }, inline(match[3])));
    else if (match[5] !== undefined) out.push(el("em", {}, inline(match[5])));
    last = index + match[0].length;
  }
  if (last < source.length) out.push(text(source.slice(last)));
  return out;
}

interface ParsedRoadmap {
  title: string;
  source: string | null;
  summary: string[];
  sections: RoadmapSection[];
}

/** Forgiving line parser for the roadmap format in `skills/paseo-plan/references/roadmap.md`. */
function parseRoadmap(markdown: string): ParsedRoadmap {
  const parsed: ParsedRoadmap = { title: "", source: null, summary: [], sections: [] };
  let section: RoadmapSection | null = null;
  let pkg: RoadmapPackage | null = null;
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let fence: string[] | null = null;

  const push = (block: RoadmapBlock) => {
    if (!section) {
      section = { heading: "Packages", id: "packages", blocks: [] };
      parsed.sections.push(section);
    }
    section.blocks.push(block);
  };
  const flush = () => {
    if (paragraph.length > 0) {
      const joined = paragraph.join(" ");
      if (section) push({ kind: "p", text: joined });
      else parsed.summary.push(joined);
      paragraph = [];
    }
    if (list) {
      push({ kind: "list", ...list });
      list = null;
    }
  };

  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (fence) {
      if (line.trim().startsWith("```")) {
        push({ kind: "pre", text: fence.join("\n") });
        fence = null;
      } else fence.push(raw);
      continue;
    }
    if (line.trim().startsWith("```")) {
      flush();
      pkg = null;
      fence = [];
      continue;
    }
    let match: RegExpExecArray | null;
    if ((match = /^#\s+(.+)$/.exec(line)) && !parsed.title) {
      flush();
      parsed.title = match[1]!.trim();
      continue;
    }
    if ((match = /^##\s+(.+)$/.exec(line))) {
      flush();
      pkg = null;
      const heading = match[1]!.trim();
      section = { heading, id: slug(heading, `section-${parsed.sections.length + 1}`), blocks: [] };
      parsed.sections.push(section);
      continue;
    }
    if ((match = PACKAGE_HEADING.exec(line))) {
      flush();
      pkg = { id: match[1]!.toLowerCase(), title: match[2]!.trim(), status: "open", fields: [], notes: [] };
      push({ kind: "package", pkg });
      continue;
    }
    if ((match = /^###+\s+(.+)$/.exec(line))) {
      flush();
      pkg = null;
      push({ kind: "h3", text: match[1]!.trim() });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const bullet = /^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/.exec(line);
    const content = bullet ? bullet[2]!.trim() : line.trim();
    const field = fieldOf(content);
    if (pkg) {
      if (field && field.key.toLowerCase() === "status") pkg.status = toStatus(field.value);
      else if (field) pkg.fields.push(field);
      else pkg.notes.push(content);
      continue;
    }
    if (!section && field && field.key.toLowerCase() === "plan") {
      parsed.source = field.value.replace(/`/g, "").split("/").pop() ?? null;
      continue;
    }
    if (bullet && section) {
      if (paragraph.length > 0) flush();
      const ordered = bullet[1] !== undefined;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push(content);
      continue;
    }
    if (list && /^\s/.test(raw)) {
      list.items[list.items.length - 1] += ` ${content}`;
      continue;
    }
    if (list) flush();
    paragraph.push(content);
  }
  flush();
  if (fence) push({ kind: "pre", text: (fence as string[]).join("\n") });
  return parsed;
}

function packageItem(pkg: RoadmapPackage): HtmlElement {
  const goal = pkg.fields.find((field) => field.key.toLowerCase() === "goal");
  const lead: HtmlNode[] = [el("strong", {}, inline(pkg.title || pkg.id))];
  if (goal) lead.push(text(" "), ...inline(goal.value));
  const tag = STATUS_TAG[pkg.status];
  if (tag) lead.push(text(" "), el("span", { class: tag }, [text(pkg.status)]));
  const rows = pkg.fields
    .filter((field) => field !== goal)
    .flatMap((field) => [el("dt", {}, inline(field.key)), el("dd", {}, inline(field.value))]);
  const detail: HtmlNode[] = [];
  if (rows.length > 0) detail.push(el("dl", {}, rows));
  for (const note of pkg.notes) detail.push(el("p", {}, inline(note)));
  const statusClass = STATUS_CLASS[pkg.status];
  return el("li", statusClass ? { id: pkg.id, class: statusClass } : { id: pkg.id }, [
    ...lead,
    ...(detail.length > 0 ? [el("details", {}, detail)] : []),
  ]);
}

function sectionBlocks(section: RoadmapSection): HtmlNode[] {
  const out: HtmlNode[] = [];
  let steps: HtmlElement | null = null;
  for (const block of section.blocks) {
    if (block.kind === "package") {
      if (!steps) {
        steps = el("ol", { class: "steps" });
        out.push(steps);
      }
      steps.children.push(packageItem(block.pkg));
      continue;
    }
    steps = null;
    if (block.kind === "p") out.push(el("p", {}, inline(block.text)));
    else if (block.kind === "h3") out.push(el("h3", {}, inline(block.text)));
    else if (block.kind === "pre") out.push(el("pre", {}, [el("code", {}, [text(block.text)])]));
    else {
      const fields = block.items.map(fieldOf);
      if (fields.every((field) => field !== null)) {
        // A list of `Key: value` lines, such as the Run section, reads best as a key/value grid.
        out.push(el("dl", {}, fields.flatMap((field) => [el("dt", {}, inline(field!.key)), el("dd", {}, inline(field!.value))])));
      } else {
        const itemClass: Record<string, string> = section.id === "risks" ? { class: "warn" } : {};
        out.push(el(block.ordered ? "ol" : "ul", {}, block.items.map((item) => el("li", itemClass, inline(item)))));
      }
    }
  }
  return out;
}

/** Read a roadmap file into the document shape the plan view renders. */
export function readRoadmapDocument(markdown: string): PlanDocument {
  const roadmap = parseRoadmap(markdown);
  const title = roadmap.title || "Roadmap";
  const header = el("header", {}, [
    el("h1", {}, inline(title)),
    ...roadmap.summary.map((paragraph, index) => el("p", index === 0 ? { id: "summary" } : {}, inline(paragraph))),
  ]);
  const sections = roadmap.sections.map((section) =>
    el("section", { id: section.id }, [el("h2", {}, inline(section.heading)), ...sectionBlocks(section)]),
  );
  return {
    title,
    revision: null,
    status: null,
    kind: "roadmap",
    source: roadmap.source,
    body: el("body", {}, [header, ...sections]),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Progress

export interface RoadmapProgress {
  total: number;
  done: number;
  doing: number;
  /** Status `review`: finished and waiting for the user before the run goes on. */
  review: number;
  waiting: { id: string; title: string }[];
  /** Status `blocked`: the orchestrator could not finish it. */
  blocked: number;
  /** Status `skipped`: dropped from the run. */
  skipped: number;
}

function classes(element: HtmlElement): Set<string> {
  return new Set((element.attrs.class ?? "").split(/\s+/).filter(Boolean));
}

function plainText(node: HtmlNode): string {
  return node.type === "text" ? node.text : node.children.map(plainText).join("");
}

/** Work packages are the items of every `ol.steps`; their classes carry the run status. */
export function readProgress(body: HtmlElement): RoadmapProgress {
  const progress: RoadmapProgress = { total: 0, done: 0, doing: 0, review: 0, waiting: [], blocked: 0, skipped: 0 };
  const visit = (node: HtmlNode) => {
    if (node.type !== "element") return;
    if (node.tag === "ol" && classes(node).has("steps")) {
      for (const child of node.children) {
        if (child.type !== "element" || child.tag !== "li") continue;
        const status = classes(child);
        progress.total += 1;
        if (status.has("done")) progress.done += 1;
        else if (status.has("doing")) progress.doing += 1;
        else if (status.has("ask")) {
          progress.review += 1;
          const title = child.children.find((node) => node.type === "element" && node.tag === "strong");
          progress.waiting.push({ id: child.attrs.id ?? "", title: title ? plainText(title) : "" });
        }
        else if (status.has("risk")) progress.blocked += 1;
        else if (status.has("no")) progress.skipped += 1;
      }
      return;
    }
    node.children.forEach(visit);
  };
  visit(body);
  return progress;
}

/** Packages still to run: neither done nor skipped. Blocked packages count, a new run retries them. */
export function openPackages(progress: RoadmapProgress): number {
  return progress.total - progress.done - progress.skipped;
}

// ---------------------------------------------------------------------------------------------------------
// Prompts

export interface BreakdownPromptInput {
  planName: string;
  planTitle: string;
  revision: string | null;
}

/** Sent to the agent that wrote the plan. Pressing Break down approves the plan. */
export function buildBreakdownPrompt({ planName, planTitle, revision }: BreakdownPromptInput): string {
  const roadmapName = roadmapNameFor(planName);
  const revisionLabel = revision ? ` (revision ${revision})` : "";
  return [
    `[plan-panel breakdown] I approve the plan "${planTitle}"${revisionLabel}. Break it into a roadmap of work packages.`,
    `Plan file: ${PLAN_DIR}/${planName}`,
    `Roadmap file: ${PLAN_DIR}/${roadmapName}`,
    "",
    "Set the plan's plan-status to approved. Then write the roadmap as markdown. An orchestrator agent will run it: for each work package it launches a scout agent that explores the code and writes a focused brief, then a builder agent that implements that brief. Size each package so one builder can finish it in one session, verify it on its own, and leave the build green. Keep packages coarse: goal, plan steps covered, where to start, done when, and boundaries. The scout works out the specifics.",
    "",
    "Follow step 7 of the paseo-plan skill and its references/roadmap.md for the format. If the roadmap file exists already, revise it in place and keep the Status lines. Then reply with a short summary and stop; do not start implementing.",
  ].join("\n");
}

export interface RunPromptInput {
  roadmapName: string;
  roadmapTitle: string;
  /** Plan file the roadmap breaks down, from its `Plan:` line or the naming convention. */
  planName: string;
  progress: RoadmapProgress;
}

/** Initial prompt of the orchestrator agent started from the panel. */
export function buildRunPrompt({ roadmapName, roadmapTitle, planName, progress }: RunPromptInput): string {
  const resume =
    progress.done > 0 || progress.doing > 0 || progress.blocked > 0
      ? `${progress.done} of ${progress.total} packages are done already. Resume with the first open package; retry blocked ones only if their cause is resolved.`
      : `Start with the first of ${progress.total} packages.`;
  return [
    `[plan-panel run] Run the roadmap "${roadmapTitle}".`,
    `Roadmap file: ${PLAN_DIR}/${roadmapName}`,
    `Plan file: ${PLAN_DIR}/${planName}`,
    `Briefs folder: ${briefsDirFor(roadmapName)}`,
    "",
    "You are the orchestrator; follow the paseo-orchestrate skill. For each work package in order, launch a scout agent that explores the code and writes a focused brief, then a builder agent that implements the brief. Verify each package and keep its Status line in the roadmap current so the plan panel shows progress.",
    "After each package, set it to review, report what changed, and stop. I review it myself or start a review, then tell you to continue. Never start the next package without my go-ahead.",
    resume,
    "",
    "Do not write code yourself and do not commit; leave all changes in the working tree. When every package is done or blocked, reply with a summary and stop.",
  ].join("\n");
}

/** Sent to the orchestrator when the user approves the package it paused on. */
export function buildContinuePrompt(waiting: readonly { id: string; title: string }[]): string {
  const names = waiting.map((pkg) => (pkg.title ? `${pkg.id} "${pkg.title}"` : pkg.id)).join(", ");
  return `[plan-panel continue] I reviewed ${names || "the package you paused on"}. Mark it done and continue with the next package, then pause again for my review.`;
}
