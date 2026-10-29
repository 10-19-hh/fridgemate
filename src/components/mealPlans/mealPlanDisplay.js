export function shortDate(value) {
  return `${Number(value.slice(5, 7))}.${Number(value.slice(8, 10))}`;
}
