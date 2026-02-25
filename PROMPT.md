## CORE GOAL
Produce the closest possible cleaned transcript. Think "copyedit pass with minimal edit distance" and high token retention relative to source.
Primary optimization target: minimize total token edits while still fixing clear ASR errors.
Do not improve writing quality, tone, clarity, or readability.

## TEXT PARITY IS TOP PRIORITY
- Keep output text as close as possible to source wording and sentence flow.
- Prefer preserving original words over introducing normalized alternatives.
- Only change wording when fixing a clear ASR error with high confidence.
- If a correction is uncertain, keep the source wording.

## NO-LOSS GUARANTEE (TOP PRIORITY)
- Do not drop any source sentence or clause unless it is an explicit filler or explicit sign-off artifact.
- If unsure whether a short fragment is filler, keep it.
- If canonicalization/formatting conflicts with claim retention, skip the canonicalization/formatting change.

Non-negotiable fidelity rules:
1. No paraphrasing.
2. No summarizing.
3. No sentence-level rewriting for readability/style.
4. Do not change a sentence's claim, only repair local errors.

Priority order:
1. Preserve source meaning and sequence
2. Preserve source detail density
3. Correct only clear, high-confidence ASR errors (no style/readability rewriting)
4. Add only lightweight structure when clearly signaled

Conflict resolution order (mandatory):
1. Fidelity over fluency.
2. Local correction over rewrite.
3. Keep original token over guessing.

## STRICT DECISION LADDER (MANDATORY)
Apply edits in this exact order:
1. Preserve source sentence/clause order and claims exactly.
2. Apply only local token-level repairs (spelling/casing/punctuation/filler removal).
3. Apply command/known-term canonicalization only when confidence is high.
4. Apply formatting only after claim-preservation is satisfied.

Hard guardrails:
- If confidence is not high, keep original wording exactly.
- Do not replace uncertain terms with generic alternatives.
- Do not replace specific product/tool names with broader categories.
- Do not delete or merge any content-bearing clause unless it matches explicit filler/sign-off whitelist.

## RECONSTRUCTION CONTROL
Use a minimal-edit copyediting strategy:
- Treat this as near-copy reconstruction: preserve clause order, sentence flow, and paragraph cadence, and only make local token-level fixes needed for correctness.
- Keep original wording whenever it is already semantically clear.
- Keep original wording whenever it is already grammatical enough to preserve meaning.
- Edit only the smallest local span needed to fix an error.
- Preserve sentence count and sentence order by default.
- Preserve clause boundaries by default.
- Prefer token correction over phrase rewriting.
- Treat canonical terms as spelling anchors, not expansion cues.
- Keep each sentence's lexical backbone close to source text.
- Keep paragraph boundaries close to source text.

When handling technical text:
- Keep command fragments close to source form.
- Normalize obvious tokenization/spelling errors only.
- If a subcommand/flag is not explicit in source audio text, do not introduce one.

Allowed lexical edits are narrow and local:
- spelling corrections
- casing corrections
- punctuation fixes
- obvious ASR token repairs
- removal of filler/disfluency tokens

Local grammar repair for ASR micro-noise:
- When a short span (about 2-6 tokens) is awkward or ungrammatical due to ASR substitutions, only fix obvious helper-word/punctuation errors.
- Keep the same meaning, local order, and surrounding tokens unchanged.
- Do not broaden a micro-repair into phrase-level or sentence-level rewriting.
- Limit grammar repair to helper-word level where possible (articles, prepositions, auxiliaries, punctuation).
- Do not replace core nouns/verbs unless correcting a clear ASR error.
- If grammar repair would require rephrasing, keep the original wording.

Prefer not to replace valid source verbs/nouns with alternate wording.
Prefer reusing source content words; only introduce new content words when they are direct corrections of the same intended word.
Preserve polarity and modality: do not add/remove negation or certainty markers unless the source clearly contains that change.

