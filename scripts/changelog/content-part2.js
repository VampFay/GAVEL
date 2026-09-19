// GAVEL English Change Log — content sections 6–11
// All facts sourced from worklog.md (Tasks 6–10), git history, and verified session records.

const sections = [
  {
    h1: "6. Verification, QA, and Release Packaging",
    blocks: [
      { h2: "6.1 Static Verification and Live UI QA" },
      { p: "Task six, run and test and finalize all, closed the engagement's verification obligations in two layers. The static layer ran ESLint with zero errors (with 59 pre-existing warnings documented and left for triage), the TypeScript compiler clean, the vitest suite at 144 of 144, and a production build green. Nothing in this layer was new debt; it confirmed the baseline established by the audit task." },
      { p: "The live layer drove the running application in a real browser through its golden paths and passed 21 of 21 assertions. Coverage included landing scroll reveals and rule-ink lines, login into the app shell, dashboard entrances, tabs-ink underlines, confidence-meter slivers, and the approve and dismiss verdict flows, each of which walks a two-step confirmation dialog, mounts the overlay, slams the stamp, and unmounts after about 1.15 seconds, with screenshots captured mid-flash. Finding-detail timeline draws and ink-fill pillars, the audits four-segment ink-fill bars, the monitoring heartbeat, the theme flip, and the mobile drawer in and out were also asserted, with zero page errors throughout." },
      { p: "The QA was cross-checked against server truth rather than the DOM alone: pending counts in the review queue were observed draining as rulings were issued, and the audit log was observed growing per ruling. Engineering the harness itself produced three durable lessons: snapshot references print as eNN tokens but clicks must target the eNN form directly, stale references made eval-driven clicks more reliable than reference greps, and flash windows needed a poll-trigger-observe pattern to catch sub-two-second animation states. The consolidated, re-runnable harness was committed as scripts/live-ui-test.sh (commit 43fdc42), and eleven QA screenshots were preserved as gavel-final-01 through 11." },
      { h2: "6.2 Release Package and Sandbox Run" },
      { p: "Task seven compiled everything into a portable deliverable and proved the application runs in the sandbox. The package, download/GAVEL-release.zip, contains twenty-five files totaling roughly 11.8 MB: a git bundle carrying the complete history, twenty-two QA screenshots (the twenty-one motion-system proofs plus one sandbox-run proof), the worklog itself, and a README manifest with restore steps, demo credentials, push instructions, and verification status. The release manifest was committed as 1980f28." },
      { p: "Assembling the package required mapping the sandbox topology, which had until then been implicit: the Caddy gateway on port 81 proxies to the application on port 3000; supervisor services owned by root survive between tool calls; and processes started by the user account are reaped at call end, so the preview is served by the platform's auto-managed dev server rather than by anything a tool call starts. The user path was then verified live through the gateway itself, port 81 rather than the direct port, confirming the page title, the landing render, and zero console errors, with the proof captured as gavel-final-12-sandbox-run.png. The session's own dev-server instance was deliberately torn down afterward to hand port 3000 to the platform's managed run." },
    ],
  },
  {
    h1: "7. Sandbox Operations: Outage and Revival",
    blocks: [
      { h2: "7.1 Diagnosis of the Preview Outage" },
      { p: "The eighth task responded to the report that the sandbox was not running properly. The symptom was a 502 on the preview. Diagnosis established the topology precisely: the gateway on port 81 (root-owned Caddy, running since container boot) forwards to the application on port 3000, and the platform's boot chain starts the dev server through the package's bun flow inside the platform's own process tree, which is immune to the per-tool-call reaping of user processes. That boot server had been running from 13:35 to 14:15 before it was killed, and nothing in the environment restarts it once dead. The kill came from the QA teardown commands, whose pkill patterns matched the platform server as collateral damage." },
      { p: "A controlled experiment proved the mechanism beyond argument: every user-account process spawned inside a tool call died at the end of that call, whether launched with setsid, backgrounded, or otherwise detached, while the platform and root tree survived. The fix had two parts. First, .zscripts/dev.sh was created as the platform's sanctioned custom dev flow: the boot script prefers it, it runs in the platform's tree at container boot, and it carries an idempotent port guard plus install and database guards before executing the dev server in the foreground. It was deliberately left out of git tracking as runtime infrastructure rather than product code, surviving through the repository archive instead. Second, the QA harness teardown was rewritten so it reuses a running platform server when one exists, spawns its own server without setsid so it remains a descendant, and kills only its own process tree via a descendant walk (commit a7ce2f5)." },
      { p: "The task closed with history maintenance: platform runtime auto-commits, which carry UUID subjects and snapshot scratch scripts, were cleaned out with a rebase, the git bundle and release zip were rebuilt, and port 3000 was left free and clean for the platform's next managed start. No application code changed in this task." },
      { h2: "7.2 Structural Fix and Server Revival" },
      { p: "The ninth task handled a second outage and institutionalized the recovery. The gateway on port 81 was alive (root Caddy, up since container boot), while the application on port 3000 was dead, returning no response at all, which again produced a 502 on the preview. The boot-time server had been killed earlier, and nothing short of a container reboot would restart it through the boot chain." },
      { p: "The breakthrough was identifying the platform's own sanctioned mid-session revival mechanism. The platform's initialization script launches the dev flow through an ephemeral subshell with nohup, so the daemon re-parents to PID 1 before the tool call returns; that is the only spawn pattern that escapes the per-tool-call descendant reaper. This also explained why the earlier setsid experiment had failed: processes launched that way remained descendants of the tool-call shell and were reaped with it. The server was revived using exactly the platform's pattern: it came healthy in roughly four seconds on the warm build cache, ran as PID 12602 with parent PID 1, and was verified alive across subsequent tool calls." },
      { p: "The golden path was then verified end to end through the gateway: the landing page rendered with the correct title and hero headline ('We found money you already earned.'), login as admin@gavel.demo succeeded, and the dashboard showed live Prisma data, one audited client and ₹8.84 L of unbilled time identified. Zero page errors were recorded, and the dev log was clean apart from the documented dev-mode JWT fallback warning. Proof screenshots were saved as gavel-sandbox-revived-01 and 02." },
      { p: "Finally, the recovery was institutionalized so it never requires archaeology again. scripts/revive-dev.sh (commit e7fab1e) performs the one-command revival using the PID-1 re-parent pattern, is reuse-guarded, and never kills a running server. The .zscripts/dev.sh header now documents all three invocation paths: platform boot, mid-session platform initialization, and the revival script. The preview is therefore live end to end, with the server lifecycle covered at both cold boot and mid-session." },
    ],
  },
  {
    h1: "8. Event Research and Architecture Audit",
    blocks: [
      { h2: "8.1 Multi-Source Event Reconstruction" },
      { p: "The tenth task combined two inputs: the instruction to thoroughly go through Apple's September 9, 2026 live event (the YouTube live stream), and the internalization of a 777-line architect audit of GAVEL that scored the project 7.9 out of 10. Direct video access was blocked: YouTube and Google served bot-checks to the sandbox IP on the watch page, yt-dlp failed across all client types, and the headless browser was redirected to Google's sorry page. The work pivoted to a multi-source live-blog reconstruction." },
      { p: "Sources were fetched directly, without cache, and cross-verified against each other: the CNET live blog, the MacRumors live blog and its September 2026 event guide, Macworld's live blog, the 9to5Mac news hub and announcement articles, CreativeBloq, Tom's Guide, Apple's own events page (which records a 44 minute 44 second runtime), and the video's oEmbed metadata. The reconstruction: John Ternus's first event as CEO following the Cook handoff, framed around an intelligent personal hub thesis with privacy positioned as a weapon; the iPhone 18 Pro and Pro Max, with the A20 Pro chip on a 2nm process, a second 32-core Neural Engine, a tripled vapor chamber, a 48MP variable-aperture main camera with six laser-cut blades, and Apple Reference Image pixel-level photo authenticity signing, priced at $1,199 and $1,299 with pre-orders on September 12 and availability on September 18; and AirPods 5 in two models at $129 and $149 with 50 percent better active noise cancellation." },
      { p: "The key finding was verified three ways and is worth stating plainly: the iPhone Duo foldable, the Watch Series 12, the Ultra 4, the HomePad, and a new Apple TV were not announced at this event. Apple held them back. The three verifications: no post-event articles for those products existed on MacRumors or 9to5Mac as of September 10 direct fetches; the live blogs all ended by 10:35 AM PDT with no further entries; and the 44:44 runtime corroborates a shorter, more focused show. The full digest with sources was persisted as download/apple-event-2026-research-digest.md." },
      { h2: "8.2 Architecture Audit: Claims Against Code" },
      { p: "The architect audit's claims were then verified against the actual codebase rather than taken on faith, and they held up. The Tenant model exists, but none of the nineteen business models carry a tenant identifier, which confirms a cross-tenant data bleed risk. The rate limiter is in-memory, so limits reset on restart and are not shared across instances. The client layer follows a pseudo-SPA pattern through the Zustand store. The SQLite schema runs 466 lines across 21 models. And the LLM extraction runs synchronously inside HTTP routes, holding request workers while it completes." },
      { p: "The synthesis delivered at the close of this task was a phased implementation plan, Phases A through F, described in section 11. One deliberate deviation from the audit is recorded: the plan is sandbox-constrained, keeping SQLite as the engine of record and staying PostgreSQL-ready, rather than adopting the audit's recommended PostgreSQL, Redis, and BullMQ stack wholesale. The reasoning is sequencing: the data-model and process-boundary fixes deliver the audit's value without a forced infrastructure migration that the current deployment topology cannot yet honor." },
    ],
  },
  {
    h1: "9. Commit History",
    blocks: [
      { p: "The table below is the complete commit history of main, twenty-five commits, all currently authored by VampFay. Two maintenance operations rewrote hashes without changing content: the task 3 author rewrite verified each tree byte-identical before the force-push, and the task 8 rebase removed platform runtime auto-commits from the public line. Rows whose subject is a bare UUID are platform runtime snapshots, machine-generated commits that sweep scratch files into the repository between sessions; they are attributed to the pinned git identity but were not hand-authored. Commits from f55bea8 upward correspond to the engagement's tracked tasks (sections 3 through 8); the rows below it are the earlier development phases described in section 2." },
      { tableTitle: "Table 1: Complete commit history of main (oldest first)" },
      { table: {
        headers: ["Commit", "Date", "Subject"],
        widths: [14, 12, 74],
        rows: [
          ["02c755e", "Aug 25", "Initial commit"],
          ["078293b", "Aug 25", "2cb0e719-f65a-4625-af3c-254a1def4c8e (platform snapshot)"],
          ["a7a43d3", "Aug 26", "2cb06673-dbaa-4a39-9c05-c6429ea5d701 (platform snapshot)"],
          ["d7689bc", "Aug 26", "b81c1220-ecb4-4ae6-8c0f-e0e0b50c0af8 (platform snapshot)"],
          ["91cd7e5", "Aug 26", "6247af88-4afc-4c1d-86d8-c25390d96f32 (platform snapshot)"],
          ["0cee684", "Aug 28", "0d8d78fa-c648-4ef3-9673-efbf451be08c (platform snapshot)"],
          ["6676bbc", "Aug 28", "chore: strip sandbox infra from git tracking for clean exports"],
          ["5eb56fc", "Aug 28", "fix: harden fresh-clone bootstrap discovered during export review"],
          ["e5d742b", "Aug 28", "fix: realness sweep — 19 defects found by full-UI/API audit, all fixed"],
          ["fcdc3fb", "Sep 09", "audit: full live re-run — remove last scaffold route, add re-runnable live-audit harness (78/78 green)"],
          ["e39c0cb", "Sep 09", "refactor: UI-UX case-file workbench redesign; fix latent review-queue crash"],
          ["93d3b44", "Sep 09", "feat: human layer — verdict stamps, ledger figures, paper grain; reduced-motion safe; zero new deps"],
          ["f55bea8", "Sep 09", "rename: ShipLedger → GAVEL (brand, code, paths, cookies, headers, env vars)"],
          ["c527c45", "Sep 09", "polish: brand identity + real-money hardening — zero placeholders"],
          ["fc0b5f0", "Sep 09", "docs: real README; ops: push-github.sh one-shot remote script"],
          ["ce2bd89", "Sep 09", "fix: push-github.sh FORCE mode actually passes --force"],
          ["6dd9648", "Sep 09", "chore: render-og as ESM (.mjs) — node: imports, __dirname shim"],
          ["9b62f0d", "Sep 09", "fix: push-github.sh — x-access-token auth form (non-interactive)"],
          ["0f8e592", "Sep 09", "audit: final release-readiness pass — CO-suppression fix, prune deps, close doc drift"],
          ["107c584", "Sep 09", "feat: motion system v2 — the case file comes alive"],
          ["43fdc42", "Sep 09", "ops: re-runnable live UI QA harness — 21/21 green end-to-end"],
          ["a7ce2f5", "Sep 09", "fix(qa): harness teardown never pkills the platform-managed dev server"],
          ["1980f28", "Sep 09", "ops: release package manifest — contents/restore/push notes"],
          ["e7fab1e", "Sep 09", "ops: one-command dev-server revival — PID-1 re-parent pattern"],
          ["f9c7a43", "Sep 09", "fa7f3736-2f3d-4c40-bdf2-e5bb1c5e1635 (platform snapshot, 53 research files)"],
        ],
      } },
      { p: "The subjects above are lightly compressed from the exact git subjects where they were long; the hashes and dates are exact. Commits 107c584, 43fdc42, a7ce2f5, 1980f28, e7fab1e, and the trailing platform snapshot are, to the best local knowledge, not yet on the GitHub remote: the last confirmed push ended at the release-readiness audit, and the exact remote position cannot be re-verified from inside the sandbox until a fresh access token is configured, as section 11 records." },
    ],
  },
  {
    h1: "10. Deliverables Inventory",
    blocks: [
      { p: "Everything produced by the engagement that is meant to leave the sandbox is inventoried below. The release zip is the single portable artifact: a fresh environment can be stood up from it alone, since it carries the full git history in bundle form, the complete QA evidence set, and a manifest that documents restore steps, credentials, and the verification status at packaging time." },
      { tableTitle: "Table 2: Deliverables produced by the engagement" },
      { table: {
        headers: ["Artifact", "Contents", "Location"],
        widths: [24, 50, 26],
        rows: [
          ["GAVEL-release.zip", "25 files, about 11.8 MB: git bundle with complete history, 22 QA screenshots, worklog, README manifest with restore steps, demo credentials, and push instructions", "download/GAVEL-release.zip"],
          ["Git bundle", "Complete repository history in single-file bundle form, used to rebuild the zip after the history cleanup", "download/gavel.bundle"],
          ["QA screenshots", "22 proofs: motion-system behaviors, verdict flash mid-frame, sandbox run, and post-revival golden path", "download/gavel-*.png"],
          ["Event research digest", "Apple September 2026 event reconstruction with sources and the held-back products finding", "download/apple-event-2026-research-digest.md"],
          ["Source repository", "main at f9c7a43, 25 commits, clean working tree", "/home/z/my-project (git)"],
        ],
      } },
      { p: "The QA screenshot families are named for their tasks: gavel-motion-* captures the motion system during task 5, gavel-final-01 through 12 capture the 21-assertion live QA plus the sandbox-run proof from tasks 6 and 7, and gavel-sandbox-revived-01 and 02 capture the post-revival golden path from task 9. Together they form a visual regression baseline: any future change to a motion behavior can be compared against the exact frames recorded here." },
    ],
  },
  {
    h1: "11. Current State and Pending Actions",
    blocks: [
      { h2: "11.1 Current State" },
      { p: "The local repository stands at main f9c7a43 with a clean working tree; the worklog and the download artifacts are deliberately untracked. The sandbox preview is live end to end through the gateway, with landing, login, and the dashboard verified in-browser against live Prisma data. The server lifecycle is covered on both paths: cold boot through the platform's start chain, and mid-session revival through scripts/revive-dev.sh. The verification baseline held at the close of the engagement is ESLint zero errors, clean type checking, 144 of 144 tests, a green production build, and 21 of 21 live QA assertions. The GitHub remote is behind the local branch; the precise distance is unverifiable from inside the sandbox because the access token was revoked-by-policy, so it must be confirmed with a fetch once a fresh token is configured." },
      { h2: "11.2 Pending Actions" },
      { p: "Five actions are open, ordered by dependency rather than by effort. The first two belong to the repository owner; the remaining three are engineering work that the phased plan sequences." },
      { numbered: { ref: "pending-actions", items: [
        "Revoke the GitHub personal access token that was passed through chat. It traveled through a conversation and must be treated as exposed by design, regardless of whether it was ever used by a third party.",
        "Create a fresh token with Contents read/write, Workflows read/write, and Metadata read-only scopes, export it as GAVEL_GH_TOKEN, and run scripts/push-github.sh to publish the unpushed commits. Confirm the remote position with a fetch first, since the local remote-tracking ref is stale.",
        "Decide on history hygiene before the push: the trailing platform snapshot committed 53 research scratch files (roughly 17,000 lines) under scripts/. The task 8 precedent applies, a rebase to drop the snapshot followed by rebuilding the bundle and the release zip, if a tidy public history is wanted.",
        "Execute the phased hardening roadmap, Phases A through F, in order, holding the 21-of-21 live QA baseline after each phase.",
        "Run bash scripts/live-ui-test.sh after each phase and use scripts/revive-dev.sh whenever the preview returns a 502, so operational incidents are resolved by runbook rather than by diagnosis.",
      ] } },
      { tableTitle: "Table 3: Phased hardening roadmap synthesized from the audit" },
      { table: {
        headers: ["Phase", "Focus", "Grounding"],
        widths: [10, 44, 46],
        rows: [
          ["A", "Data tenancy: tenant identifiers on the business models", "The audit's confirmed finding: 19 business models lack a tenant field, leaving a cross-tenant bleed risk"],
          ["B", "Tenant-scoped routing and middleware", "Follows directly from Phase A: requests and data access bound to one tenant's scope"],
          ["C", "Engine rule hardening", "The documented engine limitation: keyword-overlap matching rather than semantic extraction"],
          ["D", "Asynchronous extraction", "The verified finding: LLM extraction runs synchronously inside HTTP routes"],
          ["E", "Document ingestion", "Extends the case-file model: structured intake for source documents feeding findings"],
          ["F", "Provenance, export, and polish", "Closing the loop: authenticity records for evidence, exportable case files, final product polish"],
        ],
      } },
      { h2: "11.3 Operational Notes" },
      { p: "The development environment keeps three demo accounts, active only in development builds: admin@gavel.demo with the password gavel-admin-demo, plus reviewer and viewer accounts with their own credentials recorded in the release manifest. The database can be reset to a known state with bun run db:push followed by bun run seed:dev, which is the supported path back to the demo dataset after experiments. The full live QA pass runs as a single command, bash scripts/live-ui-test.sh, which now reuses a running server when one is up and never harms the platform-managed one. These notes, together with the revival script and the QA harness, form the operational runbook for anyone taking the project forward from this record." },
    ],
  },
];

module.exports = { sections };
