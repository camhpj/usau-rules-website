export const SEED_DEFAULTS = {
	model: 'gemini-flash-latest',
	targetThreshold: 2, // min importance score to be a target (the saturation-ceiling knob)
	minTargetTextLength: 40, // rules with shorter own-text are headers/fragments — covered via children
	targetsPerSectionPerRun: 8, // pace: max uncovered targets requested per section per run
	excludeTargets: [] as string[], // escape hatch for targets the model repeatedly can't fulfill
	difficultyMix: 'Aim for roughly 40% difficulty 1, 40% difficulty 2, 20% difficulty 3.'
} as const;
