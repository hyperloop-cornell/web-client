/** Sensor configs use Chart.js colors; map them onto the dark palette. */
const PALETTE: Record<string, string> = {
  '#FF6384': '#ECECEC',
  '#36A2EB': '#5AA9E6',
  '#FFCE56': '#E8A33C',
  '#4BC0C0': '#4FC59B',
  '#9966FF': '#A98BEA',
  '#FF9F40': '#E9805B',
};

/** Merged charts recolor every line from this sequence so sources stay distinguishable. */
const SEQUENCE = ['#ECECEC', '#5AA9E6', '#E8A33C', '#4FC59B', '#A98BEA', '#E9805B', '#D9D27A', '#7FB8C9'];

export function chartColor(color: string): string {
  return PALETTE[color.toUpperCase()] ?? color;
}

export function sequenceColor(index: number): string {
  return SEQUENCE[index % SEQUENCE.length];
}
