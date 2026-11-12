
import { describe, expect, it } from "vitest";
import { conflictingFacts } from "./guard";

describe("conflictingFacts", () => {
  it("detects different assignment numbers", () => {
    expect(
      conflictingFacts(
        "When is Assignment 3 due?",
        "When is Assignment 4 due?"
      )
    ).toBe(true);
  });

  it("allows the same assignment number", () => {
    expect(
      conflictingFacts(
        "When is Assignment 3 due?",
        "What is the deadline for Assignment 3?"
      )
    ).toBe(false);
  });

  it("detects different chapter numbers", () => {
    expect(
      conflictingFacts(
        "Explain Chapter 3",
        "Explain Chapter 5"
      )
    ).toBe(true);
  });

  it("detects different week numbers", () => {
    expect(
      conflictingFacts(
        "What happens in week 2?",
        "What happens in week 4?"
      )
    ).toBe(true);
  });

  it("detects different dates", () => {
    expect(
      conflictingFacts(
        "Is the exam on March 5?",
        "Is the exam on March 9?"
      )
    ).toBe(true);
  });

  it("allows identical dates", () => {
    expect(
      conflictingFacts(
        "Is the exam on March 5?",
        "When is the exam on March 5?"
      )
    ).toBe(false);
  });

  it("does not block questions without explicit facts", () => {
    expect(
      conflictingFacts(
        "When is the exam?",
        "What is the exam schedule?"
      )
    ).toBe(false);
  });

  it("does not treat 2FA as a numbered fact", () => {
    expect(
      conflictingFacts(
        "How does 2FA work?",
        "Explain 2FA security."
      )
    ).toBe(false);
  });

  it("detects different question numbers", () => {
    expect(
      conflictingFacts(
        "Explain question 2",
        "Explain question 5"
      )
    ).toBe(true);
  });

  it("detects different semester numbers", () => {
    expect(
      conflictingFacts(
        "What is the semester 3 syllabus?",
        "What is the semester 5 syllabus?"
      )
    ).toBe(true);
  });

  it("does not flag unrelated fact categories", () => {
    expect(
      conflictingFacts(
        "Explain Chapter 3",
        "What happens in Week 4?"
      )
    ).toBe(false);
  });
});
