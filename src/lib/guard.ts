
function extractFacts(text: string): Set<string> {
  const normalized = text.toLowerCase();
  const facts = new Set<string>();

  // Dates such as March 5, March 9, etc.
  const monthNames =
    "january|february|march|april|may|june|july|august|september|october|november|december";

  const dateRegex = new RegExp(
    `\\b(?:${monthNames})\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`,
    "gi"
  );

  for (const match of normalized.matchAll(dateRegex)) {
    facts.add(`date:${match[0].replace(/\s+/g, " ")}`);
  }

  // Numeric facts, including chapter 3, week 2, etc.
  const numberRegex =
    /\b(chapter|ch|week|assignment|assn|question|q|part|phase|round|semester|sem|unit|module)\s*[-:#]?\s*(\d+)(?:st|nd|rd|th)?\b/gi;

  for (const match of normalized.matchAll(numberRegex)) {
    facts.add(`${match[1]}:${match[2]}`);
  }

  return facts;
}

export function conflictingFacts(a: string, b: string): boolean {
  const factsA = extractFacts(a);
  const factsB = extractFacts(b);

  if (factsA.size === 0 || factsB.size === 0) {
    return false;
  }

  // Only compare fact categories that appear in both questions.
  for (const factA of factsA) {
    const category = factA.split(":")[0];

    const sameCategoryFactsB = [...factsB].filter(
      (factB) => factB.split(":")[0] === category
    );

    if (
      sameCategoryFactsB.length > 0 &&
      !sameCategoryFactsB.includes(factA)
    ) {
      return true;
    }
  }

  return false;
}
