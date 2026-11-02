import { cosineSimilarity } from "./similarity";

const a = [1, 0, 0];
const b = [0.9, 0.1, 0];
const c = [0, 0, 1];

// Test 1: Similar vectors
const similar = cosineSimilarity(a, b);
console.log("Test 1 - Similar vectors:", similar);

// Test 2: Perpendicular vectors
const different = cosineSimilarity(a, c);
console.log("Test 2 - Different vectors:", different);

// Test 3: Identical vectors
const identical = cosineSimilarity(a, a);
console.log("Test 3 - Identical vectors:", identical);

// Assertions
console.assert(similar > 0.9, "Similar vectors should score above 0.9");
console.assert(Math.abs(different) < 1e-10, "Perpendicular vectors should score 0");
console.assert(Math.abs(identical - 1) < 1e-10, "Identical vectors should score 1");

console.log("Similarity checks completed.");