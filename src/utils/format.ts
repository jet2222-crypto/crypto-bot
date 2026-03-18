function trimTrailingZeros(value: string): string {
  return value.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

export function formatPrice(price: number): string {
  if (!Number.isFinite(price)) {
    return "N/A";
  }
  if (price === 0) {
    return "0";
  }

  const abs = Math.abs(price);
  if (abs >= 1000) {
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }
  if (abs >= 1) {
    return price.toFixed(2);
  }
  if (abs >= 0.1) {
    return trimTrailingZeros(price.toFixed(4));
  }
  if (abs >= 0.01) {
    return trimTrailingZeros(price.toFixed(5));
  }
  if (abs >= 0.001) {
    return trimTrailingZeros(price.toFixed(6));
  }
  if (abs >= 0.0001) {
    return trimTrailingZeros(price.toFixed(8));
  }
  if (abs >= 0.000001) {
    return trimTrailingZeros(price.toFixed(10));
  }

  const tiny = trimTrailingZeros(price.toFixed(12));
  if (tiny !== "0") {
    return tiny;
  }
  return price.toExponential(4);
}
