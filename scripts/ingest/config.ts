export interface RulesetConfig {
	id: string;
	title: string;
	shortTitle: string;
	edition: string;
	sourceUrl: string;
	sectionScheme: 'numeric' | 'alpha';
}

export const RULESETS: RulesetConfig[] = [
	{
		id: 'usau-official-2026-27',
		title: 'Official Rules of Ultimate',
		shortTitle: 'Official Rules',
		edition: '2026-2027',
		sourceUrl: 'https://usaultimate.org/rules/',
		sectionScheme: 'numeric'
	}
];
