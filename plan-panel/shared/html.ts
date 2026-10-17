/**
 * Small, forgiving HTML parser for plan documents. No DOM, no Node: it runs in the
 * app bundle on every platform. It understands the subset the plan panel renders and
 * degrades gracefully on anything else (unknown tags keep their children).
 */

export interface HtmlElement {
  type: "element";
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}

export interface HtmlText {
  type: "text";
  text: string;
}

export type HtmlNode = HtmlElement | HtmlText;

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/** Content of these elements is raw text until the matching end tag. */
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);

/** Elements dropped entirely, including their content. */
const DROPPED_TAGS = new Set(["script", "style", "svg", "iframe", "object", "embed", "noscript"]);

/** Opening one of these implicitly closes an open <p>. */
const P_CLOSERS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "div",
  "dl",
  "fieldset",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
  rarr: "→",
  larr: "←",
  uarr: "↑",
  darr: "↓",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  times: "×",
  deg: "°",
  check: "✓",
  cross: "✗",
};

export function decodeEntities(input: string): string {
  if (input.indexOf("&") === -1) return input;
  return input.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    const named = NAMED_ENTITIES[body];
    return named === undefined ? match : named;
  });
}

function isNameChar(ch: string): boolean {
  return /[A-Za-z0-9:_-]/.test(ch);
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\t" || ch === "\r" || ch === "\f";
}

/** Parse an HTML string into a root element whose children are the document nodes. */
export function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { type: "element", tag: "#root", attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  const top = (): HtmlElement => stack[stack.length - 1]!;
  const length = html.length;
  let i = 0;

  const appendText = (text: string) => {
    if (text.length === 0) return;
    const parent = top();
    const last = parent.children[parent.children.length - 1];
    if (last && last.type === "text") {
      last.text += text;
    } else {
      parent.children.push({ type: "text", text });
    }
  };

  const closeTag = (tag: string) => {
    for (let depth = stack.length - 1; depth > 0; depth -= 1) {
      if (stack[depth]!.tag === tag) {
        stack.length = depth;
        return;
      }
    }
    // Unmatched end tag: ignore it.
  };

  const popWhileTop = (tags: Set<string>) => {
    while (stack.length > 1 && tags.has(top().tag)) stack.pop();
  };

  while (i < length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      appendText(decodeEntities(html.slice(i)));
      break;
    }
    if (lt > i) {
      appendText(decodeEntities(html.slice(i, lt)));
      i = lt;
    }

    // Comment
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end === -1 ? length : end + 3;
      continue;
    }
    // Doctype or other declaration
    if (html.startsWith("<!", i) || html.startsWith("<?", i)) {
      const end = html.indexOf(">", i + 2);
      i = end === -1 ? length : end + 1;
      continue;
    }
    // End tag
    if (html.startsWith("</", i)) {
      let j = i + 2;
      let name = "";
      while (j < length && isNameChar(html[j]!)) {
        name += html[j]!;
        j += 1;
      }
      const end = html.indexOf(">", j);
      i = end === -1 ? length : end + 1;
      if (name) closeTag(name.toLowerCase());
      continue;
    }
    // Start tag
    const first = html[i + 1];
    if (first !== undefined && /[A-Za-z]/.test(first)) {
      let j = i + 1;
      let name = "";
      while (j < length && isNameChar(html[j]!)) {
        name += html[j]!;
        j += 1;
      }
      const tag = name.toLowerCase();
      const attrs: Record<string, string> = {};
      let selfClosing = false;
      while (j < length) {
        while (j < length && isSpace(html[j]!)) j += 1;
        const ch = html[j];
        if (ch === undefined) break;
        if (ch === ">") {
          j += 1;
          break;
        }
        if (ch === "/") {
          j += 1;
          if (html[j] === ">") {
            selfClosing = true;
            j += 1;
            break;
          }
          continue;
        }
        let attrName = "";
        while (j < length && !isSpace(html[j]!) && html[j] !== "=" && html[j] !== ">" && html[j] !== "/") {
          attrName += html[j]!;
          j += 1;
        }
        if (attrName.length === 0) {
          j += 1;
          continue;
        }
        while (j < length && isSpace(html[j]!)) j += 1;
        let value = "";
        if (html[j] === "=") {
          j += 1;
          while (j < length && isSpace(html[j]!)) j += 1;
          const quote = html[j];
          if (quote === '"' || quote === "'") {
            const end = html.indexOf(quote, j + 1);
            value = html.slice(j + 1, end === -1 ? length : end);
            j = end === -1 ? length : end + 1;
          } else {
            while (j < length && !isSpace(html[j]!) && html[j] !== ">") {
              value += html[j]!;
              j += 1;
            }
          }
        }
        attrs[attrName.toLowerCase()] = decodeEntities(value);
      }
      i = j;

      if (RAW_TEXT_TAGS.has(tag) && !selfClosing) {
        const closeMatch = new RegExp(`</${tag}\\s*>`, "i");
        const rest = html.slice(i);
        const match = closeMatch.exec(rest);
        const rawEnd = match ? i + match.index : length;
        const raw = html.slice(i, rawEnd);
        i = match ? rawEnd + match[0].length : length;
        if (DROPPED_TAGS.has(tag)) continue;
        const element: HtmlElement = { type: "element", tag, attrs, children: [] };
        if (raw.length > 0) element.children.push({ type: "text", text: decodeEntities(raw) });
        top().children.push(element);
        continue;
      }

      if (DROPPED_TAGS.has(tag)) {
        // Skip to the matching end tag (non-nested is good enough for plans).
        const closeMatch = new RegExp(`</${tag}\\s*>`, "i");
        const match = closeMatch.exec(html.slice(i));
        i = match ? i + match.index + match[0].length : length;
        continue;
      }

      // Implicit closes.
      if (P_CLOSERS.has(tag)) {
        if (top().tag === "p") stack.pop();
      }
      if (tag === "li") popWhileTop(new Set(["li", "p"]));
      if (tag === "dt" || tag === "dd") popWhileTop(new Set(["dt", "dd", "p"]));
      if (tag === "td" || tag === "th") popWhileTop(new Set(["td", "th", "p"]));
      if (tag === "tr") {
        popWhileTop(new Set(["td", "th", "p"]));
        if (top().tag === "tr") stack.pop();
      }
      if (tag === "thead" || tag === "tbody" || tag === "tfoot") {
        popWhileTop(new Set(["td", "th", "tr", "p"]));
        popWhileTop(new Set(["thead", "tbody", "tfoot"]));
      }
      if (tag === "option") popWhileTop(new Set(["option"]));

      const element: HtmlElement = { type: "element", tag, attrs, children: [] };
      top().children.push(element);
      if (!selfClosing && !VOID_TAGS.has(tag)) stack.push(element);
      continue;
    }

    // A lone "<" that does not start a tag: keep it as text.
    appendText("<");
    i += 1;
  }

  return root;
}

