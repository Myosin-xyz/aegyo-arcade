/**
 * Return a uniformly shuffled copy without mutating the registry order.
 * Keeping the random source injectable makes the Fisher-Yates behavior
 * deterministic under test while production uses Math.random per request.
 */
export function shuffleGameOrder<T>(
  items: readonly T[],
  random: () => number = Math.random,
): T[] {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}
