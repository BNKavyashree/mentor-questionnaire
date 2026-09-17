-- Run in the Supabase SQL Editor, then download the result as CSV.
-- Question columns follow the order in public/questionnaire.js.
select
  id as submission_id,
  submitted_at,
  questionnaire_version,
  no_ai_confirmed,
  started_at,
  completed_at,
  answers ->> 0 as q01,
  answers ->> 1 as q02,
  answers ->> 2 as q03,
  answers ->> 3 as q04,
  answers ->> 4 as q05,
  answers ->> 5 as q06,
  answers ->> 6 as q07,
  answers ->> 7 as q08,
  answers ->> 8 as q09,
  answers ->> 9 as q10,
  answers ->> 10 as q11,
  answers ->> 11 as q12,
  answers ->> 12 as q13,
  answers ->> 13 as q14,
  answers ->> 14 as q15,
  answers ->> 15 as q16,
  answers ->> 16 as q17,
  answers ->> 17 as q18,
  answers ->> 18 as q19,
  answers ->> 19 as q20
from public.mentor_submissions
order by submitted_at;
