import {
  QUESTIONS,
  QUESTIONNAIRE_VERSION,
  countAnswered,
  isAnswered,
  validateSubmission
} from "./questionnaire.js";

const STORAGE_KEY = "mentor-questionnaire-draft-v1";
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
let toastTimer;

function freshState() {
  return {
    view: "intro",
    currentIndex: 0,
    answers: QUESTIONS.map(() => ""),
    confirmed: false,
    startedAt: null,
    status: "draft"
  };
}

function loadDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const savedAt = Date.parse(saved?.savedAt);
    if (
      saved?.version === QUESTIONNAIRE_VERSION &&
      Number.isFinite(savedAt) &&
      Date.now() - savedAt <= DRAFT_MAX_AGE_MS &&
      Array.isArray(saved.answers) &&
      saved.answers.length === QUESTIONS.length
    ) {
      return {
        ...freshState(),
        currentIndex: Math.max(0, Math.min(QUESTIONS.length - 1, Number(saved.currentIndex) || 0)),
        answers: saved.answers.map((answer) => (typeof answer === "string" ? answer : "")),
        startedAt: typeof saved.startedAt === "string" ? saved.startedAt : null
      };
    }
  } catch {
    // Storage can be unavailable in private or embedded browsing contexts.
  }

  clearSavedDraft();
  return freshState();
}

let state = loadDraft();

function saveDraft() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: QUESTIONNAIRE_VERSION,
        currentIndex: state.currentIndex,
        answers: state.answers,
        startedAt: state.startedAt,
        savedAt: new Date().toISOString()
      })
    );
  } catch {
    announce("Your browser could not save this draft locally.", "warning");
  }
}

function clearSavedDraft() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // There is nothing else to clean up when browser storage is unavailable.
  }
}

