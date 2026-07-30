import { z } from 'zod';

// RuleNode keeps its hand-written interface: it is self-referential
// (children: RuleNode[]) and z.lazy cannot infer a recursive type without an
// explicit z.ZodType<RuleNode> annotation to break the circular inference.
// Do not convert this one to z.infer.
export interface RuleNode {
	id: string; // "15.A.3", "B1.G.1"
	label: string; // display label as printed, e.g. "15.A.3."
	html: string; // trusted build-time HTML from the ingest pipeline (not sanitized at render) (xrefs internal, glossary-wrapped, images local)
	text: string; // plain text, whitespace-normalized; may be '' for header-only rules
	annotations: string[]; // official annotations, [[..]] markers stripped
	refs: string[]; // rule/section ids this rule links to
	children: RuleNode[];
}

export const RuleNodeSchema: z.ZodType<RuleNode> = z.lazy(() =>
	z.object({
		id: z.string().min(1),
		label: z.string().min(1),
		html: z.string(),
		text: z.string(),
		annotations: z.array(z.string().min(1)),
		refs: z.array(z.string().min(1)),
		children: z.array(RuleNodeSchema)
	})
);

const sectionKind = z.enum(['preface', 'section', 'appendix']);

export const SectionSchema = z.object({
	// "1".."23" | "preface" | "appendix-a".."appendix-g"
	slug: z.string().min(1),
	// source anchor: "1" | "preface" | "appendix_a"
	anchorId: z.string().min(1),
	// "1".."23" | "A".."G" | null (preface)
	number: z.string().min(1).nullable(),
	kind: sectionKind,
	// "Introduction", "Field Diagram"
	title: z.string().min(1),
	// section-level non-rule content (preface body, appendix tables)
	html: z.string().nullable(),
	rules: z.array(RuleNodeSchema)
});
export type Section = z.infer<typeof SectionSchema>;

export const TocEntrySchema = z.object({
	slug: z.string().min(1),
	number: z.string().min(1).nullable(),
	kind: sectionKind,
	title: z.string().min(1),
	ruleCount: z.number()
});
export type TocEntry = z.infer<typeof TocEntrySchema>;

export const ManifestSchema = z.object({
	id: z.string().min(1),
	title: z.string().min(1),
	shortTitle: z.string().min(1),
	edition: z.string().min(1),
	sourceUrl: z.url(),
	sectionScheme: z.enum(['numeric', 'alpha']),
	fetchedAt: z.iso.datetime(),
	sections: z.array(TocEntrySchema)
});
export type Manifest = z.infer<typeof ManifestSchema>;

export const GlossaryEntrySchema = z.object({
	ruleId: z.string().min(1),
	term: z.string().min(1),
	definition: z.string().min(1)
});
export type GlossaryEntry = z.infer<typeof GlossaryEntrySchema>;
