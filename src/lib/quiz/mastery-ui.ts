import type { MasteryLevel } from './mastery';

export const LEVEL_STYLES: Record<MasteryLevel, string> = {
	unseen: 'border-white/15 bg-white/5 text-white/80',
	learning: 'border-cardinal/60 bg-white/5 text-white',
	solid: 'border-white/60 bg-white/15 text-white',
	mastered: 'border-turf bg-turf/25 text-white'
};
export const LEVEL_LABELS: Record<MasteryLevel, string> = {
	unseen: 'Not started',
	learning: 'Learning',
	solid: 'Solid',
	mastered: 'Mastered'
};
