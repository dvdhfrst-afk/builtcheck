// Turns source offsets into one-based line and column numbers.

export class LineIndex {
  constructor(text) {
    this.starts = [0];
    let at = text.indexOf("\n");
    while (at !== -1) {
      this.starts.push(at + 1);
      at = text.indexOf("\n", at + 1);
    }
  }

  locate(offset) {
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.starts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - this.starts[low] + 1 };
  }
}
