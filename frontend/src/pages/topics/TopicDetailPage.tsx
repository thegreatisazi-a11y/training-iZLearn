import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, Trash2, Plus, Pencil, RefreshCw, Library, Eye, X } from 'lucide-react';
import { MultiSelect } from '@/components/common/MultiSelect';
import DOMPurify from 'dompurify';
import { questionType, trainingType, type QuestionType } from '@izlearn/shared';
import { toDateInput } from '@/lib/format';
import { formatDateTime } from '@/lib/format';
import { InlineFileViewer } from '@/components/common/InlineFileViewer';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Column } from '@/components/common/DataTable';
import { FileUpload } from '@/components/common/FileUpload';
import { ReasonForChangeDialog } from '@/components/common/ReasonForChangeDialog';
import { ESignatureModal, ESignaturePayload } from '@/components/common/ESignatureModal';
import { Tabs } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { PageLoader } from '@/components/ui/spinner';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
import { svc } from '@/services';

interface Material {
  id: string;
  topicId?: string;
  originalFileName: string;
  fileType: string;
  version: number;
  isCurrentVersion: boolean;
  isObsolete?: boolean;
  isStaged?: boolean;
  replacesMaterialId?: string | null;
  archivedAt?: string | null;
  archivedBy?: string | null;
  changeReason?: string | null;
  requiredViewSeconds?: number | null;
}

interface VersionHistoryRow {
  id: string;
  version: number;
  changedBy: string;
  reason?: string | null;
  note?: string | null;
  changedAt: string;
  materialsSnapshot: { id: string; originalFileName: string; version: number; isCurrentVersion: boolean }[];
  questionsSnapshot: { id: string; questionText: string }[];
}

interface BundleRow {
  id: string;
  name: string;
}

interface Question {
  id: string;
  questionText: string;
  questionType: QuestionType;
  options?: { id: string; text: string }[];
  matchPairs?: { left: string; right: string }[];
  correctAnswer: string | string[];
  explanation?: string;
  helpText?: string;
  isMandatory: boolean;
  isStaged?: boolean;
  pendingRemoval?: boolean;
}

const MAX_OPTIONS = 4; // CR-34

const QUESTION_TYPE_OPTIONS = questionType.options.map((t) => ({ value: t, label: t.replace(/_/g, ' ') }));

interface QuestionForm {
  questionText: string;
  questionType: QuestionType;
  options: { id: string; text: string }[];
  correctIds: string[];
  trueFalseAnswer: string;
  fillVariants: string;
  matchPairs: { left: string; right: string }[];
  explanation: string;
  helpText: string;
  isMandatory: boolean;
}

/** CR-35: a correct answer must be chosen before a question can be saved. */
function questionHasAnswer(f: QuestionForm): boolean {
  switch (f.questionType) {
    case 'MULTIPLE_CHOICE_SINGLE':
      return f.correctIds.length === 1 && f.options.every((o) => o.text.trim() || !f.correctIds.includes(o.id));
    case 'MULTIPLE_CHOICE_MULTI':
      return f.correctIds.length >= 1;
    case 'TRUE_FALSE':
      return !!f.trueFalseAnswer;
    case 'FILL_IN_THE_BLANKS':
      return f.fillVariants.split(',').map((v) => v.trim()).filter(Boolean).length > 0;
    case 'MATCH_THE_WORDS':
      return f.matchPairs.length >= 2 && f.matchPairs.every((p) => p.left.trim() && p.right.trim());
    default:
      return false;
  }
}

function blankQuestionForm(): QuestionForm {
  return {
    questionText: '',
    questionType: 'MULTIPLE_CHOICE_SINGLE',
    options: [
      { id: 'o1', text: '' },
      { id: 'o2', text: '' },
    ],
    correctIds: [],
    trueFalseAnswer: 'true',
    fillVariants: '',
    matchPairs: [
      { left: '', right: '' },
      { left: '', right: '' },
    ],
    explanation: '',
    helpText: '',
    isMandatory: false,
  };
}

function formFromQuestion(q: Question): QuestionForm {
  const blank = blankQuestionForm();
  const rawOptions = q.options as unknown;
  const answer = q.correctAnswer as unknown;
  const answerIsArr = Array.isArray(answer);
  const answerIsPairs = answerIsArr && (answer as unknown[]).length > 0 && typeof (answer as unknown[])[0] === 'object';

  // MULTIPLE_CHOICE options are stored as an array [{id,text}]; MATCH pairs live in
  // options.matchPairs (an object) and/or correctAnswer (an array of {left,right}).
  const mcOptions = Array.isArray(rawOptions) ? (rawOptions as { id: string; text: string }[]) : [];
  const pairsFromOptions =
    rawOptions && !Array.isArray(rawOptions) && Array.isArray((rawOptions as { matchPairs?: unknown }).matchPairs)
      ? ((rawOptions as { matchPairs: { left: string; right: string }[] }).matchPairs)
      : [];
  const pairsFromAnswer = answerIsPairs ? (answer as { left: string; right: string }[]) : [];
  const matchPairs = q.matchPairs?.length ? q.matchPairs : pairsFromOptions.length ? pairsFromOptions : pairsFromAnswer;

  return {
    questionText: q.questionText,
    questionType: q.questionType,
    options: mcOptions.length ? mcOptions : blank.options,
    // MC correct answers are the selected option ids (an array of strings).
    correctIds: answerIsArr && !answerIsPairs ? (answer as string[]) : [],
    trueFalseAnswer: !answerIsArr ? String(answer ?? 'true') : 'true',
    // FILL stores an array of accepted strings; join them back for editing.
    fillVariants:
      q.questionType === 'FILL_IN_THE_BLANKS'
        ? answerIsArr
          ? (answer as string[]).join(', ')
          : String(answer ?? '')
        : '',
    matchPairs: matchPairs.length ? matchPairs : blank.matchPairs,
    explanation: q.explanation ?? '',
    helpText: q.helpText ?? '',
    isMandatory: q.isMandatory,
  };
}

/** Build the API body for a question form depending on its type. */
function questionBody(f: QuestionForm, topicId: string) {
  const base: Record<string, unknown> = {
    topicId,
    questionText: f.questionText,
    questionType: f.questionType,
    explanation: f.explanation || undefined,
    helpText: f.helpText || undefined,
    isMandatory: f.isMandatory,
  };
  switch (f.questionType) {
    case 'MULTIPLE_CHOICE_SINGLE':
    case 'MULTIPLE_CHOICE_MULTI':
      base.options = f.options;
      base.correctAnswer = f.correctIds;
      break;
    case 'TRUE_FALSE':
      base.correctAnswer = f.trueFalseAnswer;
      break;
    case 'FILL_IN_THE_BLANKS':
      base.correctAnswer = f.fillVariants.split(',').map((v) => v.trim()).filter(Boolean);
      break;
    case 'MATCH_THE_WORDS':
      base.matchPairs = f.matchPairs;
      base.correctAnswer = f.matchPairs.map((p) => p.left);
      break;
  }
  return base;
}

