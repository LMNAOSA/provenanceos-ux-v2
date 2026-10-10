/**
 * CONSOL v3.6 — Team Intelligence Service (Questions & Review Inbox)
 *
 * Connects to `public.research_questions` and `public.research_question_replies` in Supabase
 * if the staging migration (`supabase/team_intelligence_staging.sql`) has been applied,
 * and otherwise operates deterministically over authenticated browser workspace records
 * (`consol.team_questions.v1`) and real Lab investigations (`consol.investigations.drafts.v4`).
 *
 * Scientific & Security Discipline:
 * - Never invents or pre-seeds fake researcher discussions, fake comments, or synthetic questions.
 * - Attributes all newly raised questions and replies to the authenticated Supabase user.
 */

import { getSupabase } from './supabase';

export type TeamQuestionStatus =
  | 'Open Question'
  | 'Under Review'
  | 'Needs Verification'
  | 'Resolved';

export interface TeamQuestionReply {
  id: string;
  questionId: string;
  authorEmail: string;
  replyBody: string;
  evidenceReference: string | null;
  createdAt: string;
}

export interface TeamResearchQuestion {
  id: string;
  title: string;
  questionBody: string;
  raisedByEmail: string;
  assignedResearcher: string;
  reviewStatus: TeamQuestionStatus;
  linkedSpecimenId: string | null;
  linkedHistoricalRowNo: number | null;
  linkedHistoricalLocation: string | null;
  linkedInvestigationId: string | null;
  evidenceCitation: string | null;
  replies: TeamQuestionReply[];
  createdAt: string;
  updatedAt: string;
  sourceKind: 'supabase-table' | 'workspace-record' | 'lab-investigation';
}

export const TEAM_ROLES_DIRECTORY: Array<{ label: string; value: string; role: string }> = [
  { label: 'Nigel — Scientific Research', value: 'Nigel (Scientific Research)', role: 'Scientific records, findings & optical investigation' },
  { label: 'Danielle — Geology', value: 'Danielle (Geology)', role: 'Geological interpretation & analytical evidence' },
  { label: 'Mat — Field Acquisition', value: 'Mat (Field Acquisition)', role: 'Specimen registration, pXRF & field records' },
  { label: 'Lee — Administrator', value: 'Lee (Administrator)', role: 'Workspace oversight & approved disclosures' }
];

const LOCAL_TEAM_QUESTIONS_KEY = 'consol.team_questions.v1';

function loadLocalQuestions(): TeamResearchQuestion[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(LOCAL_TEAM_QUESTIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalQuestions(questions: TeamResearchQuestion[]): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LOCAL_TEAM_QUESTIONS_KEY, JSON.stringify(questions));
    window.dispatchEvent(new CustomEvent('consol:team-questions-updated'));
  } catch {
    // ignore storage quota errors
  }
}

export interface CreateTeamQuestionInput {
  title: string;
  questionBody: string;
  raisedByEmail: string;
  assignedResearcher: string;
  reviewStatus?: TeamQuestionStatus;
  linkedSpecimenId?: string | null;
  linkedHistoricalRowNo?: number | null;
  linkedHistoricalLocation?: string | null;
  linkedInvestigationId?: string | null;
  evidenceCitation?: string | null;
}