function announce(message, tone = "info") {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add("toast--visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("toast--visible"), 3600);
}

function focusScreen() {
  window.scrollTo({ top: 0, behavior: "smooth" });
  window.requestAnimationFrame(() => {
    document.querySelector("[data-screen-heading]")?.focus({ preventScroll: true });
  });
}

function wordLabel(value) {
  const count = value.trim() ? value.trim().split(/\s+/).length : 0;
  return `${count} ${count === 1 ? "word" : "words"}`;
}

function autosize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(210, textarea.scrollHeight)}px`;
}

function progressPanel(current, mode = "question") {
  const answered = countAnswered(state.answers);
  const percent = mode === "final" ? 100 : Math.round((answered / QUESTIONS.length) * 100);
  const markers = QUESTIONS.map((_, index) => {
    const status = index === current && mode !== "final"
      ? "current"
      : isAnswered(state.answers[index])
        ? "complete"
        : "upcoming";
    const label = status === "complete" ? "answered" : status;
    return `<span class="step-marker step-marker--${status}" role="listitem" aria-label="Question ${index + 1}: ${label}">${
      status === "complete" ? "✓" : index + 1
    }</span>`;
  }).join("");

  return `
    <aside class="progress-card" aria-label="Questionnaire progress">
      <p class="eyebrow">Your progress</p>
      <div class="progress-summary">
        <div class="progress-ring" style="--progress: ${percent * 3.6}deg">
          <span><strong>${answered}</strong><small>of ${QUESTIONS.length}</small></span>
        </div>
        <div>
          <strong>${answered === QUESTIONS.length ? "All answered" : `${QUESTIONS.length - answered} remaining`}</strong>
          <p>Your draft is kept in this browser until you submit.</p>
        </div>
      </div>
      <div class="step-grid" role="list" aria-label="Answer status">${markers}</div>
      <div class="save-note">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 12 3 3 7-7"/><circle cx="12" cy="12" r="9"/></svg>
        <span><strong>Saved locally</strong><small>You can safely move back and revise.</small></span>
      </div>
    </aside>`;
}

function renderIntro() {
  const answered = countAnswered(state.answers);
  const hasDraft = answered > 0;

  app.innerHTML = `
    <section class="intro-shell screen-enter" aria-labelledby="intro-title">
      <div class="intro-copy">
        <p class="eyebrow">Mentor response questionnaire</p>
        <h1 id="intro-title" data-screen-heading tabindex="-1">How would you respond to these student questions?</h1>
        <div class="intro-body">
          <p>Please answer the following questions as you would normally respond to a student.</p>
          <p>You may consult official university websites and other relevant information sources where necessary. Please formulate the responses in your own words and do not use ChatGPT or other generative AI/LLM tools to prepare your answers.</p>
        </div>

        <div class="intro-actions">
          <button class="button button--primary button--large" id="begin-button" type="button">
            <span>${hasDraft ? "Continue questionnaire" : "Begin questionnaire"}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
          </button>
          ${hasDraft ? `<span class="draft-badge"><span></span>${answered} ${answered === 1 ? "answer" : "answers"} saved</span>` : ""}
        </div>
        ${hasDraft ? `<button class="discard-draft" id="discard-draft" type="button">Discard saved draft</button>` : ""}
      </div>

      <div class="intro-side">
        <div class="brief-card">
          <div class="brief-card__top">
            <span class="brief-icon" aria-hidden="true">
              <svg viewBox="0 0 28 28"><path d="M6 5h16v18H6z"/><path d="M10 10h8M10 14h8M10 18h5"/></svg>
            </span>
            <span class="brief-number">20</span>
          </div>
          <h2>Student-support questions</h2>
          <p>Presented one at a time so you can focus on each response.</p>
          <div class="brief-list">
            <span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10 3 3 7-7"/></svg> Every question requires a response</span>
            <span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10 3 3 7-7"/></svg> You can go back and revise your answers</span>
            <span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10 3 3 7-7"/></svg> Responses are anonymous</span>
            <span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10 3 3 7-7"/></svg> Confirmation before submission</span>
          </div>
        </div>
        <p class="privacy-note">Before you start: responses save in this browser as you type. Pasting into the answer field is disabled, and completed responses are sent to this questionnaire's server when you submit.</p>
      </div>
    </section>`;

  document.querySelector("#begin-button").addEventListener("click", () => {
    state.startedAt ||= new Date().toISOString();
    state.view = "question";
    saveDraft();
    render();
  });

  document.querySelector("#discard-draft")?.addEventListener("click", () => {
    if (!window.confirm("Discard all answers saved in this browser? This cannot be undone.")) return;
    clearSavedDraft();
    state = freshState();
    render();
    announce("The saved draft was discarded.");
  });
}

function renderQuestion() {
  const index = state.currentIndex;
  const isLast = index === QUESTIONS.length - 1;

  app.innerHTML = `
    <div class="question-layout screen-enter">
      ${progressPanel(index)}
      <section class="question-card" aria-labelledby="question-title">
        <div class="question-card__header">
          <div>
            <p class="eyebrow">Question ${index + 1} of ${QUESTIONS.length}</p>
            <h1 id="question-title">Student-support question</h1>
          </div>
          <span class="typed-only-badge">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V6a5 5 0 0 1 10 0v3M5 9h14v11H5z"/></svg>
            Typed response only
          </span>
        </div>

        <div class="question-prompt protected-copy" aria-label="Question ${index + 1}">
          <h2 id="question-text" data-screen-heading tabindex="-1">${QUESTIONS[index]}</h2>
        </div>

        <div class="answer-group">
          <div class="answer-label-row">
            <label id="answer-label" for="answer">Your response <span class="required-text">Required</span></label>
            <span id="word-count">${wordLabel(state.answers[index])}</span>
          </div>
          <textarea id="answer" name="answer" rows="8" spellcheck="true" autocomplete="off" required aria-required="true" aria-labelledby="answer-label question-text" aria-describedby="answer-help answer-error" placeholder="Type your response here…"></textarea>
          <div class="answer-meta">
            <p id="answer-help">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 6v5m0 3v.01"/><circle cx="10" cy="10" r="8"/></svg>
              Please answer in your own words. Pasting and dropped text are disabled.
            </p>
            <p id="answer-error" class="field-error" role="alert"></p>
          </div>
        </div>

        <div class="question-actions">
          <button class="button button--secondary" id="back-button" type="button">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
            ${index === 0 ? "Instructions" : "Previous"}
          </button>
          <button class="button button--primary" id="next-button" type="button" ${isAnswered(state.answers[index]) ? "" : "disabled"}>
            ${isLast ? "Review & finish" : "Save & continue"}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>
      </section>
    </div>`;

  const textarea = document.querySelector("#answer");
  const nextButton = document.querySelector("#next-button");
  const error = document.querySelector("#answer-error");
  const wordCount = document.querySelector("#word-count");
  const questionPrompt = document.querySelector(".question-prompt");

  textarea.value = state.answers[index];
  autosize(textarea);

  textarea.addEventListener("input", () => {
    state.answers[index] = textarea.value;
    state.confirmed = false;
    nextButton.disabled = !isAnswered(textarea.value);
    wordCount.textContent = wordLabel(textarea.value);
    error.textContent = "";
    autosize(textarea);
    saveDraft();
  });

  const blockInsertedText = (event) => {
    event.preventDefault();
    error.textContent = "Pasting is disabled. Please type your response in your own words.";
    announce("Pasting is disabled for this questionnaire.", "warning");
    textarea.focus();
  };

  textarea.addEventListener("paste", blockInsertedText);
  textarea.addEventListener("drop", blockInsertedText);
  textarea.addEventListener("beforeinput", (event) => {
    if (["insertFromPaste", "insertFromDrop", "insertFromYank"].includes(event.inputType)) {
      blockInsertedText(event);
    }
  });

  questionPrompt.addEventListener("copy", (event) => {
    event.preventDefault();
    announce("Copying questions is disabled.", "warning");
  });
  questionPrompt.addEventListener("cut", (event) => event.preventDefault());
  questionPrompt.addEventListener("dragstart", (event) => event.preventDefault());
  questionPrompt.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    announce("Copying questions is disabled.", "warning");
  });

  document.querySelector("#back-button").addEventListener("click", () => {
    state.answers[index] = textarea.value;
    if (index === 0) {
      state.view = "intro";
    } else {
      state.currentIndex -= 1;
    }
    saveDraft();
    render();
  });

  const goNext = () => {
    state.answers[index] = textarea.value;
    if (!isAnswered(textarea.value)) {
      error.textContent = "Please add a response before continuing.";
      textarea.focus();
      return;
    }

    if (isLast) {
      const firstMissing = state.answers.findIndex((answer) => !isAnswered(answer));
      if (firstMissing !== -1) {
        state.currentIndex = firstMissing;
        announce(`Question ${firstMissing + 1} still needs an answer.`, "warning");
      } else {
        state.view = "final";
      }
    } else {
      state.currentIndex += 1;
    }
    saveDraft();
    render();
  };

  nextButton.addEventListener("click", goNext);
  textarea.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      goNext();
    }
  });

}

function renderFinal() {
  const validation = validateSubmission({ answers: state.answers, confirmed: true });
  if (!validation.valid) {
    const missing = state.answers.findIndex((answer) => !isAnswered(answer));
    state.currentIndex = Math.max(0, missing);
    state.view = "question";
    render();
    announce(validation.message, "warning");
    return;
  }

  const checks = QUESTIONS.map(
    (_, index) => `<span class="completion-item"><span>✓</span> Question ${index + 1}</span>`
  ).join("");

  app.innerHTML = `
    <div class="question-layout screen-enter">
      ${progressPanel(QUESTIONS.length - 1, "final")}
      <section class="question-card final-card" aria-labelledby="final-title">
        <div class="final-heading">
          <span class="final-icon" aria-hidden="true">
            <svg viewBox="0 0 32 32"><path d="m9 16 5 5 10-11"/><circle cx="16" cy="16" r="13"/></svg>
          </span>
          <p class="eyebrow">One final step</p>
          <h1 id="final-title" data-screen-heading tabindex="-1">All 20 responses are complete.</h1>
          <p>Please confirm the statement below before submitting your responses.</p>
        </div>

        <details class="completion-details">
          <summary>View completion checklist <span>20 / 20</span></summary>
          <div class="completion-grid">${checks}</div>
        </details>

        <label class="declaration" for="confirmation">
          <input id="confirmation" type="checkbox" ${state.confirmed ? "checked" : ""} />
          <span class="custom-check" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m4 10 4 4 8-8"/></svg></span>
          <span>
            <strong>Confirmation before submission</strong>
            <span>I confirm that I did not use generative AI tools to generate my responses.</span>
          </span>
        </label>

        <p id="submit-error" class="submit-error" role="alert"></p>

        <div class="question-actions final-actions">
          <button class="button button--secondary" id="edit-button" type="button">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
            Review answers
          </button>
          <button class="button button--primary" id="submit-button" type="button" ${state.confirmed ? "" : "disabled"}>
            <span>Submit responses</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
          </button>
        </div>
        <p class="submit-note">Once submitted, this browser's saved draft will be cleared.</p>
      </section>
    </div>`;

  const checkbox = document.querySelector("#confirmation");
  const submitButton = document.querySelector("#submit-button");
  const submitError = document.querySelector("#submit-error");

  checkbox.addEventListener("change", () => {
    state.confirmed = checkbox.checked;
    submitButton.disabled = !state.confirmed;
    submitError.textContent = "";
  });

  document.querySelector("#edit-button").addEventListener("click", () => {
    state.confirmed = false;
    state.currentIndex = 0;
    state.view = "question";
    saveDraft();
    render();
  });

  submitButton.addEventListener("click", async () => {
    const result = validateSubmission({ answers: state.answers, confirmed: state.confirmed });
    if (!result.valid) {
      const firstMissing = state.answers.findIndex((answer) => !isAnswered(answer));
      if (firstMissing !== -1) {
        state.currentIndex = firstMissing;
        state.view = "question";
        saveDraft();
        render();
        announce(result.message, "warning");
        return;
      }
      submitError.textContent = result.message;
      return;
    }

    if (state.status === "submitting") return;
    state.status = "submitting";
    checkbox.disabled = true;
    submitButton.disabled = true;
    submitButton.classList.add("button--loading");
    submitButton.querySelector("span").textContent = "Submitting…";

    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: state.answers,
          confirmed: state.confirmed,
          metadata: {
            questionnaireVersion: QUESTIONNAIRE_VERSION,
            startedAt: state.startedAt,
            completedAt: new Date().toISOString()
          }
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || "The server could not save your responses.");

      state.status = "submitted";
      state.submittedAt = data.submittedAt || new Date().toISOString();
      clearSavedDraft();
      state.view = "success";
      render();
    } catch (error) {
      state.status = "draft";
      checkbox.disabled = false;
      submitButton.disabled = !checkbox.checked;
      submitButton.classList.remove("button--loading");
      submitButton.querySelector("span").textContent = "Submit responses";
      submitError.textContent = `${error.message} Your draft is still safe in this browser; please try again.`;
    }
  });
}

function renderSuccess() {
  const submittedTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(state.submittedAt));

  app.innerHTML = `
    <section class="success-card screen-enter" aria-labelledby="success-title">
      <div class="success-mark" aria-hidden="true">
        <svg viewBox="0 0 44 44"><path d="m12 22 7 7 14-15"/><circle cx="22" cy="22" r="19"/></svg>
      </div>
      <p class="eyebrow">Submission complete</p>
      <h1 id="success-title" data-screen-heading tabindex="-1">Thank you for sharing your expertise.</h1>
      <p>Your 20 responses and confirmation have been recorded successfully.</p>
      <div class="submission-detail">
        <small>Submitted</small>
        <strong id="submission-time"></strong>
      </div>
      <p class="success-note">Your responses have been submitted. Thank you.</p>
    </section>`;

  document.querySelector("#submission-time").textContent = submittedTime;
}

function render() {
  document.body.dataset.view = state.view;
  if (state.view === "question") renderQuestion();
  else if (state.view === "final") renderFinal();
  else if (state.view === "success") renderSuccess();
  else renderIntro();
  focusScreen();
}

document.addEventListener("copy", (event) => {
  const selection = window.getSelection();
  const selectedNode = selection?.anchorNode?.nodeType === Node.TEXT_NODE
    ? selection.anchorNode.parentElement
    : selection?.anchorNode;
  if (selectedNode?.closest?.(".protected-copy")) {
    event.preventDefault();
    announce("Copying questions is disabled.", "warning");
  }
});

render();