/** Depth-first search for the first element with the given tag. */
export function findElement(node: HtmlNode, tag: string): HtmlElement | null {
  if (node.type !== "element") return null;
  if (node.tag === tag) return node;
  for (const child of node.children) {
    const found = findElement(child, tag);
    if (found) return found;
  }
  return null;
}

/** All elements matching a predicate, in document order. */
export function findElements(node: HtmlNode, predicate: (element: HtmlElement) => boolean): HtmlElement[] {
  const out: HtmlElement[] = [];
  const visit = (current: HtmlNode) => {
    if (current.type !== "element") return;
    if (predicate(current)) out.push(current);
    for (const child of current.children) visit(child);
  };
  visit(node);
  return out;
}

/** Concatenated text content with whitespace collapsed. */
export function textOf(node: HtmlNode): string {
  const parts: string[] = [];
  const visit = (current: HtmlNode) => {
    if (current.type === "text") {
      parts.push(current.text);
      return;
    }
    if (current.tag === "br") parts.push(" ");
    for (const child of current.children) visit(child);
  };
  visit(node);
  return parts.join("").replace(/\s+/g, " ").trim();
}

export interface PlanDocument {
  title: string;
  revision: string | null;
  status: string | null;
  body: HtmlElement;
}

/** Extract the title, plan metadata, and body from a parsed plan. */
export function readPlanDocument(root: HtmlElement): PlanDocument {
  const metas = findElements(root, (element) => element.tag === "meta");
  const meta = (name: string): string | null => {
    const found = metas.find((element) => (element.attrs.name ?? "").toLowerCase() === name);
    const content = found?.attrs.content;
    return content === undefined || content.length === 0 ? null : content;
  };
  const titleElement = findElement(root, "title");
  const h1 = findElement(root, "h1");
  const title = (titleElement ? textOf(titleElement) : "") || (h1 ? textOf(h1) : "") || "Untitled plan";
  const body = findElement(root, "body") ?? root;
  return { title, revision: meta("plan-revision"), status: meta("plan-status"), body };
}