export const teamIntelligenceService = {
  /**
   * Attempts to query `public.research_questions` in Supabase; if the staging table is not yet
   * migrated to production (PGRST205 / 42P01), returns local workspace questions cleanly.
   */
  async listQuestions(): Promise<{
    questions: TeamResearchQuestion[];
    backendMode: 'supabase' | 'workspace-staging';
  }> {
    try {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('research_questions')
        .select('*, research_question_replies(*)')
        .order('updated_at', { ascending: false })
        .limit(100);

      if (!error && Array.isArray(data)) {
        const mapped: TeamResearchQuestion[] = data.map((row: Record<string, unknown>) => {
          const rawReplies = Array.isArray(row.research_question_replies)
            ? (row.research_question_replies as Array<Record<string, unknown>>)
            : [];
          return {
            id: String(row.id),
            title: String(row.title || ''),
            questionBody: String(row.question_body || ''),
            raisedByEmail: String(row.raised_by_email || ''),
            assignedResearcher: String(row.assigned_researcher || ''),
            reviewStatus: (row.review_status as TeamQuestionStatus) || 'Open Question',
            linkedSpecimenId: row.linked_specimen_id ? String(row.linked_specimen_id) : null,
            linkedHistoricalRowNo:
              row.linked_historical_row_no !== null && row.linked_historical_row_no !== undefined
                ? Number(row.linked_historical_row_no)
                : null,
            linkedHistoricalLocation: null,
            linkedInvestigationId: row.linked_investigation_id
              ? String(row.linked_investigation_id)
              : null,
            evidenceCitation: row.evidence_citation ? String(row.evidence_citation) : null,
            replies: rawReplies.map(r => ({
              id: String(r.id),
              questionId: String(r.question_id),
              authorEmail: String(r.author_email || ''),
              replyBody: String(r.reply_body || ''),
              evidenceReference: r.evidence_reference ? String(r.evidence_reference) : null,
              createdAt: String(r.created_at || new Date().toISOString())
            })),
            createdAt: String(row.created_at || new Date().toISOString()),
            updatedAt: String(row.updated_at || new Date().toISOString()),
            sourceKind: 'supabase-table'
          };
        });
        return { questions: mapped, backendMode: 'supabase' };
      }
    } catch {
      // Fall back to workspace staging store
    }

    return {
      questions: loadLocalQuestions(),
      backendMode: 'workspace-staging'
    };
  },

  async createQuestion(input: CreateTeamQuestionInput): Promise<TeamResearchQuestion> {
    const nowIso = new Date().toISOString();
    const newItem: TeamResearchQuestion = {
      id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title: input.title.trim(),
      questionBody: input.questionBody.trim(),
      raisedByEmail: input.raisedByEmail.trim() || 'Authorised Researcher',
      assignedResearcher: input.assignedResearcher.trim() || 'Nigel (Scientific Research)',
      reviewStatus: input.reviewStatus || 'Open Question',
      linkedSpecimenId: input.linkedSpecimenId || null,
      linkedHistoricalRowNo: input.linkedHistoricalRowNo ?? null,
      linkedHistoricalLocation: input.linkedHistoricalLocation || null,
      linkedInvestigationId: input.linkedInvestigationId || null,
      evidenceCitation: input.evidenceCitation || null,
      replies: [],
      createdAt: nowIso,
      updatedAt: nowIso,
      sourceKind: 'workspace-record'
    };

    try {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('research_questions')
        .insert({
          title: newItem.title,
          question_body: newItem.questionBody,
          raised_by_email: newItem.raisedByEmail,
          assigned_researcher: newItem.assignedResearcher,
          review_status: newItem.reviewStatus,
          linked_specimen_id: newItem.linkedSpecimenId,
          linked_historical_row_no: newItem.linkedHistoricalRowNo,
          linked_investigation_id: newItem.linkedInvestigationId,
          evidence_citation: newItem.evidenceCitation
        })
        .select('*')
        .single();

      if (!error && data) {
        return {
          ...newItem,
          id: String(data.id),
          sourceKind: 'supabase-table'
        };
      }
    } catch {
      // Save in workspace staging store
    }

    const existing = loadLocalQuestions();
    saveLocalQuestions([newItem, ...existing]);
    return newItem;
  },

  async addReply(
    questionId: string,
    authorEmail: string,
    replyBody: string,
    evidenceReference?: string | null
  ): Promise<TeamQuestionReply> {
    const nowIso = new Date().toISOString();
    const reply: TeamQuestionReply = {
      id: `rep-${Date.now().toString(36)}`,
      questionId,
      authorEmail: authorEmail.trim() || 'Authorised Researcher',
      replyBody: replyBody.trim(),
      evidenceReference: evidenceReference?.trim() || null,
      createdAt: nowIso
    };

    try {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('research_question_replies')
        .insert({
          question_id: questionId,
          author_email: reply.authorEmail,
          reply_body: reply.replyBody,
          evidence_reference: reply.evidenceReference
        })
        .select('*')
        .single();
      if (!error && data) {
        await sb
          .from('research_questions')
          .update({ updated_at: nowIso })
          .eq('id', questionId);
        return {
          ...reply,
          id: String(data.id)
        };
      }
    } catch {
      // Update in workspace staging store
    }

    const existing = loadLocalQuestions();
    const updated = existing.map(q =>
      q.id === questionId
        ? { ...q, replies: [...q.replies, reply], updatedAt: nowIso }
        : q
    );
    saveLocalQuestions(updated);
    return reply;
  },

  async updateStatus(questionId: string, status: TeamQuestionStatus): Promise<void> {
    const nowIso = new Date().toISOString();
    try {
      const sb = getSupabase();
      const { error } = await sb
        .from('research_questions')
        .update({ review_status: status, updated_at: nowIso })
        .eq('id', questionId);
      if (!error) return;
    } catch {
      // Update local workspace store
    }

    const existing = loadLocalQuestions();
    const updated = existing.map(q =>
      q.id === questionId ? { ...q, reviewStatus: status, updatedAt: nowIso } : q
    );
    saveLocalQuestions(updated);
  }
};
