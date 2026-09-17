import { createClient } from '@supabase/supabase-js';

import {
  QUESTIONS,
  QUESTIONNAIRE_VERSION,
  isAnswered,
} from '../public/questionnaire.js';

const MAXIMUM_BODY_BYTES = 1_000_000;
const DEFAULT_TABLE = 'mentor_submissions';
const ALLOWED_FIELDS = new Set(['answers', 'confirmed', 'metadata']);
const ALLOWED_METADATA_FIELDS = new Set([
  'questionnaireVersion',
  'startedAt',
  'completedAt',
]);

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

function jsonResponse(status, body) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

function errorResponse(status, code, message) {
  return jsonResponse(status, { error: { code, message } });
}

function parseDeclaredLength(request) {
  const value = request.headers.get('content-length');
  if (value === null) return null;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new HttpError(
      400,
      'invalid_content_length',
      'Content-Length must be a non-negative integer.',
    );
  }
  return parsed;
}

function normaliseTimestamp(metadata, field) {
  const value = metadata[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(
      400,
      'validation_error',
      `metadata.${field} must be an ISO date-time string when provided.`,
    );
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(
      400,
      'validation_error',
      `metadata.${field} must be a valid ISO date-time string.`,
    );
  }
  return date.toISOString();
}

function validateMetadata(value) {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(
      400,
      'validation_error',
      'metadata must be an object when provided.',
    );
  }

  const unknownFields = Object.keys(value).filter(
    (field) => !ALLOWED_METADATA_FIELDS.has(field),
  );
  if (unknownFields.length > 0) {
    throw new HttpError(
      400,
      'validation_error',
      `Unknown metadata field${unknownFields.length === 1 ? '' : 's'}: ${unknownFields.join(', ')}.`,
    );
  }

  if (
    value.questionnaireVersion !== undefined &&
    value.questionnaireVersion !== QUESTIONNAIRE_VERSION
  ) {
    throw new HttpError(
      409,
      'questionnaire_version_mismatch',
      'This questionnaire has changed. Please reload the page before submitting.',
    );
  }

  return {
    startedAt: normaliseTimestamp(value, 'startedAt'),
    completedAt: normaliseTimestamp(value, 'completedAt'),
  };
}

function validateSubmission(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(
      400,
      'validation_error',
      'The JSON body must be an object.',
    );
  }

  const unknownFields = Object.keys(value).filter(
    (field) => !ALLOWED_FIELDS.has(field),
  );
  if (unknownFields.length > 0) {
    throw new HttpError(
      400,
      'validation_error',
      `Unknown field${unknownFields.length === 1 ? '' : 's'}: ${unknownFields.join(', ')}.`,
    );
  }

  if (!Array.isArray(value.answers) || value.answers.length !== QUESTIONS.length) {
    throw new HttpError(
      400,
      'validation_error',
      `answers must contain exactly ${QUESTIONS.length} responses.`,
    );
  }

  const missingIndex = value.answers.findIndex((answer) => !isAnswered(answer));
  if (missingIndex !== -1) {
    throw new HttpError(
      400,
      'validation_error',
      `Question ${missingIndex + 1} requires a response.`,
    );
  }

  if (value.confirmed !== true) {
    throw new HttpError(
      400,
      'validation_error',
      'Confirmation is required before submitting.',
    );
  }

  const metadata = validateMetadata(value.metadata);
  if (
    metadata.startedAt !== null &&
    metadata.completedAt !== null &&
    metadata.completedAt < metadata.startedAt
  ) {
    throw new HttpError(
      400,
      'validation_error',
      'The completion time cannot be earlier than the start time.',
    );
  }

  return {
    questionnaire_version: QUESTIONNAIRE_VERSION,
    answers: [...value.answers],
    no_ai_confirmed: true,
    started_at: metadata.startedAt,
    completed_at: metadata.completedAt,
  };
}

async function parseSubmission(request) {
  const mediaType = (request.headers.get('content-type') || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== 'application/json') {
    throw new HttpError(
      415,
      'unsupported_media_type',
      'Content-Type must be application/json.',
    );
  }

  const declaredLength = parseDeclaredLength(request);
  if (declaredLength !== null && declaredLength > MAXIMUM_BODY_BYTES) {
    throw new HttpError(
      413,
      'payload_too_large',
      `The request body must not exceed ${MAXIMUM_BODY_BYTES} bytes.`,
    );
  }

  let text;
  try {
    text = await request.text();
  } catch {
    throw new HttpError(400, 'request_error', 'The request body could not be read.');
  }

  if (new TextEncoder().encode(text).byteLength > MAXIMUM_BODY_BYTES) {
    throw new HttpError(
      413,
      'payload_too_large',
      `The request body must not exceed ${MAXIMUM_BODY_BYTES} bytes.`,
    );
  }
  if (text.length === 0) {
    throw new HttpError(400, 'invalid_json', 'The JSON body must not be empty.');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'The request body is not valid JSON.');
  }

  return validateSubmission(parsed);
}

function readConfiguration(env) {
  const url = env.SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  const table = env.MENTOR_SUBMISSIONS_TABLE?.trim() || DEFAULT_TABLE;

  if (!url || !secretKey) {
    throw new HttpError(
      503,
      'storage_not_configured',
      'Submission storage is not configured.',
    );
  }
  if (!/^https:\/\/[^/]+\.supabase\.co\/?$/i.test(url)) {
    throw new HttpError(
      503,
      'storage_not_configured',
      'Submission storage is not configured correctly.',
    );
  }
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
    throw new HttpError(
      503,
      'storage_not_configured',
      'The submission table name is invalid.',
    );
  }

  return { url: url.replace(/\/$/, ''), secretKey, table };
}

export function createSubmissionHandler({
  env = process.env,
  createClientFn = createClient,
  logger = console,
} = {}) {
  return async function handleSubmission(request) {
    if (request.method !== 'POST') {
      return errorResponse(405, 'method_not_allowed', 'Only POST is allowed.');
    }

    try {
      const configuration = readConfiguration(env);
      const record = await parseSubmission(request);
      const supabase = createClientFn(
        configuration.url,
        configuration.secretKey,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        },
      );

      const { data, error } = await supabase
        .from(configuration.table)
        .insert(record)
        .select('submitted_at')
        .single();

      if (error) {
        logger.error('Supabase submission insert failed.', {
          code: error.code,
          message: error.message,
        });
        return errorResponse(
          503,
          'storage_unavailable',
          'Responses could not be stored. Please try again.',
        );
      }

      return jsonResponse(201, { submittedAt: data.submitted_at });
    } catch (error) {
      if (error instanceof HttpError) {
        return errorResponse(error.status, error.code, error.message);
      }

      logger.error('Unexpected submission error.', {
        name: error?.name,
        message: error?.message,
      });
      return errorResponse(
        500,
        'internal_error',
        'The server could not process the submission.',
      );
    }
  };
}

const handleSubmission = createSubmissionHandler();

export function POST(request) {
  return handleSubmission(request);
}

export function GET(request) {
  return handleSubmission(request);
}
