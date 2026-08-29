export function echo(message) {
  globalThis.__dekaPrint(String(message) + "\n");
}
