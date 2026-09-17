import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  QUESTIONS,
  countAnswered,
  isAnswered,
  validateSubmission
} from "../public/questionnaire.js";

test("the questionnaire contains the complete set of 20 questions", () => {
  assert.equal(QUESTIONS.length, 20);
  assert.match(QUESTIONS[1], /€320/);
  assert.match(QUESTIONS[19], /student visa/i);
});

test("answers must contain non-whitespace text", () => {
  assert.equal(isAnswered("A useful response"), true);
  assert.equal(isAnswered("   \n"), false);
  assert.equal(isAnswered(null), false);
});

test("countAnswered ignores blank answers", () => {
  assert.equal(countAnswered(["yes", " ", "another answer"]), 2);
});

test("submission validation requires all answers and confirmation", () => {
  const answers = QUESTIONS.map(() => "Mentor response");

  assert.equal(validateSubmission({ answers, confirmed: false }).valid, false);
  assert.equal(validateSubmission({ answers, confirmed: true }).valid, true);

  answers[7] = "";
  assert.deepEqual(validateSubmission({ answers, confirmed: true }), {
    valid: false,
    message: "Question 8 still needs an answer."
  });
});

test("every individual question is mandatory at submission", () => {
  for (let index = 0; index < QUESTIONS.length; index += 1) {
    const answers = QUESTIONS.map(() => "Mentor response");
    answers[index] = index % 2 === 0 ? "" : "  \n ";
    assert.deepEqual(validateSubmission({ answers, confirmed: true }), {
      valid: false,
      message: `Question ${index + 1} still needs an answer.`
    });
  }
});

test("the interface uses the approved neutral wording and required response field", async () => {
  const [appSource, indexSource] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/index.html", import.meta.url), "utf8")
  ]);

  assert.match(appSource, /How would you respond to these student questions\?/);
  assert.match(appSource, /Student-support questions/);
  assert.match(appSource, /Confirmation before submission/);
  assert.match(appSource, /required aria-required="true"/);
  assert.doesNotMatch(appSource, /class="quote-mark"/);
  assert.doesNotMatch(appSource, /class="receipt"/);
  assert.doesNotMatch(appSource, /Your experience helps us support students better/);
  assert.doesNotMatch(appSource, /Student-support scenarios/);
  assert.doesNotMatch(appSource, /Final declaration before submission/);
  assert.match(indexSource, /Mentor response study/);
});
