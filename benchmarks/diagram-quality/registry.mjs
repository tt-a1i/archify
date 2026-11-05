export const metrics = ['content','layout','speed','cost','human'];

export const humanRubric = {
  version: 'diagram-quality-human-v1',
  fields: ['readability', 'hierarchy', 'layout', 'style', 'aesthetics'],
  anchors: {
    readability: ['Cannot follow text or routes', 'Usable with repeated searching', 'Paths and labels immediately traceable'],
    hierarchy: ['Grouping obscures meaning', 'Main groups clear', 'Hierarchy supports understanding'],
    layout: ['Crowded or unbalanced', 'Usable with local spacing issues', 'Balanced alignment, density and spacing'],
    style: ['Inconsistent or low contrast', 'Mostly consistent', 'Consistent and meaningfully differentiated'],
    aesthetics: ['Would not use', 'Acceptable', 'Would use or share directly'],
  },
  protocol: 'Blind tool/model/cost/scores, randomize A/B with saved seed, allow tie/both unusable; Report reviewer count and label single-reviewer results provisional. Preserve all raw ratings. No human rating changes objective.',
};
