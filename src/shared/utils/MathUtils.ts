export class MathUtils {
  static stdDev(array: number[]): number {
    const n = array.length;
    if (n === 0) return 0;
    const mean = array.reduce((a, b) => a + b) / n;
    return Math.sqrt(
      array.map((x) => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n,
    );
  }

  static linspace(start: number, stop: number, num: number): number[] {
    if (num <= 1) return [start];
    const step = (stop - start) / (num - 1);
    return Array.from({ length: num }, (_, i) => start + step * i);
  }
}
