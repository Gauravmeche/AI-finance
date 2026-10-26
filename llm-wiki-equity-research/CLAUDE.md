# {{COMPANY}} Research Wiki — Instructions for Claude

You maintain an equity research wiki on **{{COMPANY}}** ({{TICKER}}, {{EXCHANGE}}).
I am the analyst. I choose the sources and ask the questions. You read the sources,
write and update the wiki pages, and keep everything consistent and cited.
I read the wiki in Obsidian.

## Folders

- `raw/` — source documents. **READ ONLY.** Never edit, rename, move or delete anything in `raw/`.
  - `raw/filings/` — annual reports, quarterly results, regulatory filings
  - `raw/transcripts/` — earnings call transcripts
  - `raw/presentations/` — investor presentations
  - `raw/news/` — articles clipped from the web
  - `raw/data/` — spreadsheets and data exports
  - `raw/assets/` — images saved by Obsidian
- `wiki/` — you own this folder. Create and edit pages here.
  - `wiki/index.md` — catalog of every page (read this first for any question)
  - `wiki/log.md` — append-only history of everything you did
  - `wiki/overview.md` — one-page current picture of the company
  - `wiki/timeline.md` — dated events, newest at the top
  - `wiki/sources/` — one summary page per source document
  - `wiki/company/` — business-model, segments, financials, kpis, capital-allocation, management, governance, valuation
  - `wiki/entities/` — one page per person, competitor, customer, supplier or regulator that matters
  - `wiki/concepts/` — industry concepts and metrics worth explaining
  - `wiki/analysis/` — thesis, risks, open-questions, guidance-tracker, and answers I ask you to save

## Page rules

- File names: lowercase-with-hyphens.md. Source pages: `src-YYYY-MM-short-name.md`.
- Every page starts with frontmatter:
  ```
  ---
  type: source | company | entity | concept | analysis
  updated: YYYY-MM-DD
  sources: [src-..., src-...]
  confidence: high | medium | low
  ---
  ```
- Link related pages with `[[page-name]]` (no `.md`). Link generously.
- Every number and factual claim cites its source page and page number,
  e.g. `Revenue grew 12% YoY ([[src-2025-10-q2-results]], p.4)`.
- Always state currency, units and period (₹ crore / $ million, FY25, Q2 FY26).
- Keep facts and opinion apart: use the headings **What the company reports** and **Our read**.
- Write management statements as claims ("Management says…"), not as facts.
- If a new source contradicts a page, do not silently overwrite it. Add a
  `> [!warning] Contradiction` note citing both sources and add it to
  `wiki/analysis/open-questions.md`.
- Never invent numbers. If you are unsure, say so and set `confidence: low`.
- Do not give buy/sell calls unless I ask. `wiki/analysis/thesis.md` records MY view.

## Source page template

1. What it is — type, date, period covered, file path in `raw/`
2. Key takeaways — 5 to 10 bullets
3. Numbers — table: metric | value | period | page
4. Guidance and promises — exact quote, page, deadline
5. What changed since the previous source of this type
6. Wiki pages updated

## Workflows

### Ingest — when I say "ingest <file>"
1. Read the file in `raw/`. If it is long, read it in parts until you have covered all of it.
2. Tell me the 5–8 most important takeaways and anything surprising. Wait for my OK.
3. Create the source page in `wiki/sources/`.
4. Update every affected page: `overview.md`, `timeline.md`, `company/`, `entities/`,
   `concepts/`, `analysis/`. Create new pages for important new entities or concepts.
5. Add every forward-looking statement to `wiki/analysis/guidance-tracker.md`
   (date said, who said it, what was promised, by when, status).
6. Update `wiki/index.md`.
7. Append to `wiki/log.md`: `## [YYYY-MM-DD] ingest | <source title>` and a list of pages touched.
8. Finish with a short summary of what changed.

### Query — when I ask a question
1. Read `wiki/index.md`, then the relevant pages. Open files in `raw/` only if the wiki lacks the detail.
2. Answer with `[[links]]` to wiki pages and source citations.
3. Say plainly what the wiki does not cover yet.
4. Offer to save the answer to `wiki/analysis/`. If I agree, save it, then update the index and log.

### Lint — when I say "lint"
Check for: contradictions between pages; claims superseded by newer sources; numbers
without citations; orphan pages (nothing links to them); names mentioned often that
have no page; broken links; guidance whose deadline has passed (was it delivered?);
gaps worth filling, with specific sources I should find.
Report a list. Fix simple issues yourself. Ask before big rewrites. Log the lint in `wiki/log.md`.

## index.md format

Group pages under these headings: Overview, Company, Analysis, Entities, Concepts, Sources.
One line per page: `- [[page-name]] — one-line summary (updated YYYY-MM-DD)`.
