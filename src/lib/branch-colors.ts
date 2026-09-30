// Assign branch colors by alphabetical index, shared by the dashboard and employee list. The
// 20-slot order alternates hues for adjacent segments. Keep text labels and segment gaps as
// additional cues; check contrast and color-vision distinguishability before changing the palette.
const branchPalette = [
  '#2A78D6', // 1 blue
  '#06809C', // 2 teal
  '#EB6834', // 3 orange
  '#0277BD', // 4 deep sky
  '#C98500', // 5 gold
  '#109566', // 6 mint
  '#D03B3B', // 7 red
  '#4A3AA7', // 8 indigo
  '#6B21A8', // 9 purple
  '#6B8E23', // 10 olive
  '#D55181', // 11 pink
  '#008300', // 12 green
  '#8C2F39', // 13 maroon
  '#5C6BC0', // 14 slate blue
  '#84831C', // 15 lime olive
  '#C2185B', // 16 magenta
  '#1F4E9E', // 17 navy
  '#C75B41', // 18 terracotta
  '#7E57C2', // 19 lavender
  '#2E7D52', // 20 forest
  '#2A78D6', // 21 blue
  '#06809C', // 22 forest teal
] as const;

// Colour for the i-th branch (alphabetical index). Wraps past 20 branches.
function branchColorAt(i: number): string {
  return branchPalette[i % branchPalette.length];
}

export { branchPalette, branchColorAt };
