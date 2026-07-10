import { z } from 'zod';

export interface RuleNode {
	id: string; // "15.A.3", "B1.G.1"
	label: string; // display label as printed, e.g. "15.A.3."
	html: string; // trusted build-time HTML from the ingest pipeline (not sanitized at render) (xrefs internal, glossary-wrapped, images local)
	text: string; // plain text, whitespace-normalized; may be '' for header-only rules
	annotations: string[]; // official annotations, [[..]] markers stripped
	refs: string[]; // rule/section ids this rule links to
	children: RuleNode[];
}
export interface Section {
	slug: string; // "1".."23" | "preface" | "appendix-a".."appendix-g"
	anchorId: string; // source anchor: "1" | "preface" | "appendix_a"
	number: string | null; // "1".."23" | "A".."G" | null (preface)
	kind: 'preface' | 'section' | 'appendix';
	title: string; // "Introduction", "Field Diagram"
	html: string | null; // section-level non-rule content (preface body, appendix tables)
	rules: RuleNode[];
}
export interface TocEntry {
	slug: string;
	number: string | null;
	kind: Section['kind'];
	title: string;
	ruleCount: number;
}
export interface Manifest {
	id: string;
	title: string;
	shortTitle: string;
	edition: string;
	sourceUrl: string;
	sectionScheme: 'numeric' | 'alpha';
	fetchedAt: string;
	sections: TocEntry[];
}
export interface GlossaryEntry {
	ruleId: string;
	term: string;
	definition: string;
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

export const SectionSchema: z.ZodType<Section> = z.object({
	slug: z.string().min(1),
	anchorId: z.string().min(1),
	number: z.string().min(1).nullable(),
	kind: sectionKind,
	title: z.string().min(1),
	html: z.string().nullable(),
	rules: z.array(RuleNodeSchema)
});

export const TocEntrySchema: z.ZodType<TocEntry> = z.object({
	slug: z.string().min(1),
	number: z.string().min(1).nullable(),
	kind: sectionKind,
	title: z.string().min(1),
	ruleCount: z.number()
});

export const ManifestSchema: z.ZodType<Manifest> = z.object({
	id: z.string().min(1),
	title: z.string().min(1),
	shortTitle: z.string().min(1),
	edition: z.string().min(1),
	sourceUrl: z.url(),
	sectionScheme: z.enum(['numeric', 'alpha']),
	fetchedAt: z.iso.datetime(),
	sections: z.array(TocEntrySchema)
});

export const GlossaryEntrySchema: z.ZodType<GlossaryEntry> = z.object({
	ruleId: z.string().min(1),
	term: z.string().min(1),
	definition: z.string().min(1)
});
