export function Qfn(x) {
  if (!isFinite(x)) return x > 0 ? 0 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf_complement = poly * Math.exp(-x * x);
  return x >= 0 ? 0.5 * erf_complement : 1 - 0.5 * erf_complement;
}