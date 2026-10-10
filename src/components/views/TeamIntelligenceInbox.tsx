/**
 * CONSOL v3.6 — Team Intelligence: Questions & Review Inbox (Priority 4)
 *
 * Displays real researcher questions, assigned reviewers, linked specimens/historical records/investigations,
 * replies, evidence citations, review status, and "Questions Requiring My Attention".
 *
 * Never invents or pre-seeds fabricated researcher discussions.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  teamIntelligenceService,
  TEAM_ROLES_DIRECTORY,
  type TeamResearchQuestion,
  type TeamQuestionStatus,
  type CreateTeamQuestionInput
} from '../../services/teamIntelligence';
import type { HistoricalRecord, SpecimenOverview } from '../../types';
import type { InvestigationRecord } from './TheLabView';

export interface TeamIntelligenceInboxProps {
  currentUserEmail: string | null;
  historicalRecords: HistoricalRecord[];
  specimens: SpecimenOverview[];
  investigations: InvestigationRecord[];
  prefillDraft?: {
    title: string;
    questionBody: string;
    linkedHistoricalRowNo?: number | null;
    linkedHistoricalLocation?: string | null;
    linkedSpecimenId?: string | null;
    evidenceCitation?: string | null;
  } | null;
  onClearPrefillDraft?: () => void;
  onInspectHistoricalRow?: (rowNo: number) => void;
  onOpenSpecimen?: (specimenId: string) => void;
  onOpenInvestigation?: (investigationId: string) => void;
  onClose?: () => void;
}

type InboxFilter = 'ATTENTION' | 'OPEN' | 'REVIEW' | 'RESOLVED' | 'ALL';

export const TeamIntelligenceInbox: React.FC<TeamIntelligenceInboxProps> = ({
  currentUserEmail,
  historicalRecords,
  specimens,
  investigations,
  prefillDraft,
  onClearPrefillDraft,
  onInspectHistoricalRow,
  onOpenSpecimen,
  onOpenInvestigation,
  onClose
}) => {
  const [questions, setQuestions] = useState<TeamResearchQuestion[]>([]);
  const [backendMode, setBackendMode] = useState<'supabase' | 'workspace-staging'>('workspace-staging');
  const [filter, setFilter] = useState<InboxFilter>('ALL');
  const [composerOpen, setComposerOpen] = useState(false);
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);

  // New Question Composer State
  const [title, setTitle] = useState('');
  const [questionBody, setQuestionBody] = useState('');
  const [assignedResearcher, setAssignedResearcher] = useState(TEAM_ROLES_DIRECTORY[0].value);
  const [linkedRowNo, setLinkedRowNo] = useState<string>('');
  const [linkedSpecimenId, setLinkedSpecimenId] = useState<string>('');
  const [linkedInvestigationId, setLinkedInvestigationId] = useState<string>('');
  const [evidenceCitation, setEvidenceCitation] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  // Reply Composer State
  const [replyText, setReplyText] = useState('');
  const [replyEvidence, setReplyEvidence] = useState('');

  const loadQuestions = useCallback(() => {
    teamIntelligenceService.listQuestions().then(({ questions: list, backendMode: mode }) => {
      setQuestions(list);
      setBackendMode(mode);
    });
  }, []);

  useEffect(() => {
    loadQuestions();
    const onUpdate = () => loadQuestions();
    window.addEventListener('consol:team-questions-updated', onUpdate);
    return () => window.removeEventListener('consol:team-questions-updated', onUpdate);
  }, [loadQuestions]);

  // Open composer automatically when Ask CONSOL triggers a prefilled question draft
  useEffect(() => {
    if (prefillDraft) {
      setTitle(prefillDraft.title);
      setQuestionBody(prefillDraft.questionBody);
      setLinkedRowNo(
        prefillDraft.linkedHistoricalRowNo ? String(prefillDraft.linkedHistoricalRowNo) : ''
      );
      setLinkedSpecimenId(prefillDraft.linkedSpecimenId || '');
      setEvidenceCitation(prefillDraft.evidenceCitation || '');
      setComposerOpen(true);
    }
  }, [prefillDraft]);

  // Combine persisted/workspace questions with real user-created Lab investigation questions
  const unifiedQuestions = useMemo<TeamResearchQuestion[]>(() => {
    const fromLab: TeamResearchQuestion[] = investigations.map(inv => {
      const underReviewRecords = inv.records.filter(r => r.verificationState === 'Under Review');
      const status: TeamQuestionStatus =
        inv.lifecycle === 'Closed'
          ? 'Resolved'
          : inv.lifecycle === 'Under Review' || underReviewRecords.length > 0
            ? 'Under Review'
            : 'Open Question';

      return {
        id: `lab-${inv.id}`,
        title: inv.title,
        questionBody: inv.question,
        raisedByEmail: inv.responsibleResearcher,
        assignedResearcher: inv.collaborators[0] || inv.responsibleResearcher,
        reviewStatus: status,
        linkedSpecimenId: inv.linkedSpecimenIds[0] || null,
        linkedHistoricalRowNo: null,
        linkedHistoricalLocation: null,
        linkedInvestigationId: inv.id,
        evidenceCitation: inv.relatedSpecimenOrProject || null,
        replies: inv.records.map(r => ({
          id: r.id,
          questionId: `lab-${inv.id}`,
          authorEmail: r.author,
          replyBody: `[${r.recordType} · ${r.verificationState}] ${r.title}: ${r.content}`,
          evidenceReference: r.uncertaintyNote || null,
          createdAt: r.createdAt
        })),
        createdAt: inv.createdAt,
        updatedAt: inv.updatedAt,
        sourceKind: 'lab-investigation'
      };
    });

    return [...questions, ...fromLab].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [questions, investigations]);

  const counts = useMemo(() => {
    const emailLower = (currentUserEmail || '').toLowerCase();
    let attention = 0;
    let open = 0;
    let review = 0;
    let resolved = 0;

    unifiedQuestions.forEach(q => {
      if (q.reviewStatus === 'Resolved') {
        resolved += 1;
      } else if (q.reviewStatus === 'Under Review' || q.reviewStatus === 'Needs Verification') {
        review += 1;
      } else {
        open += 1;
      }

      const isAssignedToMe =
        Boolean(emailLower) &&
        (q.assignedResearcher.toLowerCase().includes(emailLower) ||
          q.raisedByEmail.toLowerCase().includes(emailLower));
      if (
        q.reviewStatus !== 'Resolved' &&
        (isAssignedToMe ||
          q.reviewStatus === 'Under Review' ||
          q.reviewStatus === 'Needs Verification')
      ) {
        attention += 1;
      }
    });

    return { attention, open, review, resolved, total: unifiedQuestions.length };
  }, [unifiedQuestions, currentUserEmail]);

  const filteredQuestions = useMemo(() => {
    const emailLower = (currentUserEmail || '').toLowerCase();
    return unifiedQuestions.filter(q => {
      if (filter === 'OPEN') return q.reviewStatus === 'Open Question';
      if (filter === 'REVIEW') {
        return q.reviewStatus === 'Under Review' || q.reviewStatus === 'Needs Verification';
      }
      if (filter === 'RESOLVED') return q.reviewStatus === 'Resolved';
      if (filter === 'ATTENTION') {
        if (q.reviewStatus === 'Resolved') return false;
        const isMine =
          Boolean(emailLower) &&
          (q.assignedResearcher.toLowerCase().includes(emailLower) ||
            q.raisedByEmail.toLowerCase().includes(emailLower));
        return (
          isMine ||
          q.reviewStatus === 'Under Review' ||
          q.reviewStatus === 'Needs Verification'
        );
      }
      return true;
    });
  }, [unifiedQuestions, filter, currentUserEmail]);

  const handleCreateQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !questionBody.trim()) {
      setFormError('Enter both a question title and the scientific question details.');
      return;
    }

    const rowNum = linkedRowNo ? Number(linkedRowNo) : null;
    const matchedRow = rowNum
      ? historicalRecords.find(r => r.source_row_no === rowNum) || null
      : null;

    const payload: CreateTeamQuestionInput = {
      title: title.trim(),
      questionBody: questionBody.trim(),
      raisedByEmail: currentUserEmail || 'Authorised Researcher',
      assignedResearcher,
      reviewStatus: 'Open Question',
      linkedSpecimenId: linkedSpecimenId || null,
      linkedHistoricalRowNo: rowNum,
      linkedHistoricalLocation: matchedRow?.location || null,
      linkedInvestigationId: linkedInvestigationId || null,
      evidenceCitation: evidenceCitation.trim() || null
    };

    const created = await teamIntelligenceService.createQuestion(payload);
    setTitle('');
    setQuestionBody('');
    setLinkedRowNo('');
    setLinkedSpecimenId('');
    setLinkedInvestigationId('');
    setEvidenceCitation('');
    setFormError(null);
    setComposerOpen(false);
    setExpandedQuestionId(created.id);
    onClearPrefillDraft?.();
    loadQuestions();
  };

  const handleAddReply = async (q: TeamResearchQuestion) => {
    if (!replyText.trim() || q.sourceKind === 'lab-investigation') return;
    await teamIntelligenceService.addReply(
      q.id,
      currentUserEmail || 'Authorised Researcher',
      replyText,
      replyEvidence
    );
    setReplyText('');
    setReplyEvidence('');
    loadQuestions();
  };

  const handleStatusChange = async (q: TeamResearchQuestion, status: TeamQuestionStatus) => {
    if (q.sourceKind === 'lab-investigation') return;
    await teamIntelligenceService.updateStatus(q.id, status);
    loadQuestions();
  };

  return (
    <section className="surface consol-side-card consol-team-inbox" aria-label="Team Intelligence Questions and Review Inbox">
      <div className="surface-head" style={{ marginBottom: 12 }}>
        <div>
          <span className="eyebrow">
            Team Intelligence · {backendMode === 'supabase' ? 'Supabase Synced' : 'Workspace & Lab Synced'}
          </span>
          <h3>Questions &amp; Review Inbox ({counts.total})</h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="consol-row-btn"
            onClick={() => {
              setComposerOpen(v => !v);
              setFormError(null);
            }}
          >
            {composerOpen ? 'Cancel Question' : '＋ Raise Question'}
          </button>
          {onClose && (
            <button
              type="button"
              className="consol-row-btn"
              onClick={onClose}
              title="Stow Team Review Inbox"
            >
              Stow ✕
            </button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="consol-event-filters" role="group" aria-label="Filter team questions">
        {[
          { id: 'ALL' as InboxFilter, label: `All (${counts.total})` },
          { id: 'ATTENTION' as InboxFilter, label: `My Attention (${counts.attention})` },
          { id: 'OPEN' as InboxFilter, label: `Open (${counts.open})` },
          { id: 'REVIEW' as InboxFilter, label: `Review (${counts.review})` },
          { id: 'RESOLVED' as InboxFilter, label: `Resolved (${counts.resolved})` }
        ].map(f => (
          <button
            key={f.id}
            type="button"
            className={`consol-seg-btn ${filter === f.id ? 'active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Raise Question Composer */}
      {composerOpen && (
        <form className="consol-question-composer" onSubmit={handleCreateQuestion}>
          <div className="consol-composer-head">
            <span className="eyebrow">New Scientific Question or Review Request</span>
            <small className="mono-cell">Actor: {currentUserEmail || 'Authenticated Staff'}</small>
          </div>

          {formError && <div className="form-error">{formError}</div>}

          <input
            type="text"
            className="consol-search-input consol-composer-input"
            placeholder="Question title (e.g. Verify Sulfur 7,733.63 ppm anomaly at Allens Rise Record #14)"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />

          <textarea
            className="consol-composer-textarea"
            rows={3}
            placeholder="State the scientific question, analytical observation, or qualification requiring review…"
            value={questionBody}
            onChange={e => setQuestionBody(e.target.value)}
          />

          <div className="consol-composer-grid">
            <label className="hist-select-label">
              <span>Assigned Researcher</span>
              <select
                className="consol-status-select"
                value={assignedResearcher}
                onChange={e => setAssignedResearcher(e.target.value)}
              >
                {TEAM_ROLES_DIRECTORY.map(r => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
                {currentUserEmail && (
                  <option value={currentUserEmail}>{currentUserEmail} (Me)</option>
                )}
              </select>
            </label>

            <label className="hist-select-label">
              <span>Link Historical Record</span>
              <select
                className="consol-status-select"
                value={linkedRowNo}
                onChange={e => setLinkedRowNo(e.target.value)}
              >
                <option value="">None</option>
                {historicalRecords.map(r => (
                  <option key={r.source_row_no} value={String(r.source_row_no)}>
                    Record #{r.source_row_no} · {r.location} (Idx {r.original_index || '—'})
                  </option>
                ))}
              </select>
            </label>

            {specimens.length > 0 && (
              <label className="hist-select-label">
                <span>Link Specimen</span>
                <select
                  className="consol-status-select"
                  value={linkedSpecimenId}
                  onChange={e => setLinkedSpecimenId(e.target.value)}
                >
                  <option value="">None</option>
                  {specimens.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.id} ({s.sample_code})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <input
            type="text"
            className="consol-search-input consol-composer-input"
            placeholder="Supporting evidence citation (e.g. 2018_Historical_XRF_Data.xlsx · Row #14 · S = 7,733.63 ppm ±312.48)"
            value={evidenceCitation}
            onChange={e => setEvidenceCitation(e.target.value)}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              className="consol-row-btn"
              onClick={() => {
                setComposerOpen(false);
                onClearPrefillDraft?.();
              }}
            >
              Cancel
            </button>
            <button type="submit" className="primary consol-action-btn">
              Submit Question
            </button>
          </div>
        </form>
      )}

      {/* Questions List */}
      {filteredQuestions.length > 0 ? (
        <div className="consol-question-list">
          {filteredQuestions.map(q => {
            const isExpanded = expandedQuestionId === q.id;
            const linkedRow =
              q.linkedHistoricalRowNo !== null
                ? historicalRecords.find(r => r.source_row_no === q.linkedHistoricalRowNo)
                : null;

            return (
              <article key={q.id} className="consol-question-item">
                <div
                  className="consol-question-head"
                  onClick={() => setExpandedQuestionId(isExpanded ? null : q.id)}
                >
                  <div className="consol-question-title-wrap">
                    <div className="consol-question-badges">
                      <span
                        className={`consol-q-status status-${q.reviewStatus
                          .toLowerCase()
                          .replace(/\s+/g, '-')}`}
                      >
                        {q.reviewStatus}
                      </span>
                      <span className="mono-cell consol-q-assignee">
                        → {q.assignedResearcher}
                      </span>
                      {q.linkedHistoricalRowNo !== null && (
                        <button
                          type="button"
                          className="consol-q-link-chip"
                          onClick={e => {
                            e.stopPropagation();
                            onInspectHistoricalRow?.(q.linkedHistoricalRowNo!);
                          }}
                        >
                          Record #{q.linkedHistoricalRowNo}{' '}
                          {linkedRow?.location || q.linkedHistoricalLocation || ''} →
                        </button>
                      )}
                      {q.linkedSpecimenId && (
                        <button
                          type="button"
                          className="consol-q-link-chip"
                          onClick={e => {
                            e.stopPropagation();
                            onOpenSpecimen?.(q.linkedSpecimenId!);
                          }}
                        >
                          {q.linkedSpecimenId} →
                        </button>
                      )}
                    </div>
                    <strong>{q.title}</strong>
                    <p className="consol-q-body-preview">{q.questionBody}</p>
                    <small className="consol-q-meta">
                      Raised by {q.raisedByEmail} ·{' '}
                      {new Date(q.updatedAt).toLocaleDateString('en-AU')} · {q.replies.length}{' '}
                      {q.replies.length === 1 ? 'reply' : 'replies'}
                    </small>
                  </div>
                </div>

                {isExpanded && (
                  <div className="consol-question-expanded">
                    {q.evidenceCitation && (
                      <div className="consol-q-citation mono-cell">
                        Evidence Citation: {q.evidenceCitation}
                      </div>
                    )}

                    {q.sourceKind !== 'lab-investigation' ? (
                      <div className="consol-q-status-controls">
                        <span>Review Status:</span>
                        {(
                          [
                            'Open Question',
                            'Under Review',
                            'Needs Verification',
                            'Resolved'
                          ] as TeamQuestionStatus[]
                        ).map(st => (
                          <button
                            key={st}
                            type="button"
                            className={`consol-seg-btn ${q.reviewStatus === st ? 'active' : ''}`}
                            onClick={() => handleStatusChange(q, st)}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="consol-q-status-controls">
                        <button
                          type="button"
                          className="consol-row-btn"
                          onClick={() =>
                            q.linkedInvestigationId &&
                            onOpenInvestigation?.(q.linkedInvestigationId)
                          }
                        >
                          Open Full Investigation in The Lab →
                        </button>
                      </div>
                    )}

                    {q.replies.length > 0 && (
                      <div className="consol-q-replies">
                        {q.replies.map(rep => (
                          <div key={rep.id} className="consol-q-reply-row">
                            <div className="consol-q-reply-top">
                              <strong>{rep.authorEmail}</strong>
                              <time className="mono-cell">
                                {new Date(rep.createdAt).toLocaleString('en-AU')}
                              </time>
                            </div>
                            <p>{rep.replyBody}</p>
                            {rep.evidenceReference && (
                              <small className="mono-cell">
                                Evidence: {rep.evidenceReference}
                              </small>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {q.sourceKind !== 'lab-investigation' && (
                      <div className="consol-q-reply-box">
                        <input
                          type="text"
                          className="consol-search-input consol-composer-input"
                          placeholder="Add researcher reply or verification finding…"
                          value={replyText}
                          onChange={e => setReplyText(e.target.value)}
                        />
                        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                          <input
                            type="text"
                            className="consol-search-input consol-composer-input"
                            placeholder="Optional evidence reference (e.g. Row #14 S = 7,733.63 ppm)"
                            value={replyEvidence}
                            onChange={e => setReplyEvidence(e.target.value)}
                          />
                          <button
                            type="button"
                            className="consol-row-btn"
                            onClick={() => handleAddReply(q)}
                          >
                            Reply
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="workbench-compact-empty">
          <p>
            {filter === 'ALL'
              ? 'No researcher questions raised yet. CONSOL never fabricates team discussions.'
              : 'No questions match the selected review filter.'}
          </p>
          <button
            type="button"
            className="quiet-link"
            style={{ background: 'none', border: 0, padding: 0 }}
            onClick={() => setComposerOpen(true)}
          >
            ＋ Raise a question linked to a historical record or specimen →
          </button>
        </div>
      )}
    </section>
  );
};

export default TeamIntelligenceInbox;
