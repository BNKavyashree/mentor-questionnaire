import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GET,
  createSubmissionHandler,
} from '../api/submissions.mjs';
import {
  QUESTIONS,
  QUESTIONNAIRE_VERSION,
} from '../public/questionnaire.js';

const TEST_ENV = {
  SUPABASE_URL: 'https://example-project.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test_only',
  MENTOR_SUBMISSIONS_TABLE: 'mentor_submissions',
};

function payload(overrides = {}) {
  return {
    answers: QUESTIONS.map((_, index) => `Mentor response ${index + 1}`),
    confirmed: true,
    metadata: {
      questionnaireVersion: QUESTIONNAIRE_VERSION,
      startedAt: '2026-09-17T08:00:00.000Z',
      completedAt: '2026-09-17T09:00:00.000Z',
    },
    ...overrides,
  };
}

function requestWith(body, options = {}) {
  return new Request('https://questionnaire.example/api/submissions', {
    method: options.method || 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...options.headers,
    },
    body: body === undefined ? undefined : body,
  });
}

function supabaseMock({
  data = { submitted_at: '2026-09-17T09:00:01.000Z' },
  error = null,
} = {}) {
  const calls = {};
  const createClientFn = (url, key, options) => {
    calls.client = { url, key, options };
    return {
      from(table) {
        calls.table = table;
        return {
          insert(record) {
            calls.record = record;
            return {
              select(columns) {
                calls.columns = columns;
                return {
                  async single() {
                    return { data, error };
                  },
                };
              },
            };
          },
        };
      },
    };
  };

  return { calls, createClientFn };
}

async function responseJson(response) {
  return { response, body: await response.json() };
}

test('the Vercel endpoint stores a complete, confirmed submission', async () => {
  const mock = supabaseMock();
  const handler = createSubmissionHandler({
    env: TEST_ENV,
    createClientFn: mock.createClientFn,
    logger: { error() {} },
  });

  const result = await responseJson(
    await handler(requestWith(JSON.stringify(payload()))),
  );

  assert.equal(result.response.status, 201);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(result.body, {
    submittedAt: '2026-09-17T09:00:01.000Z',
  });
  assert.equal(mock.calls.client.url, TEST_ENV.SUPABASE_URL);
  assert.equal(mock.calls.client.key, TEST_ENV.SUPABASE_SECRET_KEY);
  assert.deepEqual(mock.calls.client.options.auth, {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });
  assert.equal(mock.calls.table, 'mentor_submissions');
  assert.equal(mock.calls.columns, 'submitted_at');
  assert.deepEqual(mock.calls.record, {
    questionnaire_version: QUESTIONNAIRE_VERSION,
    answers: payload().answers,
    no_ai_confirmed: true,
    started_at: '2026-09-17T08:00:00.000Z',
    completed_at: '2026-09-17T09:00:00.000Z',
  });
});

test('every answer and the final confirmation are enforced server-side', async () => {
  const mock = supabaseMock();
  const handler = createSubmissionHandler({
    env: TEST_ENV,
    createClientFn: mock.createClientFn,
    logger: { error() {} },
  });

  for (let index = 0; index < QUESTIONS.length; index += 1) {
    const incomplete = payload();
    incomplete.answers[index] = index % 2 === 0 ? '' : '   ';
    const { response, body } = await responseJson(
      await handler(requestWith(JSON.stringify(incomplete))),
    );
    assert.equal(response.status, 400);
    assert.match(body.error.message, new RegExp(`Question ${index + 1}`));
  }

  const unconfirmed = await responseJson(
    await handler(requestWith(JSON.stringify(payload({ confirmed: false })))),
  );
  assert.equal(unconfirmed.response.status, 400);
  assert.match(unconfirmed.body.error.message, /Confirmation is required/);
  assert.equal(mock.calls.record, undefined);
});

test('stale questionnaire versions and invalid timestamps are rejected', async () => {
  const handler = createSubmissionHandler({
    env: TEST_ENV,
    createClientFn: supabaseMock().createClientFn,
    logger: { error() {} },
  });

  const stale = payload();
  stale.metadata.questionnaireVersion = 'old-version';
  const staleResult = await responseJson(
    await handler(requestWith(JSON.stringify(stale))),
  );
  assert.equal(staleResult.response.status, 409);
  assert.equal(staleResult.body.error.code, 'questionnaire_version_mismatch');

  const invalidDate = payload();
  invalidDate.metadata.completedAt = 'not-a-date';
  const invalidResult = await responseJson(
    await handler(requestWith(JSON.stringify(invalidDate))),
  );
  assert.equal(invalidResult.response.status, 400);
  assert.match(invalidResult.body.error.message, /valid ISO date-time/);

  const reversed = payload();
  reversed.metadata.startedAt = '2026-09-17T10:00:00.000Z';
  const reversedResult = await responseJson(
    await handler(requestWith(JSON.stringify(reversed))),
  );
  assert.equal(reversedResult.response.status, 400);
  assert.match(reversedResult.body.error.message, /earlier than the start time/);
});

test('the endpoint rejects unsupported, malformed, and oversized requests', async () => {
  const handler = createSubmissionHandler({
    env: TEST_ENV,
    createClientFn: supabaseMock().createClientFn,
    logger: { error() {} },
  });

  const wrongType = await handler(
    requestWith('{}', { headers: { 'Content-Type': 'text/plain' } }),
  );
  assert.equal(wrongType.status, 415);

  const malformed = await handler(requestWith('{'));
  assert.equal(malformed.status, 400);

  const oversized = await handler(
    requestWith('{}', { headers: { 'Content-Length': '1000001' } }),
  );
  assert.equal(oversized.status, 413);

  const methodResult = await responseJson(
    await GET(new Request('https://questionnaire.example/api/submissions')),
  );
  assert.equal(methodResult.response.status, 405);
  assert.equal(methodResult.body.error.code, 'method_not_allowed');
});

test('missing configuration and database errors fail without losing the draft', async () => {
  const unconfigured = createSubmissionHandler({
    env: {},
    logger: { error() {} },
  });
  const unconfiguredResult = await responseJson(
    await unconfigured(requestWith(JSON.stringify(payload()))),
  );
  assert.equal(unconfiguredResult.response.status, 503);
  assert.equal(unconfiguredResult.body.error.code, 'storage_not_configured');

  const databaseFailure = createSubmissionHandler({
    env: TEST_ENV,
    createClientFn: supabaseMock({
      data: null,
      error: { code: 'PGRST000', message: 'Database unavailable' },
    }).createClientFn,
    logger: { error() {} },
  });
  const databaseResult = await responseJson(
    await databaseFailure(requestWith(JSON.stringify(payload()))),
  );
  assert.equal(databaseResult.response.status, 503);
  assert.equal(databaseResult.body.error.code, 'storage_unavailable');
  assert.doesNotMatch(JSON.stringify(databaseResult.body), /Database unavailable/);
});
