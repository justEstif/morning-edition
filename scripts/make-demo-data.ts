/* The ONE demo-data entry point — regenerates a coherent, deterministic,
   MOCK-ONLY data/demo/ for filming and sharing (t_4ed6f909):

     data/demo/edition.json          56 items across the 4 sections, varied
                                     realistic titles (NEVER "— variant N"
                                     fixture artifacts), per-item briefs
                                     (self-contained, no teaser phrasing),
                                     has_reader set on every item
     data/demo/reader-articles.json  full mock article text for ALL items so
                                     every /read/<id> page has real prose

   Folds in the logic of three local-only helpers that preceded it:
   make-visual-test-edition.ts (56-item 4-section stretch), tier-demo-edition.ts
   (tier assignment via the domain's assignTiers — the builder is the only
   writer), and make-demo-reader-articles.ts (reader text).

   BINDING CONSTRAINT: everything here is fabricated. example.com URLs,
   invented titles, mock article bodies. The demo directory must never contain
   real editions, real reading history, or any credential.

   Deterministic: a fixed seed and pure array/selection logic — re-runs are
   byte-identical, so the committed fixtures can be regenerated and diffed.

   Run from the repo root:  npx tsx scripts/make-demo-data.ts  */

import { writeFileSync } from "node:fs";
import { assignTiers, type EditionItem } from "../src/lib/domain/edition.js";

const EDITION_DATE = "2026-10-26";

/* ------------------------------------------------------------------ seed -- */

/** xmur3 string hash → 32-bit seed; mulberry32 PRNG. Both public-domain
 *  (bryc/code). Deterministic per id: every item's mock body is seeded from
 *  its own id, so inserting an item never reshuffles the others. */
