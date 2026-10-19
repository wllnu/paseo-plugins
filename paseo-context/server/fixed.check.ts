// Run: node --experimental-strip-types server/fixed.check.ts <transcript.jsonl>
import { measureTranscript } from "./fixed.ts";

for (const part of await measureTranscript(process.argv[2])) {
  console.log(`${part.tokens}\t${part.label} (${part.items.length} items)`);
  for (const item of part.items.slice(0, 3)) console.log(`\t${item.tokens}\t${item.title}`);
}
