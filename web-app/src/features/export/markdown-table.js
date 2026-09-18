export function markdownTableCells(line = "") {
  const source = String(line).trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cell = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\" && source[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }
    if (character === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

export function markdownTableRows(lines = []) {
  const rows = lines
    .filter((_, index) => index !== 1)
    .map(markdownTableCells);
  const width = Math.max(0, ...rows.map((row) => row.length));
  return rows.map((row) => [
    ...row,
    ...Array(Math.max(0, width - row.length)).fill(""),
  ]);
}
