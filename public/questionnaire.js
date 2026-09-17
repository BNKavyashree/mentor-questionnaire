export const QUESTIONS = Object.freeze([
  "I am temporarily staying with a friend because I have not found permanent accommodation yet. Can I still complete my university enrolment using this temporary address?",
  "I found a room advertised for €320, but the contract says this is the Kaltmiete. What is the difference between Kaltmiete and Warmmiete, and what other costs might I have to pay?",
  "How can I complete city registration in Magdeburg, which documents do I need, and where can I register?",
  "I moved from my old WG into a new apartment. Apart from changing my address at the Bürgerbüro, are there other university or official places where I should update my address?",
  "I have completed my university enrolment, but I cannot access LSF yet. How do I activate my LSF account and get access to the system?",
  "I am new on campus and need to visit the Campus Service Center and later the FIN Examination Office. Which buildings should I go to, and where exactly is the Examination Office?",
  "How can I find which study area a course belongs to using LSF and the module catalogue?",
  "I added a course to my personal schedule in LSF and it now appears in my timetable. Does that mean I am officially registered for the course, or do I still need to register separately?",
  "I found a course in the module catalogue that seems relevant to my degree, but I cannot see it under my programme in LSF this semester. Does that mean I am not allowed to take it, or could there be another reason why it is missing?",
  "How are written exams registered, and until when can an exam registration be withdrawn without the attempt counting?",
  "I woke up sick on the morning of my exam and I don't think I am fit enough to attend. What do I need to do so that my absence is officially accepted and the exam is not recorded as failed?",
  "What is the procedure after failing an exam, including registration for the repeat exam, the time limit for retaking it, and the consequences of failing the same exam again?",
  "I currently have 85 CP and have already found a professor who is willing to supervise my Master's thesis. Can I register and start the thesis now, or do I first need to complete more credits?",
  "A company has offered me a Master's thesis topic. What do I need to arrange with FIN before I start working on the thesis?",
  "What is the maximum extension permitted for a Master's thesis when circumstances beyond the student's control prevent completion within the normal 22-week period?",
  "Where can HiWi positions be found, and what can be done if a preferred research group currently has no advertised vacancy?",
  "I already have a part-time student job and have now been offered another student job. Can I work both jobs at the same time, and how can I check whether the combined working time is allowed under my residence permit?",
  "I have moved into a WG where one of my roommates already pays the Rundfunkbeitrag for the apartment. Do I also need to register or pay separately?",
  "I recently moved to Magdeburg and I don't have a Hausarzt yet. How can I find a doctor, preferably one who can communicate in English?",
  "What is the process for extending a student visa in Magdeburg, when should the process be started, where can the appointment be booked, and which documents are required?"
]);

export const QUESTIONNAIRE_VERSION = "1.0";

export function isAnswered(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function countAnswered(answers) {
  return Array.isArray(answers) ? answers.filter(isAnswered).length : 0;
}

export function validateSubmission(payload) {
  if (!payload || !Array.isArray(payload.answers)) {
    return { valid: false, message: "Answers are required." };
  }

  if (payload.answers.length !== QUESTIONS.length) {
    return { valid: false, message: `Please answer all ${QUESTIONS.length} questions.` };
  }

  const missingIndex = payload.answers.findIndex((answer) => !isAnswered(answer));
  if (missingIndex !== -1) {
    return { valid: false, message: `Question ${missingIndex + 1} still needs an answer.` };
  }

  if (payload.confirmed !== true) {
    return { valid: false, message: "Confirmation is required before submitting." };
  }

  return { valid: true, message: "Ready to submit." };
}