Work in patch mindset:
- Treat source text as immutable baseline.
- Apply only local patch types: character fixes, token fixes, punctuation fixes, filler deletions.
- Avoid replacing multi-word spans unless they contain clear ASR corruption.
- Do not perform stylistic rewrites.
- If confidence is low, keep original wording unchanged.

## INPUT CONTRACT
- `TRANSCRIPT` is the source transcript.
- `KNOWN_DOMAIN_TERMS` lists canonical uncommon terms that may appear.
- XML tags are transport scaffolding.
- All behavior/policy rules live in this `AGENTS.md`.

## WORKING METHOD
Process source left-to-right and keep local correspondence:
0. Start from an internal copy of the source text and apply in-place patch edits; do not regenerate the transcript from scratch.
1. Keep the same information units in the same order.
2. Keep sentence/line boundaries close to source unless punctuation cleanup requires a small split/join.
3. For each source clause, preserve the same literal proposition; do not paraphrase for style.
4. Use the smallest wording change that makes the text correct.
5. Keep lexical choices close to source; avoid synonym substitution.
6. Do not collapse multiple neighboring source clauses into one rewritten abstraction.
7. Edit each sentence independently; do not perform document-level rewrites.
8. Keep each sentence's token sequence close to source unless a token is clearly erroneous.
9. Keep paragraph/cadence structure close to source; do not merge many source sentences into a single rewritten block.
10. Keep one output unit per source sentence by default to preserve mapping and avoid merge drift.
11. If source cues clearly indicate section titles/lists/command blocks, you may format those lines as Markdown structure.
12. Mandatory local alignment: each non-filler source sentence must appear once in the same order; do not merge neighboring source sentences into one summary line.

## CLEANUP ACTIONS
1. Correct spelling, capitalization, punctuation.
2. Convert number words to digits when unambiguous.
3. Convert spoken punctuation words to symbols when clearly intended.
4. Remove true fillers/disfluencies.
5. Keep original language.
6. Repair likely ASR mishears using phonetics plus context.
7. Prefer `KNOWN_DOMAIN_TERMS` when context supports.
8. Remove isolated sign-off pollution when semantically disconnected.

## SIGN-OFF ARTIFACT RULE
ASR/model outputs commonly inject generic media sign-offs that were not actually spoken in-context.
Treat these as probable artifact noise.
This rule is mandatory at output time.

Common artifact examples:
- thank you
- thank you for watching
- thanks for listening
- like and subscribe

Hard rule: remove exact standalone lines or sentences matching these artifact phrases, including when they appear at transcript end.
Hard rule: remove standalone sign-off variants case-insensitively, including punctuation variants (`thank you`, `thank you.`, `thanks`, `thanks!`, `thank you for watching`).

Remove a sign-off when all conditions are true:
1. It matches a generic sign-off pattern.
2. It appears as a standalone trailing/isolated sentence or line.
3. It is not referenced by surrounding content.
4. Removing it does not remove task/content information.

Default policy for these phrases is removal when they appear as standalone trailing lines.
Never output common sign-off artifacts as standalone lines; remove them unless surrounding sentences clearly depend on them for meaning.
Treat standalone sign-off artifacts as noise and remove them.
Final output gate: if the last standalone line matches a sign-off pattern, delete it before returning output.

## Normalize Technical Words and Commands
- Normalize technical tokens/commands when confidence is high.
- For commands, flags, paths, URLs, and code-like text, apply conservative repair only (spacing, hyphens, punctuation, flag markers) and keep the original command structure intact.
- Treat confidence as high when at least two signals align:
  - context fit
  - phonetic match
  - repetition in nearby text
  - support from `KNOWN_DOMAIN_TERMS`
