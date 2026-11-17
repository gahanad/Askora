
import fs from "node:fs";

const filePath = "eval/dataset.jsonl";

if (!fs.existsSync(filePath)) {
  console.error(`Dataset not found: ${filePath}`);
  process.exit(1);
}

const lines = fs.readFileSync(filePath, "utf8")
  .split(/\r?\n/)
  .filter(line => line.trim() !== "");

const records = [];
const errors = [];

lines.forEach((line, index) => {
  try {
    const item = JSON.parse(line);

    if (
      typeof item.a !== "string" || !item.a.trim() ||
      typeof item.b !== "string" || !item.b.trim() ||
      typeof item.duplicate !== "boolean" ||
      !["dbms", "townhall", "product_ama", "hackathon"].includes(item.topic)
    ) {
      errors.push(`Line ${index + 1}: Invalid or missing fields`);
      return;
    }

    records.push(item);
  } catch {
    errors.push(`Line ${index + 1}: Invalid JSON`);
  }
});

const duplicates = records.filter(item => item.duplicate).length;
const nonDuplicates = records.filter(item => !item.duplicate).length;

console.log("\n===== DATASET VALIDATION =====");
console.log(`Total non-empty lines: ${lines.length}`);
console.log(`Valid records: ${records.length}`);
console.log(`True duplicates: ${duplicates}`);
console.log(`Non-duplicates: ${nonDuplicates}`);

console.log("\n===== TOPIC DISTRIBUTION =====");

for (const topic of ["dbms", "townhall", "product_ama", "hackathon"]) {
  const count = records.filter(item => item.topic === topic).length;
  console.log(`${topic}: ${count}`);
}

console.log("\n===== VALIDATION ERRORS =====");

if (errors.length === 0 && records.length === 120) {
  console.log("No schema errors. Record count is correct.");
} else {
  console.log(errors.length ? errors.join("\n") : "Expected exactly 120 records.");
}

if (errors.length > 0 || records.length !== 120) {
  process.exit(1);
}
