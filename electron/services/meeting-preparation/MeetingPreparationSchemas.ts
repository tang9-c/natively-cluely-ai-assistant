import { z } from 'zod';

const contextFieldSchema = z.object({
  value: z.string().max(500),
  state: z.enum(['confirmed', 'needs_confirmation']),
});

export const meetingContextSchema = z.object({
  topic: contextFieldSchema,
  customer: contextFieldSchema,
  participants: z
    .array(
      z.object({
        name: z.string().max(200),
        role: z.string().max(200),
      }),
    )
    .max(30),
  goal: contextFieldSchema,
  agenda: z.array(z.string().max(500)).max(20),
  background: z.string().max(5000),
});

type MeetingContext = z.infer<typeof meetingContextSchema>;

const emptyContextField = () => ({ value: '', state: 'needs_confirmation' as const });

const normalizeContextField = (input: unknown): MeetingContext['topic'] => {
  if (typeof input === 'string') {
    return { value: input.slice(0, 500), state: 'needs_confirmation' };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return emptyContextField();

  const field = input as Record<string, unknown>;
  return {
    value: typeof field.value === 'string' ? field.value.slice(0, 500) : '',
    state: field.state === 'confirmed' || field.state === 'needs_confirmation'
      ? field.state
      : 'needs_confirmation',
  };
};

const fallbackMeetingContext = (rawInput: string): MeetingContext => ({
  topic: { value: rawInput.slice(0, 500), state: 'needs_confirmation' },
  customer: emptyContextField(),
  participants: [],
  goal: emptyContextField(),
  agenda: [],
  background: '',
});

export const modeRecommendationSchema = z.object({
  templateType: z.enum(['sales', 'fde', 'recruiting', 'team-meet']),
  reason: z.string().min(1).max(1000),
  focus: z.string().min(1).max(1000),
});

export const predictedQuestionSchema = z.object({
  question: z.string().min(1).max(1000),
  keyMomentType: z.string().min(1).max(200),
  rationale: z.array(z.string().max(500)).max(6),
  knowledgeRequirements: z.array(z.string().max(500)).max(10),
  requiresInternalEvidence: z.boolean(),
});

export type PredictedQuestion = z.infer<typeof predictedQuestionSchema>;

export const evidenceRequirementSchema = z.object({
  knowledgeRequirements: z.array(z.string().max(500)).max(10),
  requiresInternalEvidence: z.boolean(),
});

export const predictedQuestionsSchema = z.object({
  questions: z.array(predictedQuestionSchema).max(3),
});

export const generationBundleSchema = z.object({
  historySummary: z.array(z.string().max(1000)).max(10),
  commitments: z.array(z.object({ text: z.string().min(1).max(1000) })).max(10),
  questions: z.array(predictedQuestionSchema).max(3),
});

export const evidenceCoverageSchema = z.object({
  coverage: z.enum(['sufficient', 'partial']),
  supported: z.array(z.string().max(1000)).max(10),
  missing: z.array(z.string().max(1000)).max(10),
  limitations: z.array(z.string().max(1000)).max(10),
  citedChunkIds: z.array(z.number().int().nonnegative()).max(20),
  handlingScript: z.string().max(2000),
  followupQuestions: z.array(z.string().max(1000)).max(10),
});

const unwrapJson = (raw: string): string => {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);

  return trimmed;
};

export const parseMeetingContext = (raw: string, rawInput: string): MeetingContext => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapJson(raw));
  } catch {
    return fallbackMeetingContext(rawInput);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fallbackMeetingContext(rawInput);
  }

  const context = parsed as Record<string, unknown>;
  const participants = Array.isArray(context.participants)
    ? context.participants
        .filter((participant): participant is Record<string, unknown> =>
          Boolean(participant) && typeof participant === 'object' && !Array.isArray(participant))
        .filter((participant) =>
          typeof participant.name === 'string' && typeof participant.role === 'string')
        .slice(0, 30)
        .map((participant) => ({
          name: (participant.name as string).slice(0, 200),
          role: (participant.role as string).slice(0, 200),
        }))
    : [];
  const agenda = Array.isArray(context.agenda)
    ? context.agenda
        .filter((item): item is string => typeof item === 'string')
        .slice(0, 20)
        .map((item) => item.slice(0, 500))
    : [];

  return meetingContextSchema.parse({
    topic: normalizeContextField(context.topic),
    customer: normalizeContextField(context.customer),
    participants,
    goal: normalizeContextField(context.goal),
    agenda,
    background: typeof context.background === 'string'
      ? context.background.slice(0, 5000)
      : '',
  });
};

export const extractAndParse = <T>(raw: string, schema: z.ZodType<T>): T =>
  schema.parse(JSON.parse(unwrapJson(raw)));