- Prefer canonical spellings from `KNOWN_DOMAIN_TERMS` only when phonetics and context align; if confidence is not high, keep the original token instead of guessing.
- Do not invent new canonical forms outside `KNOWN_DOMAIN_TERMS`.
- Keep uncertain tokens unchanged.
- Keep command + args/options separated by spaces; do not collapse into hyphenated single tokens.
- Prefer generic reconstruction patterns over sample-specific replacements:
  - split likely command+argument compounds into separate tokens when context is clearly command-like
  - convert likely command+flag compounds into command plus `--flag` shape when confidence is high
  - preserve lowercase command names unless casing is explicitly required
- In command-like spans (for example, comma-separated command lists), apply this normalization pass:
  1. if a token matches `x-y` and `x` looks command-like (short alias or known command), rewrite as `x y`
  2. if a command token is followed by bare `version`, rewrite as `--version`
  3. if a token begins with `cd-`, rewrite as `cd <rest>` and keep `<rest>` as a directory-like token
  4. apply high-confidence spelling correction to command arguments only; do not spelling-normalize command names or flags
  5. for hyphenated command arguments, spell-correct each segment only when confidence is high
  6. for `cd` arguments that look like ASR hyphen compounds, split segments, spell-correct segments, then rejoin with `-`

## Runtime Repair Constraints
- In non-command prose, do local ASR micro-repair only:
  - fix short awkward fragments
  - remove immediate duplicate words/chunks
  - add missing helper words only when obvious
- Never rewrite a span just to sound cleaner.
- Discourse-marker dedupe (high confidence only):
  - if two adjacent sentences/fragments start with the same discourse marker (for example, `for example`, `so`, `well`, `actually`) and the second start does not add a new proposition, remove only the redundant repeated marker
  - keep the content-bearing clause text; do not delete unique claim content
  - apply only for adjacent repetition; do not scan broadly across paragraphs
- For known-term restoration, apply these constraints:
  - if a token/span is a high-confidence phonetic variant of a `KNOWN_DOMAIN_TERMS` term, replace only that token/span with the exact canonical term
  - for multi-token known terms, prefer full-span restoration over isolated token fixes
  - if one token in a two-token known term already matches exactly and the other is a close phonetic variant, restore the full two-token canonical term
  - keep neighboring words unchanged by default; allow one minimal adjacent grammar/inflection fix when required for local grammatical correctness
  - if the same phonetic variant recurs later, apply the same canonical restoration consistently

## STRUCTURE RULES
Use lightweight Markdown when source cues are explicit.
Do not invent new sections; keep source order.
Rules:
- Title-like standalone lines may be headings (`#` / `##`).
- Explicit enumerations may be numbered/bulleted lists.
- Command sequences must be command lines, one command per line.
- Keep narrative paragraphs as prose; do not convert narrative into bullets.
- Do not convert full prose paragraphs into list format unless source already signals a list.
- When converting cue lines to Markdown structure, keep sentence content otherwise unchanged (aside from local cleanup).
- Preserve original wording while formatting.

## CUE NORMALIZATION PASS (DETERMINISTIC)
Run this pass after local cleanup and before final output.

Heading cue normalization:
- Convert heading-cue patterns to Markdown headings:
  - `Headline X` -> heading `X`
  - `X headline` -> heading `X`
  - `X's headline` -> heading `X`
- Strip leftover cue artifacts (`headline`, trailing periods, possessive `'s`) from heading text.
- Keep heading text otherwise unchanged.

Slash command normalization:
- In technical/procedural context, normalize spoken slash commands:
  - `slash <token>` -> `/<token>`
  - multi-word slash commands may be hyphen-joined when clearly command-like (`slash add telegram` -> `/add-telegram`)
- Apply slash-command normalization only in direct command-invocation context (for example: run/use/type/execute + command).
- Do not convert standalone prose examples like `slash and <word>` into slash commands.

Command-flag normalization:
- In command context, normalize `<command> <flagword>` to `<command> --<flagword>` when flag intent is clear.
- In command context, normalize `<command>-<option>` to `<command> --<option>` when command and option are clear.

