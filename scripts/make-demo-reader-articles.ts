#!/usr/bin/env node
/* Local-only: generate mock reader-articles.json for the DEMO edition so the
   /read pages show full articles on camera (demo data dir is mock by design).
   Usage: node scripts/make-demo-reader-articles.ts   (tsx not needed — plain) */
import { readFileSync, writeFileSync } from "node:fs";

const ed = JSON.parse(readFileSync(new URL("../data/demo/edition.json", import.meta.url)));

const CRAFTED = {
  "test-captured-0": `Two years after the Rust async working group shipped its first stable runtime integrations, the borrow checker's role in async code has quietly settled into something the original RFCs never promised: a design tool. The pinning rules that felt like ceremony in 2024 now catch real bugs — futures held across await points that would have been use-after-free in C++ corridors of the same codebases.

The economics shifted too. Teams that adopted async Rust for perceived performance are mostly staying for the cancellation semantics. A task that gets dropped mid-await releases its resources through the normal Drop path, which means timeouts and shutdowns compose without the "finally block everywhere" discipline other ecosystems demand. One survey respondent put it plainly: we stopped writing shutdown code and started writing none.

The rough edges that remain are concentrated in three places. Trait-object futures still force boxing in public APIs, though the affine-type workaround is now documented well enough that newcomers stop on the first try. Cancellation-safety annotations remain a convention rather than a checked contract, so the footguns live in documentation instead of the compiler. And the runtime split means a library author chooses tokio or not-tokio in their Cargo.toml, a decision reviewers continue to relitigate.

What changed in the last year is less mechanical and more cultural: the async Rust codebase stopped being an experiment to justify and started being the boring choice. Boring, in the way Postgres is boring. The two-year mark, it turns out, is when a language feature stops being a language feature and becomes infrastructure.`,
};

function mockBody(item) {
  if (CRAFTED[item.id]) return CRAFTED[item.id];
  const title = item.title.replace(/\s+/g, " ").trim();
  return `The pitch for ${title.replace(/\.*$/, "")} sounds simple enough: take the problem everyone complains about and remove the part nobody actually needs. What makes it interesting is not the mechanism, which has existed in research form for years, but the constraint the author chose to accept up front — it had to run on hardware people already own, with no new services and no configuration step longer than a coffee.

That constraint shapes everything downstream. Where most tools in this space grow a config file first and a mental model second, this one starts from what a person already has and works backward. The result trades flexibility for the thing most projects never recover: the first ten minutes feel like progress instead of homework.

The trade-offs are honest about themselves. Edge cases that bigger systems handle with flag matrices simply fail here, loudly and early, with an error message that names the actual problem. The author's argument is that a loud failure costs minutes and a silent misconfiguration costs weekends, and after reading the issue threads it is hard to argue with the arithmetic.

Whether this approach scales past its current audience is the open question. The pattern of small tools growing config surfaces they once mocked is well documented. But for now the discipline holds, and the core loop — describe what you want, get it, move on with your day — is the part worth stealing even if you never install a line of it.`;
}

const articles = {};
for (const item of ed.items) {
  articles[item.id] = {
    url: item.url,
    text: CRAFTED[item.id] ?? mockBody(item),
  };
}

const out = { edition_date: ed.edition_date, articles };
writeFileSync(
  new URL("../data/demo/reader-articles.json", import.meta.url),
  JSON.stringify(out, null, 1),
);
console.log("wrote reader-articles.json:", Object.keys(articles).length, "articles");
