export function sliceGrounding(grounding: string, sectionNumber: string, title: string): string {
	const lines = grounding.split('\n');
	const header = `## ${sectionNumber}. ${title}`;
	const start = lines.findIndex((line) => line.trim() === header);
	if (start === -1) throw new Error(`section not found in grounding: ${header}`);
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (lines[i].startsWith('## ')) {
			end = i;
			break;
		}
	}
	return lines.slice(start, end).join('\n').trim();
}