Commands section normalization:
- In explicit commands/list context, output one command per line.
- Preserve command order.

## TECHNICAL CANONICALIZATION PASS (MANDATORY)
Run after cue normalization and before final output.

Known-term canonicalization:
- Normalize every recognized known term to exact spelling/casing from `KNOWN_DOMAIN_TERMS`.
- Replace close phonetic/casing variants of known terms with the canonical form when confidence is high.
- Do not emit generic aliases when a canonical known term match is available.
- For multi-token known terms, if one token matches exactly and adjacent token(s) are close phonetic variants, restore the full canonical known-term span.
- Apply known-term restoration consistently across all repeated occurrences in the transcript.
- Explicit homophone guard in technical context: if `cloud` is a phonetic variant of known term `Claude`/`Claude Code`, normalize to canonical `Claude`/`Claude Code`.

Command canonicalization:
- In command context, normalize `<command> version` to `<command> --version`.
- In command context, normalize spoken/homophone clone forms (`get clone`, `git clone`) to `git clone`.
- Keep command names and flags lowercase unless canonical term casing requires otherwise.
- Preserve both tokens in paired technical phrases (for example: `search /discovery`); do not drop one token during normalization.
- In explicit `Commands` section context, treat bare trailing `version` as a required `--version` flag.

## OUTPUT CONTRACT
- Return only cleaned transcript text.
- Return only the cleaned transcript body, with no wrapper line, no label, no explanation, and no closing pleasantries.
- Start directly with transcript content.
- No setup sentence, no labels, no explanations.
- First line must be actual transcript content (heading or sentence), never helper text.
- No XML tags.
- Preserve source cadence (sentence and paragraph rhythm) unless a local punctuation fix requires minor change.
- Keep line boundaries close to source, while allowing headings/lists/command lines when clearly signaled.
- Do not output standalone generic sign-off lines unless clearly required by surrounding context.
- Never output trailing courtesy/sign-off artifacts (for example: "Thank you", "Thanks", "Thank you for watching") unless they are clearly semantically required.
- Never output JSON wrappers, keys, metadata labels, or helper text.
- Never replace wording with a "better" or more polished alternative.

## FINAL SELF-CHECK
- Run a fidelity pass before output: every source claim appears in the same order, with no dropped claims and no claim compression.
- Length guard: after removing fillers/sign-off artifacts, keep output informational length close to source (target at least 90% of source content).
- Every source claim has a matching output claim.
- Claim order is unchanged.
- No claim is merged into a broader abstraction.
- No new factual content introduced.
- Output is transcript text only.
- No sentence rewritten into a high-level summary of multiple source sentences.
- No standalone generic sign-off artifact remains.
- Command lists are not collapsed into comma-joined prose.
- No sentence is paraphrased or rewritten for style.
- If any edit is not a local correction, revert that edit.
- Do not drop short standalone fragments (1-3 words) unless they are explicit fillers, explicit sign-off artifacts, or clear ASR debris.
- Clear ASR debris includes isolated micro-fragment sentences (1-3 words) that add no actor/action/object, are not commands/code/known terms, and are semantically disconnected from neighboring complete sentences.
- If two consecutive micro-fragment sentences are both non-propositional debris, remove both.
- If an isolated micro-fragment sentence remains after cleanup and removing it preserves neighboring coherence, remove it.
- If two adjacent sentences start with the same discourse marker and one is just a repeated setup phrase, keep only one setup phrase and keep the content-bearing clause text.
- For every source content-bearing clause, verify one corresponding output clause exists in the same order.

Clean up the `TRANSCRIPT`:

<TRANSCRIPTION_REQUEST>
<KNOWN_DOMAIN_TERMS>
{{KNOWN_DOMAIN_TERMS}}
</KNOWN_DOMAIN_TERMS>
<TRANSCRIPT>
{{TRANSCRIPT}}
</TRANSCRIPT>
</TRANSCRIPTION_REQUEST>
