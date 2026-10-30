import { useRef, useState } from 'react';
import { BookOpen, Info } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  dataService,
  QueryKeys,
  MutationKeys,
  EToolResources,
  CANVAS_ERROR_CODES,
} from 'librechat-data-provider';
import {
  Button,
  Input,
  Checkbox,
  OGDialog,
  OGDialogTitle,
  OGDialogContent,
  OGDialogDescription,
} from '@librechat/client';
import type {
  CanvasContext,
  CanvasMaterial,
  CanvasSelection,
  CanvasErrorCode,
  TConversation,
} from 'librechat-data-provider';
import type { ExtendedFile, FileSetter } from '~/common';
import { useSchoolQuery, useCanvasCourses, useCanvasMaterials } from '~/data-provider/School';
import { useFileHandlingNoChatContext } from '~/hooks/Files';
import { useLocalize } from '~/hooks';

const errorKey = (error: unknown): `com_school_${CanvasErrorCode}` => {
  const code = (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
  return `com_school_${CANVAS_ERROR_CODES.find((value) => value === code) ?? 'school_request_failed'}`;
};

export default function SchoolCanvas({
  index,
  conversation,
  disabled,
  files,
  setFiles,
  setFilesLoading,
}: {
  index: number;
  conversation: TConversation | null;
  disabled: boolean;
  files: Map<string, ExtendedFile>;
  setFiles: FileSetter;
  setFilesLoading: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const localize = useLocalize();
  const cache = useQueryClient();
  const { data: school } = useSchoolQuery();
  const [open, setOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [token, setToken] = useState('');
  const [courseId, setCourseId] = useState('');
  const [kind, setKind] = useState<'assignment' | 'page'>('assignment');
  const [selected, setSelected] = useState<CanvasSelection[]>([]);
  const [preview, setPreview] = useState<CanvasContext | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attaching, setAttaching] = useState(false);
  const scope = conversation?.conversationId ?? 'new';
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const { handleFiles } = useFileHandlingNoChatContext(undefined, {
    index,
    conversation,
    files,
    setFiles,
    setFilesLoading,
  });
  const courses = useCanvasCourses(open && school?.canvas.connected === true);
  const materials = useCanvasMaterials(courseId, kind, open && school?.canvas.connected === true);
  const connect = useMutation((value: string) => dataService.connectSchoolCanvas(value), {
    mutationKey: [MutationKeys.connectSchoolCanvas],
    onSuccess: () => {
      setToken('');
      setError(null);
      void cache.invalidateQueries([QueryKeys.school]);
      void cache.invalidateQueries([QueryKeys.canvasCourses]);
    },
    onError: setError,
  });
  const disconnect = useMutation(dataService.disconnectSchoolCanvas, {
    mutationKey: [MutationKeys.disconnectSchoolCanvas],
    onSuccess: () => {
      setCourseId('');
      setSelected([]);
      setPreview(null);
      cache.removeQueries([QueryKeys.canvasCourses]);
      cache.removeQueries([QueryKeys.canvasMaterials]);
      void cache.invalidateQueries([QueryKeys.school]);
    },
    onError: setError,
  });
  const prepare = useMutation(dataService.getCanvasContext, {
    mutationKey: [MutationKeys.prepareCanvasContext],
    onSuccess: setPreview,
    onError: setError,
  });
  if (!school?.enabled || index !== 0) return null;

  function resetSelection() {
    setSelected([]);
    setPreview(null);
    setError(null);
  }
  function toggle(item: CanvasMaterial, checked: boolean) {
    setPreview(null);
    setSelected((prev) =>
      checked
        ? [...prev, { courseId, kind: item.kind, id: item.id }]
        : prev.filter((value) => !(value.kind === item.kind && value.id === item.id)),
    );
  }
  async function attach() {
    if (!preview) return;
    const capturedScope = scope;
    setError(null);
    setAttaching(true);
    try {
      const accepted = await handleFiles(
        [new File([preview.markdown], preview.filename, { type: 'text/markdown' })],
        EToolResources.context,
        {
          shouldCommit: () => currentScope.current === capturedScope,
          isCurrent: () => currentScope.current === capturedScope,
        },
      );
      if (accepted && currentScope.current === capturedScope) {
        setOpen(false);
        resetSelection();
      }
    } catch (err) {
      setError(err);
    } finally {
      setAttaching(false);
    }
  }
  const failure = error ?? courses.error ?? materials.error;
  const busy = connect.isLoading || disconnect.isLoading || prepare.isLoading || attaching;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1 px-3 pt-2">
        {school.canvas.enabled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              setOpen(true);
              setError(null);
            }}
          >
            <BookOpen className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {localize('com_school_canvas')}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={() => setPolicyOpen(true)}>
          <Info className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {localize('com_school_guidance')}
        </Button>
      </div>
      <OGDialog open={policyOpen} onOpenChange={setPolicyOpen}>
        <OGDialogContent showCloseButton>
          <OGDialogTitle>{school.name}</OGDialogTitle>
          <OGDialogDescription>{school.guidance}</OGDialogDescription>
          <p className="text-text-secondary text-sm">{localize('com_school_policy_note')}</p>
          {school.canvas.toolCalling && (
            <p className="text-text-secondary text-sm">
              {localize('com_school_canvas_tools_note')}
            </p>
          )}
        </OGDialogContent>
      </OGDialog>
      <OGDialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
            setToken('');
          }
        }}
      >
        <OGDialogContent showCloseButton className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <OGDialogTitle>{localize('com_school_canvas')}</OGDialogTitle>
          <OGDialogDescription>{localize('com_school_canvas_description')}</OGDialogDescription>
          {school.canvas.toolCalling && (
            <p className="text-text-secondary text-sm">
              {localize('com_school_canvas_tools_note')}
            </p>
          )}
          <p className="text-text-secondary text-sm break-all">{school.canvas.baseUrl}</p>
          {failure != null && (
            <div
              role="alert"
              className="text-text-primary border-border-medium rounded-md border p-3 text-sm"
            >
              <p>{localize(errorKey(failure))}</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setError(null);
                  void courses.refetch();
                  if (courseId) void materials.refetch();
                }}
              >
                {localize('com_school_retry')}
              </Button>
            </div>
          )}
          {!school.canvas.connected ? (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                setError(null);
                connect.mutate(token);
              }}
            >
              <label className="block text-sm" htmlFor="canvas-token">
                {localize('com_school_token')}
              </label>
              <Input
                id="canvas-token"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                disabled={busy}
              />
              <p className="text-text-secondary text-xs">{localize('com_school_token_note')}</p>
              <Button type="submit" disabled={busy || !token.trim()}>
                {localize(connect.isLoading ? 'com_school_connecting' : 'com_school_connect')}
              </Button>
            </form>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-text-secondary text-sm">
                  {localize('com_school_connected')}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => disconnect.mutate()}
                >
                  {localize('com_school_disconnect')}
                </Button>
              </div>
              {courses.isLoading && <p role="status">{localize('com_school_loading')}</p>}
              {courses.data?.items.length === 0 && <p>{localize('com_school_no_courses')}</p>}
              <label className="block space-y-1 text-sm">
                <span>{localize('com_school_course')}</span>
                <select
                  aria-label={localize('com_school_course')}
                  className="border-border-medium bg-surface-primary text-text-primary w-full rounded-md border px-3 py-2"
                  value={courseId}
                  disabled={busy || courses.isLoading}
                  onChange={(event) => {
                    setCourseId(event.target.value);
                    resetSelection();
                  }}
                >
                  <option value="">{localize('com_school_choose_course')}</option>
                  {courses.data?.items.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name || course.code}
                    </option>
                  ))}
                </select>
              </label>
              {courses.data?.truncated && (
                <p className="text-text-secondary text-xs">{localize('com_school_list_limited')}</p>
              )}
              {courseId && (
                <>
                  <label className="block space-y-1 text-sm">
                    <span>{localize('com_school_material_type')}</span>
                    <select
                      aria-label={localize('com_school_material_type')}
                      className="border-border-medium bg-surface-primary text-text-primary w-full rounded-md border px-3 py-2"
                      value={kind}
                      disabled={busy}
                      onChange={(event) => {
                        setKind(event.target.value === 'page' ? 'page' : 'assignment');
                        setPreview(null);
                        setError(null);
                      }}
                    >
                      <option value="assignment">{localize('com_school_assignments')}</option>
                      <option value="page">{localize('com_school_pages')}</option>
                    </select>
                  </label>
                  {materials.isFetching && <p role="status">{localize('com_school_loading')}</p>}
                  {materials.data?.items.length === 0 && (
                    <p>{localize('com_school_no_materials')}</p>
                  )}
                  <div className="max-h-64 space-y-2 overflow-y-auto">
                    {materials.data?.items.map((item) => {
                      const checked = selected.some(
                        (value) => value.kind === item.kind && value.id === item.id,
                      );
                      return (
                        <div
                          key={`${item.kind}-${item.id}`}
                          className="border-border-light flex items-start gap-3 rounded-md border p-3"
                        >
                          <Checkbox
                            id={`canvas-${item.kind}-${item.id}`}
                            aria-label={item.title}
                            checked={checked}
                            disabled={busy || (!checked && selected.length >= 10)}
                            onCheckedChange={(value) => toggle(item, value === true)}
                          />
                          <div className="min-w-0 flex-1">
                            <label
                              htmlFor={`canvas-${item.kind}-${item.id}`}
                              className="block cursor-pointer text-sm"
                            >
                              {item.title}
                            </label>
                            {item.dueAt && (
                              <p className="text-text-secondary text-xs">
                                {localize('com_school_due')}{' '}
                                {new Date(item.dueAt).toLocaleDateString()}
                              </p>
                            )}
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-text-secondary text-xs underline"
                            >
                              {localize('com_school_open_canvas')}
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {materials.data?.truncated && (
                    <p className="text-text-secondary text-xs">
                      {localize('com_school_list_limited')}
                    </p>
                  )}
                  <p className="text-text-secondary text-xs">
                    {localize('com_school_selection_count', { count: selected.length })}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || !selected.length}
                    onClick={() => {
                      setError(null);
                      prepare.mutate(selected);
                    }}
                  >
                    {localize(prepare.isLoading ? 'com_school_loading' : 'com_school_preview')}
                  </Button>
                </>
              )}
              {preview && (
                <div className="space-y-3">
                  <p className="text-text-secondary text-sm">
                    {localize('com_school_attach_note')}
                  </p>
                  <pre className="border-border-medium bg-surface-secondary max-h-60 overflow-auto rounded-md border p-3 text-xs break-words whitespace-pre-wrap">
                    {preview.markdown}
                  </pre>
                  <Button type="button" disabled={busy || disabled} onClick={() => void attach()}>
                    {localize(attaching ? 'com_school_attaching' : 'com_school_attach')}
                  </Button>
                </div>
              )}
            </>
          )}
        </OGDialogContent>
      </OGDialog>
    </>
  );
}