export default function TopicDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const can = useAuthStore((s) => s.hasPermission);
  const canEdit = can('courseManagement', 'edit');
  const canArchive = can('courseManagement', 'archive');
  const canBundleEdit = can('bundleManagement', 'edit');
  const canManage = canEdit || canArchive || canBundleEdit;
  const canMaterialWrite = can('materialManagement', 'write');
  const canQuestionWrite = can('questionBank', 'write');

  const [tab, setTab] = useState('materials');
  const [deletingMaterial, setDeletingMaterial] = useState<Material | null>(null);
  const [questionDialog, setQuestionDialog] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [qForm, setQForm] = useState<QuestionForm>(blankQuestionForm());
  const [editReasonFor, setEditReasonFor] = useState<{ id: string; body: Record<string, unknown> } | null>(null);
  const [viewingQuestion, setViewingQuestion] = useState<Question | null>(null);
  const [removeQuestionFor, setRemoveQuestionFor] = useState<Question | null>(null);
  // 4.1 replace, 4.2 library attach, 4.3 status, 4.7 bundles
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replaceTarget, setReplaceTarget] = useState<Material | null>(null);
  const [replacePending, setReplacePending] = useState<{ material: Material; file: File } | null>(null);
  // Replace/Update source chooser: which file is being replaced, and (when via library)
  // the target + selected source pending a reason-for-change.
  const [replaceChoice, setReplaceChoice] = useState<Material | null>(null);
  const [replaceLibraryFor, setReplaceLibraryFor] = useState<Material | null>(null);
  const [replaceLibraryPending, setReplaceLibraryPending] = useState<{ material: Material; source: Material } | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [statusChange, setStatusChange] = useState<'PUBLISHED' | 'ARCHIVED' | 'DRAFT' | null>(null);
  const [publishDraftOpen, setPublishDraftOpen] = useState(false);
  const [bundleDialogOpen, setBundleDialogOpen] = useState(false);
  const [selectedBundleIds, setSelectedBundleIds] = useState<string[]>([]);
  const [viewingMaterial, setViewingMaterial] = useState<Material | null>(null);
  const [readTimeTarget, setReadTimeTarget] = useState<Material | null>(null);
  const [readTimeMin, setReadTimeMin] = useState('');
  const [applyReadTimeToAll, setApplyReadTimeToAll] = useState(false);
  const [editTopicOpen, setEditTopicOpen] = useState(false);
  const [editTopicReasonOpen, setEditTopicReasonOpen] = useState(false);
  const [editTopicForm, setEditTopicForm] = useState({
    title: '', topicNumber: '', sopNumber: '', description: '', trainingType: 'CLASSROOM', trainingTypes: [] as string[],
    departmentId: '', designationId: '', designationIds: [] as string[], roleIds: [] as string[], durationMinutes: '', maxAttempts: '',
    questionLimit: '', refresherIntervalMonths: '', materialViewSeconds: '', effectiveDate: '', reviewDate: '',
    requiresAssessment: true, assessmentTimeMinutes: '', passingScorePercent: '',
    signatories: [] as { userId: string; role: string; date: string }[],
    randomizeQuestions: true, showExplanations: true, blockAfterMaxAttempts: true,
  });

  const { data: topic, isLoading } = useQuery({ queryKey: ['topic', id], queryFn: () => svc.topics.get(id), enabled: !!id });
  const { data: materials, isLoading: matLoading } = useQuery({
    queryKey: ['materials', { topicId: id }],
    queryFn: () => svc.materials.list({ topicId: id, pageSize: 200 }),
    enabled: !!id,
  });
  const { data: questions, isLoading: qLoading } = useQuery({
    queryKey: ['questions', { topicId: id }],
    queryFn: () => svc.questions.list({ topicId: id, pageSize: 200 }),
    enabled: !!id,
  });
  const { data: history, isLoading: histLoading } = useQuery({
    queryKey: ['topic-history', id],
    queryFn: () => svc.topics.history(id, { pageSize: 100 }),
    enabled: !!id && tab === 'history',
  });
  const { data: library } = useQuery({
    queryKey: ['materials', 'library'],
    queryFn: () => svc.materials.list({ pageSize: 200 }),
    enabled: libraryOpen || !!replaceLibraryFor,
  });
  const { data: bundles } = useQuery({
    queryKey: ['bundles', 'all'],
    queryFn: () => svc.bundles.list({ pageSize: 200 }),
    enabled: bundleDialogOpen,
  });
  // Resolve "changed by" user names for the Archived Materials section.
  const { data: usersForNames } = useQuery({
    queryKey: ['users', 'names'],
    queryFn: () => svc.users.list({ pageSize: 1000, includeInactive: true }),
    enabled: (tab === 'materials' && canMaterialWrite) || tab === 'history',
  });
  const editDesigs = useQuery({ queryKey: ['designations', 'all'], queryFn: () => svc.master.listDesignations({ pageSize: 200 }), enabled: editTopicOpen });
  const editRoles = useQuery({ queryKey: ['roles', 'all'], queryFn: () => svc.roles.list({ pageSize: 200 }), enabled: editTopicOpen });
  const editUsers = useQuery({ queryKey: ['users', 'topic-signatories'], queryFn: () => svc.users.list({ pageSize: 1000 }), enabled: editTopicOpen });
  const editUserOpts = ((editUsers.data?.data ?? []) as unknown as { id: string; fullName: string; employeeId: string }[]).map((u) => ({ value: u.id, label: `${u.fullName} (${u.employeeId})` }));
  const editDesigOpts = ((editDesigs.data?.data ?? []) as unknown as { id: string; displayName: string }[]).map((d) => ({ value: d.id, label: d.displayName }));
  const editRoleOpts = ((editRoles.data?.data ?? []) as unknown as { id: string; roleName: string }[]).map((r) => ({ value: r.id, label: r.roleName }));

  const uploadMut = useMutation({
    mutationFn: (file: File) => svc.materials.upload(file, id),
    onSuccess: () => {
      toast.success('Material uploaded');
      qc.invalidateQueries({ queryKey: ['materials', { topicId: id }] });
      // A material change can bump the course version — refresh the topic header.
      qc.invalidateQueries({ queryKey: ['topic', id] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const deleteMaterialMut = useMutation({
    mutationFn: (reason: string) => svc.materials.remove(deletingMaterial!.id, reason),
    onSuccess: () => {
      toast.success('Material deleted');
      qc.invalidateQueries({ queryKey: ['materials', { topicId: id }] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const discardStagedMut = useMutation({
    mutationFn: (materialId: string) => svc.materials.discardStaged(materialId),
    onSuccess: () => {
      toast.success('Pending file discarded');
      qc.invalidateQueries({ queryKey: ['materials', { topicId: id }] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const replaceMut = useMutation({
    mutationFn: (reason: string) => svc.materials.replace(replacePending!.material.id, replacePending!.file, reason),
    onSuccess: () => {
      toast.success('File replaced with a new version');
      qc.invalidateQueries({ queryKey: ['materials', { topicId: id }] });
      qc.invalidateQueries({ queryKey: ['topic-history', id] });
      qc.invalidateQueries({ queryKey: ['topic', id] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // Replace a specific file using an existing Material Library file (true replace).
  const replaceFromLibraryMut = useMutation({
    mutationFn: (reason: string) =>
      svc.materials.replaceFromLibrary(replaceLibraryPending!.material.id, replaceLibraryPending!.source.id, reason),
    onSuccess: () => {
      toast.success('File replaced with a library file');
      qc.invalidateQueries({ queryKey: ['materials', { topicId: id }] });
      qc.invalidateQueries({ queryKey: ['topic-history', id] });
      qc.invalidateQueries({ queryKey: ['topic', id] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const attachMut = useMutation({
    mutationFn: (materialId: string) => svc.materials.attachFromLibrary(materialId, id),
    onSuccess: () => {
      toast.success('Library material attached');
      qc.invalidateQueries({ queryKey: ['materials', { topicId: id }] });
      qc.invalidateQueries({ queryKey: ['topic-history', id] });
      qc.invalidateQueries({ queryKey: ['topic', id] });
      setLibraryOpen(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const statusMut = useMutation({
    mutationFn: (signature: ESignaturePayload) => {
      const { reason, ...sig } = signature;
      return svc.topics.updateStatus(id, { status: statusChange, reasonForChange: (reason ?? '').trim(), signature: sig });
    },
    onSuccess: () => {
      toast.success('Topic status updated');
      qc.invalidateQueries({ queryKey: ['topic', id] });
      qc.invalidateQueries({ queryKey: ['topics'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // G4: promote a published topic's staged draft edits to the live record (e-signed + confirm).
  const publishDraftMut = useMutation({
    mutationFn: (signature: ESignaturePayload) => {
      const { reason, ...sig } = signature;
      return svc.topics.publishDraft(id, { reasonForChange: (reason ?? '').trim(), signature: sig });
    },
    onSuccess: () => {
      toast.success('Draft changes published — the live course is updated.');
      qc.invalidateQueries({ queryKey: ['topic', id] });
      qc.invalidateQueries({ queryKey: ['topics'] });
      setPublishDraftOpen(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const readTimeMut = useMutation({
    mutationFn: (seconds: number) => svc.materials.setViewTime(readTimeTarget!.id, seconds, applyReadTimeToAll),
    onSuccess: () => {
      toast.success(applyReadTimeToAll ? 'Reading time applied to all files; course duration updated.' : 'Reading time updated; course duration updated.');
      qc.invalidateQueries({ queryKey: ['materials', { topicId: id }] });
      // Refresh the topic so the recomputed course duration shows immediately.
      qc.invalidateQueries({ queryKey: ['topic', id] });
      qc.invalidateQueries({ queryKey: ['topics'] });
      setReadTimeTarget(null);
      setApplyReadTimeToAll(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const updateTopicMut = useMutation({
    mutationFn: (reasonForChange: string) =>
      svc.topics.update(id, {
        title: editTopicForm.title,
        topicNumber: editTopicForm.topicNumber || undefined,
        sopNumber: editTopicForm.sopNumber || undefined,
        description: editTopicForm.description || undefined,
        trainingType: editTopicForm.trainingTypes[0] || editTopicForm.trainingType,
        trainingTypes: editTopicForm.trainingTypes,
        departmentId: editTopicForm.departmentId || undefined,
        designationIds: editTopicForm.designationIds,
        requiresAssessment: editTopicForm.requiresAssessment,
        passingScorePercent: editTopicForm.passingScorePercent !== '' ? Number(editTopicForm.passingScorePercent) : undefined,
        signatories: editTopicForm.signatories.filter((s) => s.userId),
        assessmentTimeMinutes: Number(editTopicForm.assessmentTimeMinutes) > 0 ? Number(editTopicForm.assessmentTimeMinutes) : null,
        durationMinutes: editTopicForm.durationMinutes !== '' ? Number(editTopicForm.durationMinutes) : undefined,
        maxAttempts: Number(editTopicForm.maxAttempts),
        questionLimit: Number(editTopicForm.questionLimit) > 0 ? Number(editTopicForm.questionLimit) : undefined,
        refresherIntervalMonths: Number(editTopicForm.refresherIntervalMonths) > 0 ? Number(editTopicForm.refresherIntervalMonths) : undefined,
        materialViewSeconds: editTopicForm.materialViewSeconds ? Number(editTopicForm.materialViewSeconds) : undefined,
        effectiveDate: editTopicForm.effectiveDate || undefined,
        reviewDate: editTopicForm.reviewDate || undefined,
        randomizeQuestions: editTopicForm.randomizeQuestions,
        showExplanations: editTopicForm.showExplanations,
        blockAfterMaxAttempts: editTopicForm.blockAfterMaxAttempts,
        reasonForChange,
      }),
    onSuccess: () => {
      toast.success('Topic details updated');
      qc.invalidateQueries({ queryKey: ['topic', id] });
      qc.invalidateQueries({ queryKey: ['topics'] });
      setEditTopicReasonOpen(false);
      setEditTopicOpen(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const addToBundlesMut = useMutation({
    mutationFn: () => svc.bundles.addTopicToBundles(id, selectedBundleIds),
    onSuccess: () => {
      toast.success('Topic added to bundle(s)');
      qc.invalidateQueries({ queryKey: ['bundles'] });
      setBundleDialogOpen(false);
      setSelectedBundleIds([]);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const createQuestionMut = useMutation({
    mutationFn: () => svc.questions.create(questionBody(qForm, id)),
    onSuccess: () => {
      toast.success('Question added');
      qc.invalidateQueries({ queryKey: ['questions', { topicId: id }] });
      // A question change on a published course bumps the version + logs history.
      qc.invalidateQueries({ queryKey: ['topic', id] });
      qc.invalidateQueries({ queryKey: ['topic-history', id] });
      setQuestionDialog(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const updateQuestionMut = useMutation({
    mutationFn: (reason: string) => svc.questions.update(editReasonFor!.id, { ...editReasonFor!.body, reasonForChange: reason }),
    onSuccess: () => {
      toast.success('Question updated');
      qc.invalidateQueries({ queryKey: ['questions', { topicId: id }] });
      qc.invalidateQueries({ queryKey: ['topic', id] });
      qc.invalidateQueries({ queryKey: ['topic-history', id] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // G4: discard a staged (pending) question draft on a published topic.
  const discardQuestionMut = useMutation({
    mutationFn: (qid: string) => svc.questions.remove(qid, 'Discarded pending question draft'),
    onSuccess: () => {
      toast.success('Pending question discarded');
      qc.invalidateQueries({ queryKey: ['questions', { topicId: id }] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // Remove a question (controlled — reason for change required).
  const removeQuestionMut = useMutation({
    mutationFn: (reason: string) => svc.questions.remove(removeQuestionFor!.id, reason),
    onSuccess: () => {
      toast.success('Question removed');
      qc.invalidateQueries({ queryKey: ['questions', { topicId: id }] });
      qc.invalidateQueries({ queryKey: ['topic', id] });
      qc.invalidateQueries({ queryKey: ['topic-history', id] });
      setRemoveQuestionFor(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // Deep-link from the Topics list "Edit" action: ?edit=1 opens the edit dialog.
  useEffect(() => {
    if (topic && canEdit && searchParams.get('edit') === '1' && !editTopicOpen) {
      openEditTopic();
      searchParams.delete('edit');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, searchParams]);

  if (isLoading || !topic) return <PageLoader />;
  const t = topic as Record<string, unknown> & { topicCode: string; title: string };

  function openEditTopic() {
    // On a published course, pending edits are staged in draftMeta. Populate the form
    // from draftMeta merged over the live values so successive edits accumulate instead
    // of overwriting one another (the display cards still show the live values).
    const src = { ...t, ...((t.draftMeta as Record<string, unknown> | null) ?? {}) };
    setEditTopicForm({
      title: String(src.title ?? ''),
      topicNumber: String(src.topicNumber ?? ''),
      sopNumber: String(src.sopNumber ?? ''),
      description: String(src.description ?? ''),
      trainingType: String(src.trainingType ?? 'CLASSROOM'),
      trainingTypes: Array.isArray(src.trainingTypes) && (src.trainingTypes as string[]).length ? (src.trainingTypes as string[]) : src.trainingType ? [String(src.trainingType)] : [],
      signatories: Array.isArray(src.signatories)
        ? (src.signatories as { userId: string; role: string; date?: string }[]).map((s) => ({ userId: s.userId, role: s.role || 'PREPARED', date: s.date ?? '' }))
        : Array.isArray(src.signatoryUserIds)
          ? (src.signatoryUserIds as string[]).map((uid) => ({ userId: uid, role: 'PREPARED', date: '' }))
          : [],
      departmentId: String(src.departmentId ?? ''),
      designationId: String(src.designationId ?? ''),
      designationIds: Array.isArray(src.designationIds) && (src.designationIds as string[]).length
        ? (src.designationIds as string[])
        : src.designationId ? [String(src.designationId)] : [],
      roleIds: Array.isArray(src.roleIds) && (src.roleIds as string[]).length ? (src.roleIds as string[]) : src.roleId ? [String(src.roleId)] : [],
      durationMinutes: src.durationMinutes != null ? String(src.durationMinutes) : '',
      maxAttempts: src.maxAttempts != null ? String(src.maxAttempts) : '',
      questionLimit: src.questionLimit != null ? String(src.questionLimit) : '',
      refresherIntervalMonths: src.refresherIntervalMonths != null ? String(src.refresherIntervalMonths) : '',
      materialViewSeconds: src.materialViewSeconds != null ? String(src.materialViewSeconds) : '',
      effectiveDate: toDateInput(src.effectiveDate as string | null | undefined),
      reviewDate: toDateInput(src.reviewDate as string | null | undefined),
      requiresAssessment: src.requiresAssessment !== false,
      assessmentTimeMinutes: src.assessmentTimeMinutes != null ? String(src.assessmentTimeMinutes) : '',
      passingScorePercent: src.passingScorePercent != null ? String(src.passingScorePercent) : '',
      randomizeQuestions: src.randomizeQuestions !== false,
      showExplanations: src.showExplanations !== false,
      blockAfterMaxAttempts: src.blockAfterMaxAttempts !== false,
    });
    setEditTopicOpen(true);
  }

  function openNewQuestion() {
    setEditingQuestion(null);
    setQForm(blankQuestionForm());
    setQuestionDialog(true);
  }
  function openEditQuestion(q: Question) {
    setEditingQuestion(q);
    setQForm(formFromQuestion(q));
    setQuestionDialog(true);
  }
  function submitQuestion() {
    if (editingQuestion) {
      // Edits require a reason for change (21 CFR Part 11).
      const body = questionBody(qForm, id);
      delete body.topicId;
      setEditReasonFor({ id: editingQuestion.id, body });
      setQuestionDialog(false);
    } else {
      createQuestionMut.mutate();
    }
  }

  const materialColumns: Column<Material>[] = [
    { key: 'originalFileName', header: 'File', render: (r) => <span className="font-medium text-slate-800">{r.originalFileName}</span> },
    { key: 'fileType', header: 'Type', render: (r) => <span className="uppercase">{r.fileType}</span> },
    { key: 'version', header: 'Version', render: (r) => `v${r.version}` },
    {
      key: 'readTime',
      header: 'Read time',
      render: (r) => {
        const secs = r.requiredViewSeconds ?? 0;
        const label = secs > 0 ? `${Math.round((secs / 60) * 10) / 10} min` : '—';
        return canMaterialWrite ? (
          <button type="button" className="text-primary hover:underline" onClick={() => { setReadTimeTarget(r); setReadTimeMin(secs ? String(Math.round((secs / 60) * 10) / 10) : ''); }}>
            {label} <Pencil className="ml-1 inline h-3 w-3" />
          </button>
        ) : label;
      },
    },
    { key: 'isCurrentVersion', header: 'Current', render: (r) => (r.isCurrentVersion ? <Badge tone="APPROVED">Current</Badge> : <Badge tone="WAIVED">Old</Badge>) },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (r) => (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setViewingMaterial(r)}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <Eye className="h-4 w-4" /> View
          </button>
          {canMaterialWrite && (
            <button
              type="button"
              onClick={() => svc.materials.download(r.id, r.originalFileName).catch((e) => toast.error(apiError(e)))}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <Download className="h-4 w-4" /> Download
            </button>
          )}
          {canMaterialWrite && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              onClick={() => setReplaceChoice(r)}
            >
              <RefreshCw className="h-4 w-4" /> Replace / Update
            </button>
          )}
          {/* G5/H1: material delete is only allowed before the course is published. */}
          {canMaterialWrite && String(t.status) !== 'PUBLISHED' && (
            <button className="text-red-600 hover:text-red-700" onClick={() => setDeletingMaterial(r)} aria-label="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  const questionColumns: Column<Question>[] = [
    { key: 'questionText', header: 'Question', render: (r) => (
      <span className="text-slate-800">
        {r.questionText}
        {r.pendingRemoval && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">Pending removal</span>}
      </span>
    ) },
    { key: 'questionType', header: 'Type', render: (r) => r.questionType.replace(/_/g, ' ') },
    { key: 'isMandatory', header: 'Mandatory', render: (r) => (r.isMandatory ? <Badge tone="APPROVED">Yes</Badge> : <Badge tone="WAIVED">No</Badge>) },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (r) => (
        <div className="flex justify-end gap-3">
          <button className="inline-flex items-center gap-1 text-sm text-primary hover:underline" onClick={() => setViewingQuestion(r)}>
            <Eye className="h-3.5 w-3.5" /> View
          </button>
          {canQuestionWrite && (
            <button className="inline-flex items-center gap-1 text-sm text-primary hover:underline" onClick={() => openEditQuestion(r)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          )}
          {/* A question can be removed at any time, including after publish — it is a
              controlled, versioned change (bumps the course version + logs the removal). */}
          {canQuestionWrite && (
            <button className="inline-flex items-center gap-1 text-sm text-red-600 hover:underline" onClick={() => setRemoveQuestionFor(r)}>
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          )}
        </div>
      ),
    },
  ];

  const isMc = qForm.questionType === 'MULTIPLE_CHOICE_SINGLE' || qForm.questionType === 'MULTIPLE_CHOICE_MULTI';

  // Group materials for the Active / Pending / Archived sections.
  const allMaterials = (materials?.data ?? []) as unknown as Material[];
  const activeMaterials = allMaterials.filter((m) => m.isCurrentVersion && !m.isObsolete && !m.isStaged);
  const stagedMaterials = allMaterials.filter((m) => m.isStaged);
  const archivedMaterials = allMaterials.filter((m) => m.isObsolete);
  // G4: split questions into live and staged (pending) for a published topic.
  const allQuestions = (questions?.data ?? []) as unknown as Question[];
  const liveQuestions = allQuestions.filter((q) => !q.isStaged); // includes pending-removal (still live until publish)
  const stagedQuestions = allQuestions.filter((q) => q.isStaged);
  const pendingRemovalQuestions = allQuestions.filter((q) => !q.isStaged && q.pendingRemoval);
  const isPublished = String(t.status) === 'PUBLISHED';
  // G4: a published topic with staged metadata edits and/or staged material/question changes.
  const hasDraftMeta = !!(t as { draftMeta?: unknown }).draftMeta;
  const hasPendingChanges = isPublished && (hasDraftMeta || stagedMaterials.length > 0 || stagedQuestions.length > 0 || pendingRemovalQuestions.length > 0);
  const materialNameById = (mid?: string | null) => (mid ? allMaterials.find((m) => m.id === mid)?.originalFileName ?? null : null);
  const userName = (uid?: string | null) => {
    if (!uid) return '—';
    const u = ((usersForNames?.data ?? []) as unknown as { id: string; fullName: string }[]).find((x) => x.id === uid);
    return u ? u.fullName : uid;
  };

  return (
    <div>
      <button className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700" onClick={() => navigate('/topics')}>
        <ArrowLeft className="h-4 w-4" /> Back to topics
      </button>

      <PageHeader
        title={t.title}
        description={`${(t.topicNumber as string) || t.topicCode} · ${String(t.trainingType).replace(/_/g, ' ')} · v${t.currentVersion} · ${String(t.status ?? 'DRAFT')}`}
        actions={
          canManage && (
            <>
              {canEdit && (
                <Button variant="outline" onClick={openEditTopic}>
                  <Pencil className="h-4 w-4" /> Edit details
                </Button>
              )}
              {String(t.status) === 'PUBLISHED' ? (
                <>
                  {/* CR-26: Unpublish returns the topic to Draft (editable) — it does NOT archive. */}
                  {canEdit && (
                    <Button variant="outline" onClick={() => setStatusChange('DRAFT')}>
                      Unpublish
                    </Button>
                  )}
                  {canArchive && (
                    <Button variant="outline" onClick={() => setStatusChange('ARCHIVED')}>
                      Archive
                    </Button>
                  )}
                </>
              ) : (
                <>
                  {canEdit && String(t.status) !== 'ARCHIVED' && (
                    <Button variant="outline" onClick={() => setStatusChange('PUBLISHED')}>
                      Publish
                    </Button>
                  )}
                  {canArchive && String(t.status) !== 'ARCHIVED' && (
                    <Button variant="outline" onClick={() => setStatusChange('ARCHIVED')}>
                      Archive
                    </Button>
                  )}
                </>
              )}
              {/* Bundles were removed from the left menu — "Add to bundle(s)" is hidden.
                  Dialog/handler kept below (unreachable) in case bundles return.
              {canBundleEdit && (
                <Button variant="outline" onClick={() => { setSelectedBundleIds([]); setBundleDialogOpen(true); }}>
                  <Layers className="h-4 w-4" /> Add to bundle(s)
                </Button>
              )} */}
              {/* G2: full-course "Revise (new version)" removed — Archive only; material/draft
                  changes are published in place via "Publish changes" (no full-course clone).
                  Passing score is now edited inline in "Edit details" and staged like everything else. */}
            </>
          )
        }
      />

      {/* G4: a published course shows a "draft changes pending" banner when edits are
          staged — the live version stays unchanged until "Publish changes" promotes them. */}
      {hasPendingChanges && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>
            <strong>Draft changes pending.</strong>{' '}
            {hasDraftMeta && 'Course details have been edited. '}
            {stagedMaterials.length > 0 && `${stagedMaterials.length} material change(s) staged. `}
            {stagedQuestions.length > 0 && `${stagedQuestions.length} question change(s) staged. `}
            {pendingRemovalQuestions.length > 0 && `${pendingRemovalQuestions.length} question(s) pending removal. `}
            These are <strong>not yet live</strong> — the published course is unchanged until you publish the changes.
          </span>
          {canEdit && (
            <Button size="sm" onClick={() => setPublishDraftOpen(true)}>Publish changes</Button>
          )}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        <Card>
          <CardContent>
            <div className="text-xs text-slate-500">Duration</div>
            <div className="text-lg font-semibold text-slate-800">{String(t.durationMinutes)} min</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-xs text-slate-500">Passing Score</div>
            <div className="text-lg font-semibold text-slate-800">{String(t.passingScorePercent)}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-xs text-slate-500">Max Attempts</div>
            <div className="text-lg font-semibold text-slate-800">{String(t.maxAttempts)}</div>
          </CardContent>
        </Card>
      </div>

      {typeof t.description === 'string' && t.description && (
        <Card className="mb-6">
          <CardContent>
            <div className="prose-sm text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t.description) }} />
          </CardContent>
        </Card>
      )}

      <Tabs
        tabs={[
          { key: 'materials', label: 'Materials' },
          { key: 'questions', label: 'Questions' },
          { key: 'history', label: 'Version History' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'materials' && (
        <div className="mt-4 space-y-6">
          {canMaterialWrite && (
            <div className="flex flex-wrap items-center gap-3">
              <FileUpload onSelect={(f) => uploadMut.mutate(f)} label={uploadMut.isPending ? 'Uploading…' : 'Upload material'} />
              <Button variant="outline" onClick={() => setLibraryOpen(true)}>
                <Library className="h-4 w-4" /> Choose from Material Library
              </Button>
            </div>
          )}

          {/* On a PUBLISHED topic, added/attached files are STAGED until published. */}
          {canMaterialWrite && isPublished && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This topic is published. New or attached files are held as <span className="font-medium">pending changes</span> and do not affect the live version. They go live only when you click <span className="font-medium">Publish changes</span> (top of the page).
            </div>
          )}

          {/* Active Materials — the current live files */}
          <div>
            <div className="mb-2 text-sm font-semibold uppercase text-slate-500">Active Materials ({activeMaterials.length})</div>
            <DataTable<Material> columns={materialColumns} rows={activeMaterials} loading={matLoading} emptyText="No active materials." />
          </div>

          {/* Pending Changes — staged files awaiting revise */}
          {stagedMaterials.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-semibold uppercase text-amber-600">Pending Changes ({stagedMaterials.length})</div>
              <p className="mb-2 text-xs text-slate-500">These files are staged and go live when you click “Publish changes” (top of the page). Leaving this page does not commit them.</p>
              <DataTable<Material>
                columns={[
                  { key: 'originalFileName', header: 'File', render: (r) => <span className="font-medium text-slate-800">{r.originalFileName}</span> },
                  { key: 'fileType', header: 'Type', render: (r) => <span className="uppercase">{r.fileType}</span> },
                  {
                    key: 'replaces',
                    header: 'Change',
                    render: (r) => (r.replacesMaterialId ? `Replaces ${materialNameById(r.replacesMaterialId) ?? 'a current file'}` : 'New file'),
                  },
                  {
                    key: 'actions',
                    header: '',
                    className: 'text-right',
                    render: (r) => (
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setViewingMaterial(r)} className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><Eye className="h-4 w-4" /> View</button>
                        {canMaterialWrite && (
                          <button type="button" disabled={discardStagedMut.isPending} onClick={() => discardStagedMut.mutate(r.id)} className="inline-flex items-center gap-1 text-sm text-red-600 hover:underline"><X className="h-4 w-4" /> Discard</button>
                        )}
                      </div>
                    ),
                  },
                ]}
                rows={stagedMaterials}
                emptyText="No pending changes."
              />
            </div>
          )}

          {/* G3: when a file is replaced/superseded, the old version stays on this page
              under "Previous Versions" (read-only) — the latest is the active version above,
              the old one moves here / to Version History. */}
          {archivedMaterials.length > 0 && (
            <div className="mt-2">
              <div className="mb-2 text-sm font-semibold uppercase text-slate-500">Previous Versions ({archivedMaterials.length})</div>
              <p className="mb-2 text-xs text-slate-500">Superseded files. The current version is shown under Active Materials above; full detail is also in the Version History tab.</p>
              <DataTable<Material>
                columns={[
                  { key: 'originalFileName', header: 'File', render: (r) => <span className="text-slate-700">{r.originalFileName}</span> },
                  { key: 'fileType', header: 'Type', render: (r) => <span className="uppercase">{r.fileType}</span> },
                  { key: 'version', header: 'Version', render: (r) => `v${r.version}` },
                  { key: 'changeReason', header: 'Reason', render: (r) => r.changeReason || '—' },
                  { key: 'archivedAt', header: 'Superseded', render: (r) => (r.archivedAt ? formatDateTime(r.archivedAt) : '—') },
                  {
                    key: 'actions',
                    header: '',
                    className: 'text-right',
                    render: (r) => (
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setViewingMaterial(r)} className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><Eye className="h-4 w-4" /> View</button>
                        {canMaterialWrite && <button type="button" onClick={() => svc.materials.download(r.id, r.originalFileName).catch((e) => toast.error(apiError(e)))} className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><Download className="h-4 w-4" /> Download</button>}
                      </div>
                    ),
                  },
                ]}
                rows={archivedMaterials}
                emptyText="No previous versions."
              />
            </div>
          )}

          {/* Hidden input for per-file Replace/Update (4.1) */}
          <input
            ref={replaceInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && replaceTarget) setReplacePending({ material: replaceTarget, file });
              e.target.value = '';
            }}
          />
        </div>
      )}

      {tab === 'history' && (
        <div className="mt-4 space-y-3">
          {histLoading && <PageLoader />}
          {!histLoading && ((history?.data ?? []) as VersionHistoryRow[]).length === 0 && (
            <Card><CardContent><p className="text-sm text-slate-500">No version history yet. A history entry is recorded when a file is replaced, attached, or the topic is revised.</p></CardContent></Card>
          )}
          {((history?.data ?? []) as VersionHistoryRow[]).map((h) => (
            <Card key={h.id}>
              <CardContent>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-800">Version v{h.version}</div>
                  <div className="text-xs text-slate-500">Changed by {userName(h.changedBy)} on {formatDateTime(h.changedAt)}</div>
                </div>
                {h.note && <div className="mb-1 text-sm text-slate-700">{h.note}</div>}
                {h.reason && <div className="mb-2 text-sm text-slate-500"><span className="font-medium">Reason:</span> {h.reason}</div>}
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-medium uppercase text-slate-400">Files at this version ({h.materialsSnapshot?.length ?? 0})</div>
                    <ul className="space-y-1 text-sm text-slate-600">
                      {(h.materialsSnapshot ?? []).map((m) => (
                        <li key={m.id} className="flex items-center gap-2">
                          <span>{m.originalFileName}</span>
                          <Badge tone={m.isCurrentVersion ? 'APPROVED' : 'WAIVED'}>v{m.version}</Badge>
                        </li>
                      ))}
                      {(h.materialsSnapshot ?? []).length === 0 && <li className="text-slate-400">—</li>}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium uppercase text-slate-400">Questions snapshot ({h.questionsSnapshot?.length ?? 0})</div>
                    <ul className="space-y-1 text-sm text-slate-600">
                      {(h.questionsSnapshot ?? []).slice(0, 8).map((q) => (
                        <li key={q.id} className="truncate">{q.questionText}</li>
                      ))}
                      {(h.questionsSnapshot ?? []).length === 0 && <li className="text-slate-400">—</li>}
                      {(h.questionsSnapshot ?? []).length > 8 && <li className="text-slate-400">… and {(h.questionsSnapshot ?? []).length - 8} more</li>}
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === 'questions' && (
        <div className="mt-4">
          {canQuestionWrite && (
            <div className="mb-4">
              <Button onClick={openNewQuestion}>
                <Plus className="h-4 w-4" /> Add Question
              </Button>
            </div>
          )}
          {isPublished && (
            <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              This course is published. New or edited questions are held as <span className="font-medium">pending changes</span> and do not affect the live assessment until you click <span className="font-medium">Publish changes</span> (top of the page).
            </p>
          )}
          <DataTable<Question> columns={questionColumns} rows={liveQuestions} loading={qLoading} emptyText="No questions yet." />

          {/* G4: staged (pending) question drafts — not in the live assessment until published. */}
          {stagedQuestions.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 text-sm font-semibold uppercase text-amber-600">Pending Question Changes ({stagedQuestions.length})</div>
              <DataTable<Question>
                columns={[
                  { key: 'questionText', header: 'Question', render: (r) => <span className="text-slate-800">{r.questionText}</span> },
                  { key: 'questionType', header: 'Type', render: (r) => r.questionType.replace(/_/g, ' ') },
                  {
                    key: 'actions',
                    header: '',
                    className: 'text-right',
                    render: (r) =>
                      canQuestionWrite ? (
                        <button type="button" disabled={discardQuestionMut.isPending} onClick={() => discardQuestionMut.mutate(r.id)} className="inline-flex items-center gap-1 text-sm text-red-600 hover:underline">
                          <X className="h-4 w-4" /> Discard
                        </button>
                      ) : null,
                  },
                ]}
                rows={stagedQuestions}
                emptyText="No pending question changes."
              />
            </div>
          )}
        </div>
      )}

      <ReasonForChangeDialog
        open={!!deletingMaterial}
        onClose={() => setDeletingMaterial(null)}
        onConfirm={async (r) => { await deleteMaterialMut.mutateAsync(r); }}
        title="Delete Material"
      />

      <ReasonForChangeDialog
        open={!!editReasonFor}
        onClose={() => setEditReasonFor(null)}
        onConfirm={async (r) => { await updateQuestionMut.mutateAsync(r); }}
        title="Edit Question — Reason for Change"
      />

      {/* Remove a question (reason for change required) */}
      <ReasonForChangeDialog
        open={!!removeQuestionFor}
        onClose={() => setRemoveQuestionFor(null)}
        onConfirm={async (r) => { await removeQuestionMut.mutateAsync(r); }}
        title="Remove Question — Reason for Change"
      />

      {/* View a question (read-only) */}
      <Dialog
        open={!!viewingQuestion}
        onClose={() => setViewingQuestion(null)}
        className="max-w-2xl"
        title="Question"
        footer={<Button variant="outline" onClick={() => setViewingQuestion(null)}>Close</Button>}
      >
        {viewingQuestion && (() => {
          const v = formFromQuestion(viewingQuestion);
          return (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="default">{v.questionType.replace(/_/g, ' ')}</Badge>
                {viewingQuestion.isMandatory && <Badge tone="APPROVED">Mandatory</Badge>}
              </div>
              <div className="font-medium text-slate-800">{v.questionText}</div>
              {(v.questionType === 'MULTIPLE_CHOICE_SINGLE' || v.questionType === 'MULTIPLE_CHOICE_MULTI') && (
                <ul className="space-y-1">
                  {v.options.map((o) => (
                    <li key={o.id} className={`flex items-center gap-2 ${v.correctIds.includes(o.id) ? 'font-medium text-green-700' : 'text-slate-700'}`}>
                      <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] ${v.correctIds.includes(o.id) ? 'border-green-500 bg-green-100' : 'border-slate-300'}`}>{v.correctIds.includes(o.id) ? '✓' : ''}</span>
                      {o.text}
                    </li>
                  ))}
                </ul>
              )}
              {v.questionType === 'TRUE_FALSE' && <div>Correct answer: <span className="font-medium text-green-700">{v.trueFalseAnswer}</span></div>}
              {v.questionType === 'FILL_IN_THE_BLANKS' && <div>Accepted answer(s): <span className="font-medium text-green-700">{v.fillVariants || '—'}</span></div>}
              {v.questionType === 'MATCH_THE_WORDS' && (
                <ul className="space-y-1">
                  {v.matchPairs.map((p, i) => (
                    <li key={i} className="text-slate-700">{p.left} <span className="text-slate-400">→</span> <span className="font-medium">{p.right}</span></li>
                  ))}
                </ul>
              )}
              {v.explanation && <div className="border-t border-slate-100 pt-2 text-slate-600"><span className="text-xs font-semibold uppercase text-slate-400">Explanation</span><div>{v.explanation}</div></div>}
            </div>
          );
        })()}
      </Dialog>

      <Dialog
        open={questionDialog}
        onClose={() => setQuestionDialog(false)}
        className="max-w-2xl"
        title={editingQuestion ? 'Edit Question' : 'Add Question'}
        footer={
          <>
            <Button variant="outline" onClick={() => setQuestionDialog(false)}>
              Cancel
            </Button>
            <Button disabled={!qForm.questionText || !questionHasAnswer(qForm) || createQuestionMut.isPending} onClick={submitQuestion}>
              {editingQuestion ? 'Continue' : createQuestionMut.isPending ? 'Saving…' : 'Add'}
            </Button>
          </>
        }
      >
        <Field label="Question text">
          <Textarea value={qForm.questionText} onChange={(e) => setQForm({ ...qForm, questionText: e.target.value })} />
        </Field>
        <Field label="Question type">
          <Select
            options={QUESTION_TYPE_OPTIONS}
            value={qForm.questionType}
            onChange={(e) => setQForm({ ...qForm, questionType: e.target.value as QuestionType, correctIds: [] })}
          />
        </Field>

        {isMc && (
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="iz-label">Options (tick the correct {qForm.questionType === 'MULTIPLE_CHOICE_MULTI' ? 'answers' : 'answer'})</span>
              <Button
                size="sm"
                variant="outline"
                disabled={qForm.options.length >= MAX_OPTIONS}
                onClick={() => setQForm({ ...qForm, options: [...qForm.options, { id: `o${qForm.options.length + 1}_${Date.now()}`, text: '' }] })}
              >
                Add option{qForm.options.length >= MAX_OPTIONS ? ` (max ${MAX_OPTIONS})` : ''}
              </Button>
            </div>
            <div className="space-y-2">
              {qForm.options.map((o, idx) => (
                <div key={o.id} className="flex items-center gap-2">
                  <input
                    type={qForm.questionType === 'MULTIPLE_CHOICE_MULTI' ? 'checkbox' : 'radio'}
                    name="correct-option"
                    checked={qForm.correctIds.includes(o.id)}
                    onChange={(e) => {
                      if (qForm.questionType === 'MULTIPLE_CHOICE_MULTI') {
                        setQForm({
                          ...qForm,
                          correctIds: e.target.checked ? [...qForm.correctIds, o.id] : qForm.correctIds.filter((c) => c !== o.id),
                        });
                      } else {
                        setQForm({ ...qForm, correctIds: [o.id] });
                      }
                    }}
                  />
                  <Input
                    value={o.text}
                    placeholder={`Option ${idx + 1}`}
                    onChange={(e) => setQForm({ ...qForm, options: qForm.options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })}
                  />
                  {qForm.options.length > 2 && (
                    <button
                      className="text-red-600"
                      aria-label="Remove option"
                      onClick={() =>
                        setQForm({ ...qForm, options: qForm.options.filter((x) => x.id !== o.id), correctIds: qForm.correctIds.filter((c) => c !== o.id) })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {qForm.questionType === 'TRUE_FALSE' && (
          <Field label="Correct answer">
            <Select
              options={[
                { value: 'true', label: 'True' },
                { value: 'false', label: 'False' },
              ]}
              value={qForm.trueFalseAnswer}
              onChange={(e) => setQForm({ ...qForm, trueFalseAnswer: e.target.value })}
            />
          </Field>
        )}

        {qForm.questionType === 'FILL_IN_THE_BLANKS' && (
          <Field label="Accepted answers (comma-separated variants)">
            <Input value={qForm.fillVariants} onChange={(e) => setQForm({ ...qForm, fillVariants: e.target.value })} placeholder="e.g. 7, seven" />
          </Field>
        )}

        {qForm.questionType === 'MATCH_THE_WORDS' && (
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="iz-label">Match pairs</span>
              <Button size="sm" variant="outline" onClick={() => setQForm({ ...qForm, matchPairs: [...qForm.matchPairs, { left: '', right: '' }] })}>
                Add pair
              </Button>
            </div>
            <div className="space-y-2">
              {qForm.matchPairs.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    value={p.left}
                    placeholder="Left"
                    onChange={(e) => setQForm({ ...qForm, matchPairs: qForm.matchPairs.map((x, i) => (i === idx ? { ...x, left: e.target.value } : x)) })}
                  />
                  <span className="text-slate-400">→</span>
                  <Input
                    value={p.right}
                    placeholder="Right"
                    onChange={(e) => setQForm({ ...qForm, matchPairs: qForm.matchPairs.map((x, i) => (i === idx ? { ...x, right: e.target.value } : x)) })}
                  />
                  {qForm.matchPairs.length > 2 && (
                    <button className="text-red-600" aria-label="Remove pair" onClick={() => setQForm({ ...qForm, matchPairs: qForm.matchPairs.filter((_, i) => i !== idx) })}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <Field label="Explanation (optional)">
          <Textarea value={qForm.explanation} onChange={(e) => setQForm({ ...qForm, explanation: e.target.value })} />
        </Field>
        <Field label="Help text (optional)" hint="Shown to the trainee under the question (e.g. 'multiple options can be selected').">
          <Input value={qForm.helpText} onChange={(e) => setQForm({ ...qForm, helpText: e.target.value })} />
        </Field>
        {!questionHasAnswer(qForm) && (
          <p className="mb-2 text-xs text-amber-600">Select / enter the correct answer before saving.</p>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={qForm.isMandatory} onChange={(e) => setQForm({ ...qForm, isMandatory: e.target.checked })} />
          Mandatory question (always included in assessments)
        </label>
      </Dialog>

      {/* 4.1: replace/update a specific file — choose the source (device or library) */}
      <Dialog
        open={!!replaceChoice}
        onClose={() => setReplaceChoice(null)}
        title={`Replace "${replaceChoice?.originalFileName ?? ''}"`}
        footer={<Button variant="outline" onClick={() => setReplaceChoice(null)}>Cancel</Button>}
      >
        <p className="mb-3 text-sm text-slate-600">Choose where the replacement file comes from.</p>
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            onClick={() => { setReplaceTarget(replaceChoice); setReplaceChoice(null); replaceInputRef.current?.click(); }}
          >
            <RefreshCw className="h-4 w-4" /> Upload from device
          </Button>
          <Button
            variant="outline"
            onClick={() => { setReplaceLibraryFor(replaceChoice); setReplaceChoice(null); }}
          >
            <Library className="h-4 w-4" /> Choose from Material Library
          </Button>
        </div>
      </Dialog>

      {/* 4.1 (library variant): pick a library file to replace the selected material with */}
      <Dialog
        open={!!replaceLibraryFor}
        onClose={() => setReplaceLibraryFor(null)}
        title={`Replace "${replaceLibraryFor?.originalFileName ?? ''}" from Material Library`}
        footer={<Button variant="outline" onClick={() => setReplaceLibraryFor(null)}>Close</Button>}
      >
        <p className="mb-3 text-xs text-slate-500">{isPublished ? 'Select a file to stage as the replacement — it goes live when you publish changes.' : 'Select a file to replace this material with as the current version.'}</p>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {((library?.data ?? []) as unknown as Material[]).filter((m) => m.topicId !== id && m.id !== replaceLibraryFor?.id).map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2">
              <div className="text-sm text-slate-700">
                {m.originalFileName} <span className="uppercase text-slate-400">· {m.fileType}</span>
              </div>
              <Button size="sm" variant="outline" onClick={() => { if (replaceLibraryFor) setReplaceLibraryPending({ material: replaceLibraryFor, source: m }); setReplaceLibraryFor(null); }}>
                Select
              </Button>
            </div>
          ))}
          {((library?.data ?? []) as unknown as Material[]).filter((m) => m.topicId !== id && m.id !== replaceLibraryFor?.id).length === 0 && (
            <p className="text-sm text-slate-400">No library materials available.</p>
          )}
        </div>
      </Dialog>

      {/* 4.1: replace/update a specific file (device) — confirm with a reason for change */}
      <ReasonForChangeDialog
        open={!!replacePending}
        onClose={() => setReplacePending(null)}
        onConfirm={async (r) => { await replaceMut.mutateAsync(r); setReplacePending(null); }}
        title={`Replace "${replacePending?.material.originalFileName ?? ''}" — Reason for Change`}
      />

      {/* 4.1 (library variant): confirm the library replacement with a reason for change */}
      <ReasonForChangeDialog
        open={!!replaceLibraryPending}
        onClose={() => setReplaceLibraryPending(null)}
        onConfirm={async (r) => { await replaceFromLibraryMut.mutateAsync(r); setReplaceLibraryPending(null); }}
        title={`Replace "${replaceLibraryPending?.material.originalFileName ?? ''}" with "${replaceLibraryPending?.source.originalFileName ?? ''}" — Reason for Change`}
      />

      {/* 4.3 / Step 3: publish / unpublish (archive) — controlled, e-signed */}
      <ESignatureModal
        open={!!statusChange}
        onClose={() => setStatusChange(null)}
        onConfirm={async (sig) => { await statusMut.mutateAsync(sig); setStatusChange(null); }}
        title={statusChange === 'PUBLISHED' ? 'Publish Topic (e-signature required)' : statusChange === 'ARCHIVED' ? 'Archive Topic (e-signature required)' : 'Unpublish Topic (e-signature required)'}
        defaultMeaning={statusChange === 'PUBLISHED' ? 'Approved' : statusChange === 'ARCHIVED' ? 'Performed' : 'Reviewed'}
        requireReason
      />

      {/* G4: confirm + e-sign to promote staged draft edits to the live published course. */}
      <ESignatureModal
        open={publishDraftOpen}
        onClose={() => setPublishDraftOpen(false)}
        onConfirm={async (sig) => { await publishDraftMut.mutateAsync(sig); }}
        title="Publish draft changes to the live course (e-signature required)"
        defaultMeaning="Approved"
        requireReason
      />

      {/* 4.2: choose from Material Library */}
      <Dialog
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        title="Choose from Material Library"
        footer={<Button variant="outline" onClick={() => setLibraryOpen(false)}>Close</Button>}
      >
        <p className="mb-3 text-xs text-slate-500">{isPublished ? 'Select a file to attach as a pending change — it goes live when you revise the topic.' : 'Select a file to attach to this topic as the current version.'}</p>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {((library?.data ?? []) as unknown as Material[]).filter((m) => m.topicId !== id).map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2">
              <div className="text-sm text-slate-700">
                {m.originalFileName} <span className="uppercase text-slate-400">· {m.fileType}</span>
              </div>
              <Button size="sm" variant="outline" disabled={attachMut.isPending} onClick={() => attachMut.mutate(m.id)}>
                Attach
              </Button>
            </div>
          ))}
          {((library?.data ?? []) as unknown as Material[]).filter((m) => m.topicId !== id).length === 0 && (
            <p className="text-sm text-slate-400">No library materials available.</p>
          )}
        </div>
      </Dialog>

      {/* 4.7: add this topic to one or more bundles */}
      <Dialog
        open={bundleDialogOpen}
        onClose={() => setBundleDialogOpen(false)}
        title="Add to Bundle(s)"
        footer={
          <>
            <Button variant="outline" onClick={() => setBundleDialogOpen(false)}>Cancel</Button>
            <Button disabled={selectedBundleIds.length === 0 || addToBundlesMut.isPending} onClick={() => addToBundlesMut.mutate()}>
              {addToBundlesMut.isPending ? 'Saving…' : 'Add'}
            </Button>
          </>
        }
      >
        <Field label="Bundles (select one or more)">
          <MultiSelect
            options={((bundles?.data ?? []) as unknown as BundleRow[]).map((b) => ({ value: b.id, label: b.name }))}
            value={selectedBundleIds}
            onChange={setSelectedBundleIds}
            placeholder="Search bundles…"
            emptyText="No bundles exist yet. Create one from the Bundles menu first."
          />
        </Field>
      </Dialog>

      {/* 7.1: in-app file viewer */}
      <Dialog
        open={!!viewingMaterial}
        onClose={() => setViewingMaterial(null)}
        className="max-w-4xl"
        title={viewingMaterial?.originalFileName ?? 'View Material'}
        footer={
          <>
            {viewingMaterial && (
              <Button
                variant="outline"
                onClick={() => navigate(`/materials/${viewingMaterial.id}/view?name=${encodeURIComponent(viewingMaterial.originalFileName)}&type=${viewingMaterial.fileType}`)}
              >
                Open full page
              </Button>
            )}
            <Button variant="outline" onClick={() => setViewingMaterial(null)}>Close</Button>
          </>
        }
      >
        {viewingMaterial && <InlineFileViewer materialId={viewingMaterial.id} fileName={viewingMaterial.originalFileName} fileType={viewingMaterial.fileType} />}
      </Dialog>

      {/* Per-material required reading/viewing time */}
      <Dialog
        open={!!readTimeTarget}
        onClose={() => setReadTimeTarget(null)}
        title={`Required reading time — ${readTimeTarget?.originalFileName ?? ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setReadTimeTarget(null)}>Cancel</Button>
            <Button disabled={readTimeMut.isPending} onClick={() => readTimeMut.mutate(Math.round(Number(readTimeMin || '0') * 60))}>
              {readTimeMut.isPending ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-xs text-slate-500">Users must keep this material open for at least this long before the assessment unlocks. Set 0 to remove the requirement.</p>
        <Field label="Minimum reading time (minutes)">
          <Input type="number" min={0} step={0.5} value={readTimeMin} onChange={(e) => setReadTimeMin(e.target.value)} placeholder="e.g. 2" />
        </Field>
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={applyReadTimeToAll} onChange={(e) => setApplyReadTimeToAll(e.target.checked)} />
          Apply this reading time to <strong>all files</strong> in this course
        </label>
        <p className="mt-2 text-xs text-slate-500">The course <strong>duration</strong> is recalculated from the total reading time and updated everywhere it's shown.</p>
      </Dialog>

      {/* Edit topic details (reason-for-change) */}
      <Dialog
        open={editTopicOpen}
        onClose={() => setEditTopicOpen(false)}
        className="max-w-2xl"
        title={`Edit Topic — ${t.title}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditTopicOpen(false)}>Cancel</Button>
            <Button disabled={!editTopicForm.title || !editTopicForm.maxAttempts} onClick={() => setEditTopicReasonOpen(true)}>
              Save…
            </Button>
          </>
        }
      >
        <p className="mb-2 text-xs text-slate-500">Topic code is system-owned and locked. Passing score is changed via its own e-signed action.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title" required><Input value={editTopicForm.title} onChange={(e) => setEditTopicForm((f) => ({ ...f, title: e.target.value }))} /></Field>
          <Field label="SOP Number"><Input value={editTopicForm.topicNumber} onChange={(e) => setEditTopicForm((f) => ({ ...f, topicNumber: e.target.value }))} /></Field>
        </div>
        <Field label="Training Type(s)" hint="Select one or more.">
          <MultiSelect
            options={trainingType.options.map((x) => ({ value: x, label: x.replace(/_/g, ' ') }))}
            value={editTopicForm.trainingTypes}
            onChange={(trainingTypes) => setEditTopicForm((f) => ({ ...f, trainingTypes }))}
            placeholder="Search training types…"
            heightClass="h-32"
          />
        </Field>
        <Field label="Description"><Textarea value={editTopicForm.description} onChange={(e) => setEditTopicForm((f) => ({ ...f, description: e.target.value }))} /></Field>
        <Field label="Functional Role(s)" hint="Assignment is via Functional Role / TNI / JD.">
          <MultiSelect options={editDesigOpts} value={editTopicForm.designationIds} onChange={(designationIds) => setEditTopicForm((f) => ({ ...f, designationIds }))} placeholder="Search functional roles…" heightClass="h-32" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={editTopicForm.requiresAssessment} onChange={(e) => setEditTopicForm((f) => ({ ...f, requiresAssessment: e.target.checked }))} /> Requires assessment (uncheck = SOP completes via read &amp; T&amp;C)</label>
          <Field label="Assessment time limit (min)" hint="Blank = no timer."><Input type="number" min={1} value={editTopicForm.assessmentTimeMinutes} disabled={!editTopicForm.requiresAssessment} onChange={(e) => setEditTopicForm((f) => ({ ...f, assessmentTimeMinutes: e.target.value }))} /></Field>
        </div>
        {/* CR-T9: structured signatories (User · Prepared/Reviewed/Approved · Date) — auto-completed on publish, they don't take the course. */}
        <div className="mt-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="iz-label">Signatories</span>
            <Button size="sm" variant="outline" onClick={() => setEditTopicForm((f) => ({ ...f, signatories: [...f.signatories, { userId: '', role: 'PREPARED', date: '' }] }))}>
              <Plus className="h-4 w-4" /> Add signatory
            </Button>
          </div>
          {editTopicForm.signatories.length === 0 && (
            <p className="text-xs text-slate-400">No signatories. Signatories are auto-marked complete on publish and don't take the course.</p>
          )}
          <div className="space-y-2">
            {editTopicForm.signatories.map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_150px_150px_auto] items-center gap-2">
                <Select
                  placeholder="Select user…"
                  options={editUserOpts}
                  value={s.userId}
                  onChange={(e) => setEditTopicForm((f) => ({ ...f, signatories: f.signatories.map((x, j) => (j === i ? { ...x, userId: e.target.value } : x)) }))}
                />
                <Select
                  options={[{ value: 'PREPARED', label: 'Prepared' }, { value: 'REVIEWED', label: 'Reviewed' }, { value: 'APPROVED', label: 'Approved' }]}
                  value={s.role}
                  onChange={(e) => setEditTopicForm((f) => ({ ...f, signatories: f.signatories.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) }))}
                />
                <Input type="date" value={s.date} onChange={(e) => setEditTopicForm((f) => ({ ...f, signatories: f.signatories.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) }))} />
                <button type="button" className="text-red-600" aria-label="Remove signatory" onClick={() => setEditTopicForm((f) => ({ ...f, signatories: f.signatories.filter((_, j) => j !== i) }))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
        {/* The edit form mirrors the create form's fields so a course shows the same
            inputs (pre-filled) on edit as on creation. On a published course, saving stages
            all of these (including Passing Score) until "Publish changes" is e-signed. */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Passing Score %">
            <Input type="number" min={0} max={100} value={editTopicForm.passingScorePercent} onChange={(e) => setEditTopicForm((f) => ({ ...f, passingScorePercent: e.target.value }))} />
          </Field>
          <Field label="Duration (minutes)" hint="Optional. Auto-recalculated from material reading time once set.">
            <Input type="number" min={0} value={editTopicForm.durationMinutes} onChange={(e) => setEditTopicForm((f) => ({ ...f, durationMinutes: e.target.value }))} placeholder="e.g. 30" />
          </Field>
        </div>
        <div className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Advanced (optional)</div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Max Attempts"><Input type="number" min={1} value={editTopicForm.maxAttempts} onChange={(e) => setEditTopicForm((f) => ({ ...f, maxAttempts: e.target.value }))} /></Field>
          <Field label="Question Limit"><Input type="number" min={1} value={editTopicForm.questionLimit} onChange={(e) => setEditTopicForm((f) => ({ ...f, questionLimit: e.target.value }))} placeholder="default" /></Field>
          <Field label="Effective Date"><Input type="date" value={editTopicForm.effectiveDate} onChange={(e) => setEditTopicForm((f) => ({ ...f, effectiveDate: e.target.value }))} /></Field>
        </div>
        <div className="space-y-1.5 rounded border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={editTopicForm.randomizeQuestions} onChange={(e) => setEditTopicForm((f) => ({ ...f, randomizeQuestions: e.target.checked }))} /> Randomize questions</label>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={editTopicForm.showExplanations} onChange={(e) => setEditTopicForm((f) => ({ ...f, showExplanations: e.target.checked }))} /> Show explanations after a failed attempt</label>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={editTopicForm.blockAfterMaxAttempts} onChange={(e) => setEditTopicForm((f) => ({ ...f, blockAfterMaxAttempts: e.target.checked }))} /> Block after maximum failed attempts</label>
        </div>
      </Dialog>

      <ReasonForChangeDialog
        open={editTopicReasonOpen}
        onClose={() => setEditTopicReasonOpen(false)}
        onConfirm={async (r) => { await updateTopicMut.mutateAsync(r); }}
        title="Edit Topic — Reason for Change"
      />
    </div>
  );
}
