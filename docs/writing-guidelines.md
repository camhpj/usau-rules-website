# Writing guidelines

`CLAUDE.md` states the rules that apply to everything written in this repo. This file covers longer documents: specs, plans, design notes, and PR bodies. Read it before drafting one.

## Structure

A document should read end to end as a narrative. Problem, then goals, then requirements. A reader should be able to predict each section from the one before it.

Give every fact and invariant one home section. Cross-reference it from everywhere else. A phrase that repeats across sections is the signal to consolidate.

Let detail track risk. Fully specify what is load-bearing: contracts, security boundaries, data invariants, and anything expensive to change later. For everything else, state the requirement and leave the approach to the implementer. "Implementer's choice" is a valid entry.

Keep contested rationale in one place. When a decision needs defending, add a decision log at the end of the document and record it there with the alternative that was rejected. Everywhere else, state the decision plainly and move on.

Never invent a metric, baseline, or fact. Write "unknown" and add an open question. A document with honest gaps is more useful than one that reads as complete.

## Failure modes

These patterns recur in model-drafted documents. Check the draft for each before calling it done.

**Em-dash addiction.** At most one em-dash per paragraph. If a sentence needs two, split it into two sentences.

**Epigrams.** No slogans or aphorisms. If a sentence sounds quotable, rewrite it to sound ordinary.

**"X, never Y" constructions.** Once is emphasis. Repeated, it is a tic. State what the system does, and state the exclusion only where a reader would otherwise assume the opposite.

**Coined jargon.** Coin a term only if the document will use it many times, and define it at first use. Prefer ordinary words over a private vocabulary.

**Justification stuffing.** Parenthetical defenses attached to every claim. Move contested rationale to the decision log and delete the rest.

**Table cells as essays.** When a cell wants to be a paragraph, the content belongs in prose or nowhere.

**Uniform density.** Long multi-clause sentences stacked without relief, everything specified at equal pressure. Density should track importance rather than fill space.
