function line(y, values) {
  let cursor = 10;
  const chars = [];
  for (const value of values) {
    const text = String(value);
    const width = Math.max(5, text.length * 5);
    for (const character of text) {
      chars.push({
        value: character,
        x0: cursor,
        x1: cursor + 5,
        bbox: [cursor, y, cursor + 5, y + 10],
      });
      cursor += 5;
    }
    cursor += 75 - width;
  }
  return { bbox: [10, y, cursor, y + 10], chars };
}

export const borderedDigitalTable = {
  page: 2,
  pageBounds: [0, 0, 400, 300],
  blocks: [{ lines: [
    line(20, ["Item", "Units", "Amount"]),
    line(40, ["A", "12", "450"]),
    line(60, ["B", "8", "320"]),
  ] }],
  vectors: [
    { id: "h1", bbox: [10, 10, 250, 10.5] },
    { id: "h2", bbox: [10, 30, 250, 30.5] },
    { id: "h3", bbox: [10, 50, 250, 50.5] },
    { id: "h4", bbox: [10, 70, 250, 70.5] },
    { id: "v1", bbox: [90, 10, 90.5, 70] },
    { id: "v2", bbox: [170, 10, 170.5, 70] },
  ],
};

export const borderlessTable = {
  page: 3,
  pageBounds: [0, 0, 400, 300],
  blocks: [{ lines: [
    line(20, ["Method", "Mean", "Std"]),
    line(40, ["A", "1.2", "0.3"]),
    line(60, ["B", "1.5", "0.2"]),
  ] }],
  vectors: [],
};

export const malformedScannedTable = {
  page: 4,
  pageBounds: [0, 0, 400, 300],
  blocks: [{ lines: [
    line(20, ["Field", "Value", "Note"]),
    line(40, ["A", "12"]),
    line(60, ["B", "8", "partial"]),
  ] }],
  vectors: [],
};

export const mergedHeaderRows = [
  [
    { text: "Metric", rowIndex: 0, columnIndex: 0, colSpan: 2, bbox: [10, 10, 150, 22] },
    { text: "Value", rowIndex: 0, columnIndex: 2, bbox: [150, 10, 220, 22] },
  ],
  [
    { text: "Mean", rowIndex: 1, columnIndex: 0, bbox: [10, 24, 80, 36] },
    { text: "Std", rowIndex: 1, columnIndex: 1, bbox: [80, 24, 150, 36] },
    { text: "1.2", rowIndex: 1, columnIndex: 2, bbox: [150, 24, 220, 36] },
  ],
];

export const financialRows = [
  ["Revenue", "1,250", "USD"],
  ["Operating cost", "800", "USD"],
  ["Margin", "450", "USD"],
];

export const scientificRows = [
  ["Sample", "μ", "σ"],
  ["Control", "0.42", "0.08"],
  ["Treatment", "0.57", "0.11"],
];

export const splitPageSegments = [
  { page: 7, rows: [["Item", "Amount"], ["A", "10"]] },
  { page: 8, rows: [["Item", "Amount"], ["B", "20"]] },
];
