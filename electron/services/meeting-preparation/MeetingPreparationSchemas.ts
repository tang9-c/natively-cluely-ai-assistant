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

export const modeRecommendationSchema = z.object({
  templateType: z.enum(['sales', 'fde']),
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

export const extractAndParse = <T>(raw: string, schema: z.ZodType<T>): T =>
  schema.parse(JSON.parse(unwrapJson(raw)));