function seedFrom(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h ^ (h >>> 16);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n distinct picks from items, chosen by rand — order re-rotated by seed. */
function picks<T>(items: T[], n: number, rand: () => number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) {
    out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  return out;
}

/* ------------------------------------------------------- the demo corpus -- */
/* One entry per demo item. `subj` feeds the mock-article generator; briefs
   are hand-written, self-contained (what the piece claims + takeaway, 2-3
   sentences), and deliberately varied in length and framing so a scroll
   never shows the same sentence twice. */

interface DemoEntry {
  id: string;
  section: "captured" | "rust-os" | "ai-at-work" | "might-like";
  source: "readeck" | "miniflux" | "hn";
  slug: string;
  title: string;
  brief: string;
  subj: string;
  crafted?: string; // full bespoke article text (leads get these)
  /** Digest-mode example (card t_b3782402): when set, `crafted` must be the
   *  THIN extraction (< READER_THIN_CHARS) that yielded it — the item ships
   *  reader_mode:"digest" and the /read page leads with the digest. */
  digest?: string;
}

const CAPTURED_AT_BASE = Date.parse("2026-10-24T15:20:00Z");

const CAPTURED: DemoEntry[] = [
  {
    id: "readeck-4TaqWv2PmZLh8nRxJk1cQ",
    section: "captured",
    source: "readeck",
    slug: "async-rust-two-years-in",
    title: "Async Rust, Two Years In: What the Borrow Checker Actually Costs You",
    brief:
      "Two years of stable async Rust have moved the argument from 'is it ready' to what the borrow checker actually asks of working programmers. Cancellation safety is still the one place where the compiler stays silent and the footguns live in documentation instead of types.",
    subj: "async Rust after two years of stable runtimes",
    crafted: `Two years after the Rust async working group shipped its first stable runtime integrations, the borrow checker's role in async code has quietly settled into something the original RFCs never promised: a design tool. The pinning rules that felt like ceremony in 2024 now catch real bugs — futures held across await points that would have been use-after-free in the C++ corridors of the same codebases.

The economics shifted too. Teams that adopted async Rust for perceived performance are mostly staying for the cancellation semantics. A task that gets dropped mid-await releases its resources through the normal Drop path, which means timeouts and shutdowns compose without the "finally block everywhere" discipline other ecosystems demand. One survey respondent put it plainly: we stopped writing shutdown code and started writing none.

The rough edges that remain are concentrated in three places. Trait-object futures still force boxing in public APIs, though the affine-type workaround is now documented well enough that newcomers stop on the first try. Cancellation-safety annotations remain a convention rather than a checked contract, so the footguns live in documentation instead of the compiler. And the runtime split means a library author chooses tokio or not-tokio in their Cargo.toml, a decision reviewers continue to relitigate.

What changed in the last year is less mechanical and more cultural: the async Rust codebase stopped being an experiment to justify and started being the boring choice. Boring, in the way Postgres is boring. The two-year mark, it turns out, is when a language feature stops being a language feature and becomes infrastructure.`,
  },
  {
    id: "readeck-8Kx3vNqLmwRd2fYs9pHbT",
    section: "captured",
    source: "readeck",
    slug: "own-email-2026",
    title: "Why I Still Run My Own Email in 2026",
    brief:
      "A thirteen-year personal mail server survives on three habits: plain formats, conservative upgrades, and refusing every managed feature that cannot be exported. The running cost is now under a day of maintenance a year, which the author argues is the true price of owning an address.",
    subj: "a long-running personal mail server",
  },
  {
    id: "miniflux-44718",
    section: "captured",
    source: "miniflux",
    slug: "postgres-18-release-notes",
    title: "Postgres 18: the Release Notes Are the Feature",
    brief:
      "The Postgres 18 release notes read less like a changelog and more like a statement of direction: asynchronous I/O lands on a default-on path, and the vacuum work finally targets the case every operator actually hits. Each notable change is paired with the benchmark that motivated it.",
    subj: "the Postgres 18 release",
  },
  {
    id: "readeck-qL5mWcX2vTnJ8pRs6dKhY",
    section: "captured",
    source: "readeck",
    slug: "field-guide-any-codebase",
    title: "A Field Guide to Understanding Any Codebase in a Week",
    brief:
      "Find the data, trace one write path end to end, and only then read the tests. The guide insists a week is enough for any codebase under a million lines, provided you resist fixing things while you read.",
    subj: "a method for reading unfamiliar code",
  },
  {
    id: "miniflux-45102",
    section: "captured",
    source: "miniflux",
    slug: "boring-tech-mars-helicopter",
    title: "The Boring Technology Behind the Mars Helicopter",
    brief:
      "Ingenuity flew on a Linux box running an unpatched kernel, and the mission succeeded precisely because every component was chosen for flight heritage over capability. The lesson generalizes: exotic parts fail in ways nobody rehearsed.",
    subj: "the flight software of the Ingenuity helicopter",
  },
  {
    id: "readeck-Vb7nJq3mXpLd9wTs2fRcK",
    section: "captured",
    source: "readeck",
    slug: "grid-software-problem",
    title: "The Day the Grid Became a Software Problem",
    brief:
      "Grid operators now dispatch electricity the way cloud operators dispatch compute, and the failure modes have migrated with the software. Three documented near-misses are set out here, and in each one a scheduling bug, not a storm, came closest to dropping load.",
    subj: "software scheduling in electricity grids",
  },
  {
    id: "miniflux-45367",
    section: "captured",
    source: "miniflux",
    slug: "tariffs-used-server-market",
    title: "How Tariffs Rewired the Used Server Market",
    brief:
      "Tariff schedules quietly reshaped the secondary server market: rack prices decoupled from hardware age, and whole regions switched from importing refurbished machines to reconditioning domestically. The data comes from five years of public auction results.",
    subj: "five years of used-server auction data",
  },
  {
    id: "readeck-J2wQy8vNcRmT5xLp5dHbS",
    section: "captured",
    source: "readeck",
    slug: "ethics-of-the-default",
    title: "The Ethics of a Default: Notes on Opt-Out Everything",
    brief:
      "Every default is a decision made on behalf of someone who will never open settings. Tracing opt-out design from cookie banners to model-training toggles, the essay asks where consent actually lives when the switch is pre-flipped.",
    subj: "defaults as ethical decisions in product design",
  },
  {
    id: "readeck-Kp9wDx5mNqTc3vJs8fLbR",
    section: "captured",
    source: "readeck",
    slug: "bell-labs-memo-ai-assistants",
    title: "What a 1987 Bell Labs Memo Predicts About AI Assistants",
    brief:
      "A Bell Labs memo on computer-aided documentation predicts, almost sentence for sentence, how assistants would be used and misused: as a drafting aid, a summary engine, and a way to skip reading. Its proposed safeguards failed for reasons that still apply.",
    subj: "a 1987 memo on computer-aided documentation",
  },
  {
    id: "miniflux-45884",
    section: "captured",
    source: "miniflux",
    slug: "cloud-egress-fine-print",
    title: "Reading the Fine Print in Cloud Egress Pricing",
    brief:
      "Egress pricing looks like a line item until a migration makes it a line item you negotiate. The sticker rate matters less than the waiver tiers, and most teams leave free discounts unclaimed because nobody reads past the calculator.",
    subj: "the contract structure of cloud egress pricing",
  },
  {
    id: "readeck-Ts6cHb3wQmXnJ8vLp5dRfK",
    section: "captured",
    source: "readeck",
    slug: "librarian-orphan-pages",
    title: "The Librarian Who Catalogued the Internet's Orphan Pages",
    brief:
      "A one-person project to index pages with no surviving inbound links has catalogued four million documents that would otherwise vanish with their hosts. The hard part is deciding an orphan page is worthless, which requires exactly the judgment no crawler has.",
    subj: "an index of pages with no inbound links",
    // THE digest-mode example (card t_b3782402): the source's extraction came
    // back thin (~500 chars — a partial fetch), so the paper's digest is the
    // story and the raw scrap sits below the fold on /read.
    crafted: `The Orphan Pages Project began as a spreadsheet. Its maintainer, a former academic librarian who asks to be described only as a cataloguer, started saving URLs the week her library cancelled its link-rot audit, and the spreadsheet became a crawler, and the crawler became an index of four million pages that no other page links to.

There is no funding and no team. There is a submission form, a monthly export, and a rule the cataloguer repeats in every interview: an orphan page is not a worthless page.`,
    digest: `A former academic librarian runs a one-person index of roughly four million web pages that nothing else links to — orphan pages that would vanish when their hosts do. It started as a spreadsheet the week her library cancelled its link-rot audit and grew into a crawler with a submission form and a monthly export. The project has no funding and no team; its one stated rule is that an orphan page is not a worthless page.`,
  },
  {
    id: "readeck-Mw4qZnV8cJpLx3dTs6fRbK",
    section: "captured",
    source: "readeck",
    slug: "latency-design-material",
    title: "Latency Is a Design Material",
    brief:
      "Treating latency as an aesthetic constraint rather than a performance metric changes interface design: the pieces users touch get the milliseconds, and the pieces users watch get the wait. Examples from flight booking to text editors show waits made honest rather than hidden.",
    subj: "latency as a design constraint in interfaces",
  },
  {
    id: "readeck-Qx8vLp3mNdKs2wJc5fTbRh",
    section: "captured",
    source: "readeck",
    slug: "defense-of-personal-archive",
    title: "A Defense of the Personal Archive",
    brief:
      "Thirty years of personal notes in plain text files survive every platform bankruptcy and every format fashion. The defense is not nostalgia: search over your own writing improves with age, while search over a vendor's improves with their quarter.",
    subj: "a thirty-year personal archive in plain text",
  },
  {
    id: "miniflux-46123",
    section: "captured",
    source: "miniflux",
    slug: "wayback-machine-petabytes",
    title: "Inside the Archive: How the Wayback Machine Stores a Petabyte a Day",
    brief:
      "The engineering answer to petabyte-a-day ingestion is a stack of boring decisions: append-only storage, aggressive dedupe, and formats chosen to outlive their parsers. A tour of the racks behind the public web's memory.",
    subj: "the storage engineering behind the Wayback Machine",
  },
];

const RUST_OS: DemoEntry[] = [
  {
    id: "hn-50231102",
    section: "rust-os",
    source: "hn",
    slug: "filesystem-in-1000-lines",
    title: "A Filesystem in 1,000 Lines of Rust",
    brief:
      "A teaching filesystem that fits in a thousand lines of Rust while keeping crash consistency through a write-ahead journal. Every design cut is paired with the test that would have caught the bug the cut reintroduces.",
    subj: "a minimal journaling filesystem in Rust",
    crafted: `A thousand lines is not a lot of filesystem. Strip away the VFS plumbing and the buffer cache that any kernel provides, and what remains in this implementation is the honest core: an on-disk layout, a write-ahead journal, and just enough allocator to be dangerous. The constraint is the pedagogy — every design decision has to fit in a lecture slide, and every shortcut has to be named.

The journal is where the lines go. Crash consistency is the one property a toy filesystem cannot skip, because a filesystem that loses data on power failure teaches exactly the wrong lesson. Here that means: metadata operations are appended to a fixed-size ring, a checksum rides each record, and recovery is a single replay pass with a defined order. The author resisted making the journal optional — a configurable safety property is a safety property students will turn off.

What the line budget buys is readability, and readability is the point. A student can hold the whole write path in their head, which makes the failure cases discussable: what happens when the disk fills mid-transaction, what replay does with a torn record, why the allocator refuses to reuse a block in the same epoch. The companion test suite attacks each of these by fuzzing the disk image between mount and crash.

The open question is how far the constraint stretches. Networking, extended attributes, and directories beyond two levels all want more lines than the budget has. The author's answer is refreshingly anti-ambitious: forks are welcome, but the thousand-line core stays frozen, because the artifact being maintained is not the filesystem — it is the reader's ability to understand one.`,
  },
  {
    id: "miniflux-46552",
    section: "rust-os",
    source: "miniflux",
    slug: "tickless-kernels",
    title: "Tickless Kernels: What Actually Changed in the Scheduler",
    brief:
      "Removing the periodic timer interrupt was the easy part; the interesting changes are sub-millisecond accounting, timer coalescing, and the debug tooling that quietly assumed a heartbeat. A close look at what the kernel does with all the quiet time.",
    subj: "tickless scheduling in modern kernels",
  },
  {
    id: "hn-50230987",
    section: "rust-os",
    source: "hn",
    slug: "calling-go-from-rust",
    title: "Calling Go From Rust: Mapping the Real Costs of the FFI Boundary",
    brief:
      "Go libraries reached from Rust through C-shaped bindings work until garbage collection and goroutine state meet an unsynchronized boundary. The piece maps which calls are safe, which need runtime locks, and why the clean answer is usually a sidecar process.",
    subj: "Go libraries called from Rust through C bindings",
  },
  {
    id: "miniflux-46801",
    section: "rust-os",
    source: "miniflux",
    slug: "ebpf-verifier-simulation",
    title: "Writing an eBPF Verifier Simulation in Rust",
    brief:
      "Reimplementing the eBPF verifier's abstract interpreter in userspace lets tool authors test programs without a kernel nearby. The simulator reproduces the rejection cases that matter and shaves the reboot loop out of the development cycle.",
    subj: "a userspace reimplementation of the eBPF verifier",
  },
  {
    id: "miniflux-47017",
    section: "rust-os",
    source: "miniflux",
    slug: "capability-memory-hobby-oses",
    title: "The Case for Capability-Based Memory in Hobby OSes",
    brief:
      "Capability-based memory protection has been the future since the i4320, but CHERI boards finally make it testable on a desk. The argument: hobby operating systems are where programming models get honest, because nobody there has a compatibility list to protect.",
    subj: "capability-based memory on CHERI hardware",
  },
  {
    id: "hn-50230744",
    section: "rust-os",
    source: "hn",
    slug: "cgroup-v2-lessons",
    title: "cgroup v2, Six Years In: Lessons From Shipping It Everywhere",
    brief:
      "Six years of cgroup v2 in production produced a short list of rules: one hierarchy, delegate deliberately, and never let two tools own the same controller. Each rule comes with the incident, not the RFC, that motivated it.",
    subj: "six years of production cgroup v2",
  },
  {
    id: "miniflux-47233",
    section: "rust-os",
    source: "miniflux",
    slug: "toy-kernel-c-to-rust",
    title: "Porting a Toy Kernel From C to Rust: the Diff, Line by Line",
    brief:
      "A line-by-line port of a teaching kernel from C to Rust, keeping the same linker script and boot path. The diff is boring in the best way: unsafe shrinks to three pages of MMIO, and the borrow checker catches one real double-unmap.",
    subj: "a C-to-Rust kernel port",
  },
  {
    id: "hn-50230561",
    section: "rust-os",
    source: "hn",
    slug: "io-uring-in-production",
    title: "io_uring Beyond the Benchmarks: Where It Breaks in Production",
    brief:
      "io_uring benchmarks always shine, but production traffic mixes file types and failure modes the benchmarks skip. This inventory of where it breaks — buffered reads on network mounts, registered files going stale — is the checklist the fast path deserves.",
    subj: "io_uring failure modes under real workloads",
  },
  {
    id: "miniflux-47490",
    section: "rust-os",
    source: "miniflux",
    slug: "page-tables-type-system",
    title: "Immutability at the MMU: Page Tables as a Type System",
    brief:
      "Framing MMU page permissions as a type system clarifies what the hardware already proves, what the compiler could prove with annotations, and where the gap that kernel exploits live actually sits. Dense, but the mapping table alone is worth the read.",
    subj: "page permissions treated as a type system",
  },
  {
    id: "hn-50230388",
    section: "rust-os",
    source: "hn",
    slug: "rust-in-freebsd",
    title: "Rust in FreeBSD: the First Year of the Gateway",
    brief:
      "The first year of Rust code in the FreeBSD tree produced one driver, a coding standard, and a decision that review capacity, not compiler maturity, is the real constraint. A sober status report from inside a slow-moving tree.",
    subj: "the first year of Rust code in the FreeBSD tree",
  },
  {
    id: "miniflux-47765",
    section: "rust-os",
    source: "miniflux",
    slug: "scheduler-bugs-tracing",
    title: "How Scheduler Bugs Hide: a Tracing Field Guide",
    brief:
      "Scheduler bugs hide because their symptoms are load-shaped: they vanish under tracing and reproduce under customers. This field guide covers the tracing modes that survive production and the signatures that point at priority inversion rather than capacity.",
    subj: "tracing techniques for scheduler bugs",
  },
  {
    id: "miniflux-47908",
    section: "rust-os",
    source: "miniflux",
    slug: "btrfs-decade",
    title: "The Btrfs Decade: What Repair Actually Looks Like",
    brief:
      "Ten years on, Btrfs repair is a known quantity: what scrub catches, what it does not, and why the recommendation flipped from 'avoid' to 'fine with a caveat' on most distributions. The caveat gets its own section.",
    subj: "a decade of Btrfs repair experience",
  },
  {
    id: "hn-50230170",
    section: "rust-os",
    source: "hn",
    slug: "rust-compositor-no-dropped-frames",
    title: "Building a Compositor in Rust Without Losing a Frame",
    brief:
      "A Wayland compositor that never misses a frame is less about the language and more about respecting the presentation clock. The write-up covers buffer age, damage tracking, and the one allocation that cost a vblank.",
    subj: "a frame-perfect Wayland compositor in Rust",
  },
  {
    id: "miniflux-48122",
    section: "rust-os",
    source: "miniflux",
    slug: "userspace-drivers-practical",
    title: "Userspace Drivers Are Finally Practical — Here's the Catch",
    brief:
      "Drivers in userspace behind small privileged shims are finally practical, thanks to mature VFIO and UIO paths — with real tradeoffs in reset handling and hotplug. The catch, as ever, is DMA: the hardware trusts whoever holds the mappings.",
    subj: "userspace drivers over VFIO and UIO",
  },
];

const AI_AT_WORK: DemoEntry[] = [
  {
    id: "hn-50231045",
    section: "ai-at-work",
    source: "hn",
    slug: "measuring-agent-productivity",
    title: "What Teams Actually Measure When They Measure Agent Productivity",
    brief:
      "Most teams track acceptance rate, which proxies for convenience rather than value. The organizations with useful numbers count reverted changes and rework half-life — and their dashboards look nothing like the vendor slides.",
    subj: "how organizations measure coding-agent value",
    crafted: `Ask three engineering leaders how they measure agent productivity and you will get the same metric with three names for it: acceptance rate, suggestion share, lines merged with assistance. All three are convenience measurements. They record how often the tool's output survived the next sixty seconds, which turns out to be almost uncorrelated with whether the work held up over a quarter.

The organizations with durable numbers moved the measurement downstream. Reverted-change rate is the first honest signal: a merged diff that a human deletes within two weeks was never productivity. Rework half-life — how long until the assisted code needs another touch — catches a subtler failure, code that works but doesn't fit, and gets reopened by whoever inherits it. Neither metric flatters the tool in week one; both predict what engineering will think of it in month six.

The second-order findings are the interesting part. Teams that instrument honestly discover the bottleneck moved: review capacity, not authoring speed, is what constrains throughput once generation gets cheap. Several found their best agents-assisted velocity in documentation and test backfill — the work nobody scheduled because it never fit a sprint — rather than in feature development, where the calendar says the gains actually landed.

None of this requires exotic instrumentation, which is the encouraging part. Every system described here is computed from the git history organizations already keep, plus one habit: tagging which diffs had machine assistance before merge. The teams that skip the tagging skip the learning; a year later they are still arguing from anecdotes, and the vendor's slide deck is the only dashboard in the room.`,
  },
  {
    id: "miniflux-48307",
    section: "ai-at-work",
    source: "miniflux",
    slug: "dr-tabletops-include-agent",
    title: "Disaster-Recovery Tabletops Now Include the Agent",
    brief:
      "Incident tabletops schedule the coding agent as a participant, because during a real incident it will be one. The templates cover the uncomfortable case: the agent's suggestion conflicts with the runbook, and half the room trusts it.",
    subj: "coding agents as participants in incident tabletops",
  },
  {
    id: "hn-50230812",
    section: "ai-at-work",
    source: "hn",
    slug: "code-review-queue-after-ai",
    title: "The Code Review Queue After AI: More Reviews, Less Reviewing",
    brief:
      "AI-generated pull requests doubled queue length and halved average attention per review, which is the same problem wearing two hats. Teams that fixed it changed the contract: authors, human or not, ship smaller diffs or wait longer.",
    subj: "review capacity in an AI-authored pull-request world",
  },
  {
    id: "miniflux-48551",
    section: "ai-at-work",
    source: "miniflux",
    slug: "prompt-debt-taxonomy",
    title: "Prompt Debt Is Technical Debt: a Postmortem Taxonomy",
    brief:
      "Prompt debt behaves like technical debt with worse telemetry: it accumulates invisibly, fails in production, and the fix is one line nobody wrote down. A taxonomy drawn from twenty postmortems, sorted by who had to discover the undocumented behavior.",
    subj: "prompt debt catalogued through incident postmortems",
  },
  {
    id: "hn-50230659",
    section: "ai-at-work",
    source: "hn",
    slug: "agent-opens-a-pr",
    title: "When the Coding Agent Opens a PR: Ownership Without a Human Author",
    brief:
      "When the agent opens the pull request, blame gets philosophically interesting and operationally simple: the human who merged it owns it. The argument is that the review trail, not authorship, is the accountability surface.",
    subj: "ownership of agent-authored pull requests",
  },
  {
    id: "miniflux-48790",
    section: "ai-at-work",
    source: "miniflux",
    slug: "retrieval-org-chart",
    title: "Retrieval Is an Org Chart Problem",
    brief:
      "Retrieval quality problems are usually routing problems: the answer existed, but it lived in a repo, a wiki, and three heads, and the system indexed only the repo. Fixing retrieval meant fixing who owns which document — an org chart with a search bar.",
    subj: "document ownership behind retrieval quality",
  },
  {
    id: "hn-50230477",
    section: "ai-at-work",
    source: "hn",
    slug: "internal-ai-platform-team",
    title: "The Quiet Rise of the Internal AI Platform Team",
    brief:
      "The internal AI platform team — model access, evals, guardrails, cost accounting — arrived without a mandate and became the bottleneck nobody budgeted for. A look at how four companies scoped it before it scoped itself.",
    subj: "internal platform teams for AI tooling",
  },
  {
    id: "miniflux-49012",
    section: "ai-at-work",
    source: "miniflux",
    slug: "evals-survive-backlog",
    title: "Evaluations That Survive Contact With a Real Backlog",
    brief:
      "Evaluation suites that survive real backlogs share three properties: they run in CI, they fail loudly on regressions users would feel, and product owns the cases. Everything else is a demo that rots.",
    subj: "evaluation suites that stay maintained",
  },
  {
    id: "miniflux-49238",
    section: "ai-at-work",
    source: "miniflux",
    slug: "ai-meeting-notes-record",
    title: "AI Meeting Notes Changed Who Owns the Record",
    brief:
      "Automatic meeting notes settled an old argument by accident: whoever controls the summary controls the record, and now the model does. Teams are quietly writing policies for an archive no human transcribed.",
    subj: "machine-transcribed meeting records",
  },
  {
    id: "hn-50230236",
    section: "ai-at-work",
    source: "hn",
    slug: "context-budgets",
    title: "Context Budgets: Why Your Agent Forgets the Roadmap",
    brief:
      "Context budgets explain a whole class of agent misbehavior: the roadmap got truncated to make room for a stack trace, so the agent confidently shipped last quarter's plan. Budgeting context like memory — with priorities and eviction — fixes most of it.",
    subj: "context budgets and eviction in agent sessions",
  },
  {
    id: "miniflux-49477",
    section: "ai-at-work",
    source: "miniflux",
    slug: "hiring-junior-tasks-gone",
    title: "Hiring When the Junior Tasks Are Gone",
    brief:
      "The junior tasks are gone, so the ladder is being rebuilt in mid-air: apprenticeship now starts where verification starts, not where typing starts. Hiring managers describe what predicts success when the first job is reviewing, not writing.",
    subj: "early-career hiring after task automation",
  },
  {
    id: "hn-50230112",
    section: "ai-at-work",
    source: "hn",
    slug: "audit-ai-usage-logs",
    title: "A Field Audit of Our Own AI Usage Logs",
    brief:
      "A month of internal usage logs, audited: what people actually paste in (less sensitive than policy feared), what they hide (more than anyone admitted), and where the real exposure turned out to be — telemetry, not prompts.",
    subj: "an internal audit of AI usage logs",
  },
  {
    id: "miniflux-49611",
    section: "ai-at-work",
    source: "miniflux",
    slug: "auto-generated-runbooks",
    title: "The Second-Order Effects of Auto-Generated Runbooks",
    brief:
      "Auto-generated runbooks drift from the systems they describe at exactly the rate those systems change, which makes stale runbooks a leading indicator. The teams that benefit regenerate on deploy and stamp every page with the commit it describes.",
    subj: "runbook drift under auto-generation",
  },
  {
    id: "hn-50230033",
    section: "ai-at-work",
    source: "hn",
    slug: "security-review-agent-tool-calls",
    title: "Security Review for Agent Tool Calls: the Checklist That Stuck",
    brief:
      "A security checklist for agent tool calls that survived a year in production: scope each tool, log every invocation with the prompt that triggered it, rate-limit by default. It exists because one agent, given a deployment tool, redeployed production on a guess.",
    subj: "a production security checklist for agent tool calls",
  },
];

const MIGHT_LIKE: DemoEntry[] = [
  {
    id: "readeck-2nVqX8cLpMdJk5wTs3fRh",
    section: "might-like",
    source: "readeck",
    slug: "economics-self-hosting-2026",
    title: "The Economics of Self-Hosting in 2026",
    brief:
      "Self-hosting economics in 2026: the hardware is cheap, the bandwidth is fine, and the real cost is the afternoon you lose to a certificate renewal at a family dinner. The spreadsheet behind the piece prices attention honestly, and the answer is still 'host the boring things.'",
    subj: "the real costs of self-hosting in 2026",
    crafted: `The hardware is a solved problem. A used mini PC that idles at seven watts runs a mail server, a feed reader, and a photo archive with room to spare, and the whole machine costs less than a year of the subscriptions it replaces. Anyone still arguing about the hardware is arguing about 2015. What the spreadsheet in this piece tries to capture is everything after the hardware: the domain, the electricity, the backups — and the hours.

The hours are the honest cost. Certificate renewals that fail silently, upgrade windows that eat a Sunday, the debugging session that starts with "why is DNS broken" and ends three hours later in a router firmware changelog. Priced at a real hourly rate, most self-hosted services lose to the cloud on paper. The author's ledger makes this visible rather than pretending otherwise, and that is the piece's best move: the spreadsheet has a column for attention, and the attention column is not kind.

So why does the answer come out "host the boring things"? Because the boring services — file sync, feeds, notes, backups — have stopped changing. A decade of standardization means they configure once and run for years, and their failure modes are documented by ten thousand people who hit them first. The exciting services, the ones with features that ship weekly, are exactly the ones whose maintenance eats the attention column.

The closing framework is worth stealing regardless of where you land: classify every service by how often it changes and how much it costs you when it's down, and host only the quadrant that is stable and personally important. Everything else gets a hosted plan and a real export button. The point was never to run everything yourself; it was to make sure the things you depend on daily don't depend on a pricing page.`,
  },
  {
    id: "miniflux-49804",
    section: "might-like",
    source: "miniflux",
    slug: "catalog-seeds-weather",
    title: "How Catalog Seed Companies Predict the Weather",
    brief:
      "Seed catalogs are written a year ahead, which makes catalog copy a folk weather forecast: regional copy edits track drought years with uncanny fidelity. A small archival study with a great dataset.",
    subj: "regional copy edits in seed catalogs as weather records",
  },
  {
    id: "readeck-7YhBw2mQsNcTxJ4vR8dLp",
    section: "might-like",
    source: "readeck",
    slug: "lost-art-memorandum",
    title: "The Lost Art of the Memorandum: How Writers Kept Thinking Before Notebooks",
    brief:
      "Before note apps ate thinking, the memorandum did: one page, one claim, written to be filed and found. The form's constraints — brevity, single purpose, an assumption it would be retrieved — are exactly what modern tools lost.",
    subj: "the memorandum as a thinking technology",
  },
  {
    id: "miniflux-50018",
    section: "might-like",
    source: "miniflux",
    slug: "reading-census-handwriting",
    title: "A Beginner's Guide to Reading Handwritten Census Records",
    brief:
      "Reading census handwriting is a learnable skill with about thirty recurring traps: doubled letters, enumerator shorthand, names spelled phonetically by ear. The guide teaches the traps as a system rather than a list.",
    subj: "the recurring patterns in census enumerators' handwriting",
  },
  {
    id: "readeck-Pm3kXc9vQdRnJt6wLs2Hb",
    section: "might-like",
    source: "readeck",
    slug: "transit-maps-lie",
    title: "Why Public Transit Maps Lie: a Cartographer's Confession",
    brief:
      "Every transit map is a lie agreed upon: distances distorted, rivers bent, walking distances erased. What maps actually optimize for, and why the honest map turns out to be unusable.",
    subj: "the deliberate distortions of transit mapping",
  },
  {
    id: "miniflux-50233",
    section: "might-like",
    source: "miniflux",
    slug: "mechanical-watch-comeback",
    title: "The Quiet Comeback of the Mechanical Watch",
    brief:
      "The mechanical watch returned as an object of maintenance rather than status: something you wind, service, and keep alive across decades. A week on a repair bench, following rescues.",
    subj: "the repair culture around mechanical watches",
  },
  {
    id: "readeck-Wr6tYb3nKsQmVx8cJd5Lp",
    section: "might-like",
    source: "readeck",
    slug: "fermentation-patience",
    title: "What Fermentation Teaches About Patience and Failure",
    brief:
      "Fermentation teaches the specific patience of watching a process you can neither rush nor reverse, with failure that is obvious only in hindsight. An essay that stays on the right side of metaphor.",
    subj: "fermentation as a practice in patience",
  },
  {
    id: "miniflux-50459",
    section: "might-like",
    source: "miniflux",
    slug: "anatomy-of-a-good-path",
    title: "The Anatomy of a Good Path",
    brief:
      "Trail designers route a path by what the walker will tolerate: grade, sightlines, and the promise that the map matches the ground. The same geometry explains why some campus shortcuts survive paving and some do not.",
    subj: "trail design geometry",
  },
  {
    id: "readeck-Zc5pLd8wQnJmRx3vTs7Hb",
    section: "might-like",
    source: "readeck",
    slug: "luthiers-tune-wood",
    title: "How Luthiers Tune Wood",
    brief:
      "Luthiers tune wood before building with it, tapping plates and listening for modes the finished guitar will carry. The craft sits at the exact edge of what can be measured and what must be heard.",
    subj: "plate tuning in guitar making",
  },
  {
    id: "miniflux-50676",
    section: "might-like",
    source: "miniflux",
    slug: "forgotten-desktop-environments",
    title: "The Archive of Forgotten Desktop Environments",
    brief:
      "An archive of forgotten desktop environments is an archive of arguments about how people work: shells, spatial file managers, zooming interfaces, each lost for reasons that were never 'bad code.' The screenshots do the time travel.",
    subj: "preserved desktop environments that didn't survive",
  },
  {
    id: "readeck-Hn9wJs4cQdTmVb7xLp2Rf",
    section: "might-like",
    source: "readeck",
    slug: "star-charts-on-paper",
    title: "Star Charts on Paper: the History of Celestial Atlases",
    brief:
      "Celestial atlases solved a hard layout problem — mapping a sphere onto a page without lying about the sky — and their solutions track the history of print itself. A survey with plates worth the paper they lost.",
    subj: "the projection problems of printed star atlases",
  },
  {
    id: "miniflux-50890",
    section: "might-like",
    source: "miniflux",
    slug: "public-phone-museum",
    title: "A Walk Through the Last Public Phone Museum",
    brief:
      "One of the last museums of public telephony, where every exhibit is the same object solving one problem across a century of hardware. The restored audio booths still take calls.",
    subj: "a museum of public telephony",
  },
  {
    id: "readeck-Lt2rYw8mQcXnJd5vKs9Hb",
    section: "might-like",
    source: "readeck",
    slug: "typography-of-train-stations",
    title: "The Typography of Train Stations",
    brief:
      "Station lettering had to work wet, dark, and at a glance, which is why it became the ancestor of the sans-serifs now on your screen. The story runs from railway signage plates to the family this page is set in.",
    subj: "railway lettering and its descendants",
  },
  {
    id: "readeck-Gv7kXm2cQdJnTs4wLp6Rh",
    section: "might-like",
    source: "readeck",
    slug: "why-build-cathedrals",
    title: "Why We Still Build Cathedrals",
    brief:
      "Cathedrals were built on timelines no individual could expect to see finished, by institutions optimizing for permanence over schedule. What a cathedral project looks like when the institution is a software project and the timeline is forty years.",
    subj: "very long projects under short-lived institutions",
  },
];

const ALL_ENTRIES: DemoEntry[] = [...CAPTURED, ...RUST_OS, ...AI_AT_WORK, ...MIGHT_LIKE];

const SECTION_ENTRIES = {
  captured: CAPTURED,
  "rust-os": RUST_OS,
  "ai-at-work": AI_AT_WORK,
  "might-like": MIGHT_LIKE,
} as const;

/* --------------------------------------------------- mock-article bodies -- */

const WHO = [
  "the maintainers",
  "a two-person team",
  "an infrastructure group at a mid-size company",
  "a solo developer",
  "the original authors",
  "a systems group at a university lab",
  "a small platform team",
  "an independent researcher",
];

const STAT = [
  "roughly a third of the teams that adopted it",
  "about forty percent of production traffic",
  "one deployment in five",
  "a bit under half the reported incidents",
  "seven of the ten largest users surveyed",
  "close to two-thirds of the failing cases",
  "about one issue in twelve",
  "nearly every cluster above a hundred nodes",
];

const TOOL = [
  "the reference implementation",
  "the default configuration",
  "the oldest supported release",
  "the minimal setup",
  "the documented workaround",
  "a stock install",
];

const VENUE = [
  "the issue tracker",
  "the project's discussion threads",
  "a long conference Q&A",
  "the mailing-list archive",
  "a follow-up talk",
  "the commit history",
];

const OPENERS = [
  (c: Ctx) =>
    `Every field eventually produces a piece about ${c.subj} that skips the introduction and starts where the arguments actually are. This is that piece. ${cap(c.who)} wrote it out of the notes of a project that had to learn the lessons twice.`,
  (c: Ctx) =>
    `The story of ${c.subj} begins with a constraint that sounds self-imposed: make it work for ${c.who} without a support contract, a cluster, or a migration weekend. Everything unusual in the design follows from taking that constraint seriously.`,
  (c: Ctx) =>
    `There is a version of ${c.subj} that demos well and a version that survives production, and they are not the same version. What follows is an account of the second one, assembled from the working notes of ${c.who}.`,
  (c: Ctx) =>
    `"${c.title}" is the kind of topic that collects folklore: half of it true, half of it true in 2019. The aim here is to keep only the half that still holds, starting with what ${c.who} actually run in practice.`,
  (c: Ctx) =>
    `Ask ${c.who} about ${c.subj} and you will get two answers: the one for the talk and the one for the hallway. This is the hallway answer, with the numbers left in.`,
  (c: Ctx) =>
    `The most interesting thing about ${c.subj} is not the mechanism, which is straightforward, but the discipline it demands. ${cap(c.who)} learned that the expensive way, and wrote the costs down.`,
  (c: Ctx) =>
    `Few topics produce as much confident disagreement as ${c.subj}. The disagreement is real, and it comes from people solving different problems under the same name — which is exactly where the confusion starts.`,
  (c: Ctx) =>
    `Not long ago, ${c.subj} was a research topic with a demo; today it is the boring default, and the transition happened almost without ceremony. What follows is a record of how the boring version won, kept by ${c.who}.`,
];

const MECHANISM = [
  (c: Ctx) =>
    `The core mechanism is easier to describe than to appreciate. ${cap(c.subj)} works by making the common path the only path: instead of offering options, it removes the forks where mistakes used to happen, and the options that remain are the ones someone was willing to defend.`,
  (c: Ctx) =>
    `Under the hood, the design leans on a simple trade: give up flexibility nobody uses, and spend the savings on the failure cases everybody eventually meets. That is why ${c.tool} behaves oddly at the edges — the edges are where the guarantees were purchased.`,
  () =>
    `The implementation keeps a deliberate distance from the platform underneath it. Where most designs reach for the newest interface, this one targets the oldest stable one and re-derives the conveniences on top, which is slower on paper and faster in incidents.`,
  () =>
    `A useful mental model: imagine the system as a small compiler from intent to operations, with a rule that every translation must be reversible until it is confirmed. The overhead of that rule is small; the number of three-in-the-morning pages it removes is not.`,
  (c: Ctx) =>
    `The trick, such as it is, is bookkeeping. ${cap(c.subj)} succeeds because it never lets two sources of truth disagree quietly: when state diverges, the divergence is a loud error with a name, not a drift someone notices a quarter later.`,
  () =>
    `Most of the engineering effort went into what happens when things stop working. Timeouts are chosen to match human patience rather than machine comfort, retries are bounded by budget rather than hope, and every fallback has an owner.`,
  () =>
    `The design's one clever idea is that configuration is code with worse review, so it treats configuration the way compilers treat source: parsed, checked, and refused loudly when it does not make sense, rather than interpreted generously at runtime.`,
];

const EVIDENCE = [
  (c: Ctx) =>
    `The numbers are modest and therefore credible. ${cap(c.stat)} saw the expected improvement, and the rest saw roughly nothing — which the author treats as the control group working, not the result failing.`,
  (c: Ctx) =>
    `The evidence is mostly operational. Over a year of production use, ${c.stat} stopped filing the class of incident that used to begin with the phrase "we think what happened is."`,
  () =>
    `Benchmarks exist, and they are fine. The more persuasive data comes from the boring log: queue times flattened, the tail stopped growing, and the weekly variance narrowed to a band you can eyeball.`,
  (c: Ctx) =>
    `The strongest argument is what disappeared. After the change, ${c.stat} no longer needed the workaround at all — and the workaround had been load-bearing longer than anyone wanted to admit.`,
  () =>
    `A year of issue-tracker data makes the case better than any chart: the reproducible failures moved from silent corruption to loud refusal, and the median time to a correct diagnosis dropped from days to minutes.`,
  (c: Ctx) =>
    `Nobody claims elegance wins on its own. But ${c.stat} reduced to a scheduled task, and the scheduled task has held for three quarters without a patch.`,
];

const TRADEOFF = [
  () =>
    `The costs are real and stated plainly. Cold starts are slower, migrations want rehearsal, and anyone expecting drop-in compatibility will spend a weekend reading error messages that are at least honest about what they refuse.`,
  () =>
    `There is a genuine cost in vocabulary. Newcomers must learn a handful of terms before anything compiles, and the error messages, though precise, assume the reader has paid that toll.`,
  () =>
    `The trade is visibility for certainty: the system shows you less of its internals in exchange for stronger promises about the parts it does show. People who debug by inspection find this maddening, and they are not wrong.`,
  () =>
    `What the design gives up is headroom. The old loose approach could absorb a bad dependency, a misconfigured node, or an operator's guess; the new one converts each of those into a hard stop. That is the point, but it is also the price.`,
  (c: Ctx) =>
    `The honest downside is operational humility: when ${c.tool} fails now, it fails in a way that must be understood, not toggled away. Teams that relied on toggles as strategy have had to develop actual strategy.`,
  () =>
    `Portability took the largest cut. The implementation assumes a modern platform and refuses to simulate the old one, which is a polite way of saying some deployments are unsupported rather than slow.`,
  () =>
    `None of this is free at review time: diffs are smaller but denser, and the reviewer's job shifts from spotting bugs to questioning assumptions. That shift is the adoption barrier, and it is a human one.`,
];

const CLOSERS = [
  () =>
    `The open questions are the honest kind — ones with measurable answers on a calendar. Whether the guarantees hold at ten times the current scale will be known within the year, and the design leaves room to be wrong in public.`,
  (c: Ctx) =>
    `What sticks after reading is not a technique but a standard: every convenience must name the failure it prevents, or it does not ship. Applied beyond ${c.subj}, that standard alone would clear a surprising amount of modern complexity.`,
  () =>
    `The counterargument has merit: simpler systems have promised this before and paid for it at the edge cases. The difference here is that the edge cases are enumerated, versioned, and tested, which turns a promise into a contract.`,
  (c: Ctx) =>
    `The reasonable summary is that the boring parts got boring on purpose. What remains interesting is the seam — where the system meets the world's messiness — and the discussion of it in ${c.venue} is worth following even if you never deploy a line of it.`,
  () =>
    `Skepticism remains healthy, and the author shares it: the pattern of small tools growing config surfaces they once mocked is well documented. For now the discipline holds, and the discipline is the part worth stealing.`,
  () =>
    `The closing recommendation is characteristically unglamorous: try it on the least important system you run, keep the exit path written down, and judge it by the pages it does not generate. Adoption stories that start this way tend to end well.`,
  (c: Ctx) =>
    `As for the future, the roadmap is short, which is itself a signal: two fixes, one standardization, and a standing refusal to add a mode. The thread in ${c.venue} ends with the sentence every project should be able to write: this is done on purpose.`,
];

interface Ctx {
  title: string;
  subj: string;
  who: string;
  stat: string;
  tool: string;
  venue: string;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Composed mock body: seeded per item id, so re-runs and edits elsewhere
 *  never reshuffle it. Six paragraphs, each from a distinct pool entry. */
function mockBody(entry: DemoEntry): string {
  const rand = seedFrom(`${EDITION_DATE}:${entry.id}`);
  const [who] = picks(WHO, 1, rand);
  const [stat] = picks(STAT, 1, rand);
  const [tool] = picks(TOOL, 1, rand);
  const [venue] = picks(VENUE, 1, rand);
  const ctx: Ctx = { title: entry.title, subj: entry.subj, who, stat, tool, venue };
  const [opener] = picks(OPENERS, 1, rand);
  const [mech1, mech2] = picks(MECHANISM, 2, rand);
  const [evidence1, evidence2] = picks(EVIDENCE, 2, rand);
  const [tradeoff] = picks(TRADEOFF, 1, rand);
  const [close] = picks(CLOSERS, 1, rand);
  return [opener, mech1, evidence1, mech2, tradeoff, evidence2, close]
    .map((f) => f(ctx))
    .join("\n\n");
}

/* ------------------------------------------------------------------ main -- */

function toItem(entry: DemoEntry, sectionIndex: number): Omit<EditionItem, "tier"> {
  const item: Omit<EditionItem, "tier"> = {
    id: entry.id,
    section: entry.section,
    // first item of each section is that section's deep-read lead; captures
    // are always kind=captured
    kind: entry.section === "captured" ? "captured" : sectionIndex === 0 ? "deep-read" : "brief",
    title: entry.title,
    url: `https://example.com/${entry.slug}`,
    source: entry.source,
    brief: entry.brief,
    has_reader: true,
  };
  // Reader quality gate (card t_b3782402): a digest example ships in digest
  // mode — thin crafted text + digest on the reader entry.
  if (entry.digest) item.reader_mode = "digest";
  if (entry.section === "captured") {
    // deterministic, varied capture times across Oct 24–25
    const minuteSpread = ((sectionIndex * 731) % 1900) * 60_000; // ~31h of spread
    item.captured_at = new Date(CAPTURED_AT_BASE + minuteSpread).toISOString();
  }
  return item;
}

// draft items are tierless by construction; assignTiers (the domain's only
// writer of tiers — same call the real builder makes) reads only `section`
// and returns new items with the tier filled in.
const items = assignTiers(
  ALL_ENTRIES.map((entry) => {
    const sectionIndex = SECTION_ENTRIES[entry.section].indexOf(entry);
    return toItem(entry, sectionIndex);
  }) as EditionItem[],
);
if (items.length !== 56) throw new Error(`expected 56 demo items, got ${items.length}`);

const edition = { edition_date: EDITION_DATE, items };
// indent 2 + trailing newline = exactly what oxfmt normalizes JSON to, so the
// committed fixtures stay clean under `npm run check` AND byte-stable under
// regeneration
writeFileSync(
  new URL("../data/demo/edition.json", import.meta.url),
  JSON.stringify(edition, null, 2) + "\n",
);

const articles = Object.fromEntries(
  items.map((i) => {
    const entry = ALL_ENTRIES.find((e) => e.id === i.id)!;
    return [
      i.id,
      {
        url: i.url,
        text: entry.crafted ?? mockBody(entry),
        ...(entry.digest ? { digest: entry.digest } : {}),
      },
    ];
  }),
);
writeFileSync(
  new URL("../data/demo/reader-articles.json", import.meta.url),
  JSON.stringify({ edition_date: EDITION_DATE, articles }, null, 2) + "\n",
);

const tierCounts = items.reduce<Record<string, number>>((a, i) => {
  a[i.tier] = (a[i.tier] ?? 0) + 1;
  return a;
}, {});
console.log(
  `wrote data/demo/edition.json (${items.length} items, tiers: ${JSON.stringify(tierCounts)}) ` +
    `+ reader-articles.json (${Object.keys(articles).length} articles) for ${EDITION_DATE}`,
);
