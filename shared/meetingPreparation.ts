export type MeetingPreparationStatus = 'draft' | 'ready';
export type MeetingPreparationInputMethod = 'voice' | 'text';
export type MeetingPreparationTemplateType = 'sales' | 'fde';
export type FieldState = 'confirmed' | 'needs_confirmation';
export type EvidenceStatus = 'sufficient' | 'partial' | 'missing' | 'not_needed';
export type PreparationOperation = 'parse' | 'prepare_context' | 'generate' | 'recheck';

export interface MeetingContextField {
  value: string;
  state: FieldState;
}

export interface MeetingContext {
  topic: MeetingContextField;
  customer: MeetingContextField;
  participants: Array<{ name: string; role: string }>;
  goal: MeetingContextField;
  agenda: string[];
  background: string;
}

export interface ModeRecommendation {
  modeId: string;
  templateType: MeetingPreparationTemplateType;
  label: string;
  reason: string;
  focus: string;
}

export interface HistoryCandidate {
  id: string;
  title: string;
  date: string;
  summary: string;
  matchReason: string;
}

export interface EvidenceCitation {
  sourceType: 'uploaded_material';
  sourceId: string;
  title: string;
  chunkId: number;
}

export interface PreparationEvidence {
  knowledgeRequirements: string[];
  supported: string[];
  missing: string[];
  limitations: string[];
  citations: EvidenceCitation[];
  handlingScript: string;
  followupQuestions: string[];
  checkError?: 'check_failed';
}

export interface PreparationQuestion {
  id: string;
  sortOrder: number;
  question: string;
  keyMomentType: string;
  rationale: string[];
  evidenceStatus: EvidenceStatus | null;
  evidence: PreparationEvidence;
  checkedAt: string | null;
}

export interface MeetingPreparationResult {
  modeRecommendation: ModeRecommendation | null;
  historySummary: string[];
  commitments: Array<{
    text: string;
    sourceMeetingId: string;
    status: 'needs_confirmation' | 'completed' | 'pending' | 'not_needed';
  }>;
}

export interface MeetingPreparationRecord {
  id: string;
  status: MeetingPreparationStatus;
  rawInput: string;
  inputMethod: MeetingPreparationInputMethod;
  meetingContext: MeetingContext | null;
  selectedModeId: string | null;
  linkedMeetingId: string | null;
  result: MeetingPreparationResult;
  questions: PreparationQuestion[];
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingPreparationSaveInput {
  id?: string;
  status?: MeetingPreparationStatus;
  rawInput: string;
  inputMethod: MeetingPreparationInputMethod;
  meetingContext?: MeetingContext | null;
  selectedModeId?: string | null;
  linkedMeetingId?: string | null;
  result?: MeetingPreparationResult;
  questions?: PreparationQuestion[];
}

export interface PrepareContextResult {
  modeRecommendation: ModeRecommendation;
  historyCandidates: HistoryCandidate[];
  historyUnavailable: boolean;
}

export type MeetingPreparationOperationResult<T> =
  | { success: true; result: T }
  | { success: false; error: 'busy' | 'cancelled' | 'invalid_output' | 'failed' };

export interface MeetingPreparationApi {
  meetingPreparationSave(input: MeetingPreparationSaveInput): Promise<MeetingPreparationRecord>;
  meetingPreparationGet(id: string): Promise<MeetingPreparationRecord | null>;
  meetingPreparationList(): Promise<MeetingPreparationRecord[]>;
  meetingPreparationDelete(id: string): Promise<{ success: true }>;
  meetingPreparationParseInput(input: {
    id: string;
    rawInput: string;
  }): Promise<MeetingPreparationOperationResult<MeetingContext>>;
  meetingPreparationPrepareContext(input: {
    id: string;
    context: MeetingContext;
  }): Promise<MeetingPreparationOperationResult<PrepareContextResult>>;
  meetingPreparationGenerate(id: string): Promise<MeetingPreparationOperationResult<MeetingPreparationRecord>>;
  meetingPreparationRecheckQuestion(input: {
    preparationId: string;
    questionId: string;
  }): Promise<MeetingPreparationOperationResult<MeetingPreparationRecord>>;
  meetingPreparationApplyMode(id: string): Promise<{ success: true }>;
  meetingPreparationCancelOperation(id: string): Promise<{ success: boolean }>;
  meetingPreparationDictationStart(): Promise<{ success: true }>;
  meetingPreparationDictationStop(): Promise<{ success: true }>;
  meetingPreparationDictationCancel(): Promise<{ success: true }>;
  onMeetingPreparationDictationTranscript(
    callback: (payload: { text: string; final: boolean; timestamp: number }) => void,
  ): () => void;
}
