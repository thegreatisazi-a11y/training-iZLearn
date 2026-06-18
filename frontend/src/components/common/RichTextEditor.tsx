import { useEffect, useRef } from 'react';
import {
  Bold, Italic, Underline, Strikethrough, Heading1, Heading2, Heading3, Pilcrow,
  List, ListOrdered, Table as TableIcon, Link2, Quote, Eraser, Undo2, Redo2,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, Baseline, Highlighter,
} from 'lucide-react';

/**
 * I6: a "Word-like" rich-text editor (headings, bold/italic/underline/strikethrough,
 * text colour + highlight, alignment, lists, tables, links, blockquote, undo/redo,
 * clear-formatting) built on a contentEditable surface — no heavy editor dependency.
 * Emits raw HTML; the server sanitises it with DOMPurify before persistence.
 */
export function RichTextEditor({
  value,
  onChange,
  minHeightClass = 'min-h-[420px]',
}: {
  value: string;
  onChange: (html: string) => void;
  minHeightClass?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Seed the editable surface once (and when the value is replaced wholesale, e.g.
  // after a Word/Excel import) — but not on every keystroke, to preserve the caret.
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value) el.innerHTML = value || '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = () => onChange(ref.current?.innerHTML ?? '');
  const exec = (command: string, arg?: string) => {
    ref.current?.focus();
    // Use inline CSS for colour/highlight so styles survive sanitisation + render.
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* not supported — ignore */ }
    document.execCommand(command, false, arg);
    emit();
  };
  const insertHtml = (html: string) => {
    ref.current?.focus();
    document.execCommand('insertHTML', false, html);
    emit();
  };
  const insertTable = () => {
    const rows = Math.max(1, Math.min(20, Number(window.prompt('Number of rows?', '3')) || 0));
    const cols = Math.max(1, Math.min(12, Number(window.prompt('Number of columns?', '3')) || 0));
    if (!rows || !cols) return;
    const cell = '<td style="border:1px solid #cbd5e1;padding:6px;min-width:60px">&nbsp;</td>';
    const row = `<tr>${cell.repeat(cols)}</tr>`;
    insertHtml(`<table style="border-collapse:collapse;width:100%">${row.repeat(rows)}</table><p></p>`);
  };
  const insertLink = () => {
    const url = window.prompt('Link URL (https://…)');
    if (!url) return;
    exec('createLink', url);
  };

  const Btn = ({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded text-slate-600 hover:bg-slate-100"
    >
      {children}
    </button>
  );
  const Sep = () => <span className="mx-1 h-5 w-px bg-slate-200" />;
  // Colour pickers: a small swatch overlaying a hidden native input.
  const Color = ({ title, command, icon }: { title: string; command: string; icon: React.ReactNode }) => (
    <label title={title} className="relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded text-slate-600 hover:bg-slate-100">
      {icon}
      <input
        type="color"
        className="absolute inset-0 cursor-pointer opacity-0"
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => exec(command, e.target.value)}
      />
    </label>
  );

  return (
    <div className="rounded-md border border-slate-300">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-1 py-1">
        <Btn title="Undo" onClick={() => exec('undo')}><Undo2 className="h-4 w-4" /></Btn>
        <Btn title="Redo" onClick={() => exec('redo')}><Redo2 className="h-4 w-4" /></Btn>
        <Sep />
        <Btn title="Heading 1" onClick={() => exec('formatBlock', 'H1')}><Heading1 className="h-4 w-4" /></Btn>
        <Btn title="Heading 2" onClick={() => exec('formatBlock', 'H2')}><Heading2 className="h-4 w-4" /></Btn>
        <Btn title="Heading 3" onClick={() => exec('formatBlock', 'H3')}><Heading3 className="h-4 w-4" /></Btn>
        <Btn title="Paragraph" onClick={() => exec('formatBlock', 'P')}><Pilcrow className="h-4 w-4" /></Btn>
        <Sep />
        <Btn title="Bold" onClick={() => exec('bold')}><Bold className="h-4 w-4" /></Btn>
        <Btn title="Italic" onClick={() => exec('italic')}><Italic className="h-4 w-4" /></Btn>
        <Btn title="Underline" onClick={() => exec('underline')}><Underline className="h-4 w-4" /></Btn>
        <Btn title="Strikethrough" onClick={() => exec('strikeThrough')}><Strikethrough className="h-4 w-4" /></Btn>
        <Color title="Text colour" command="foreColor" icon={<Baseline className="h-4 w-4" />} />
        <Color title="Highlight" command="hiliteColor" icon={<Highlighter className="h-4 w-4" />} />
        <Sep />
        <Btn title="Align left" onClick={() => exec('justifyLeft')}><AlignLeft className="h-4 w-4" /></Btn>
        <Btn title="Align center" onClick={() => exec('justifyCenter')}><AlignCenter className="h-4 w-4" /></Btn>
        <Btn title="Align right" onClick={() => exec('justifyRight')}><AlignRight className="h-4 w-4" /></Btn>
        <Btn title="Justify" onClick={() => exec('justifyFull')}><AlignJustify className="h-4 w-4" /></Btn>
        <Sep />
        <Btn title="Bullet list" onClick={() => exec('insertUnorderedList')}><List className="h-4 w-4" /></Btn>
        <Btn title="Numbered list" onClick={() => exec('insertOrderedList')}><ListOrdered className="h-4 w-4" /></Btn>
        <Btn title="Quote" onClick={() => exec('formatBlock', 'BLOCKQUOTE')}><Quote className="h-4 w-4" /></Btn>
        <Btn title="Insert link" onClick={insertLink}><Link2 className="h-4 w-4" /></Btn>
        <Btn title="Insert table" onClick={insertTable}><TableIcon className="h-4 w-4" /></Btn>
        <Sep />
        <Btn title="Clear formatting" onClick={() => { exec('removeFormat'); exec('unlink'); }}><Eraser className="h-4 w-4" /></Btn>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        className={`prose-sm max-w-none overflow-auto px-3 py-2 text-sm text-slate-800 focus:outline-none [&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600 [&_a]:text-primary [&_a]:underline [&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 ${minHeightClass}`}
      />
    </div>
  );
}

/** I6: convert an uploaded Word (.docx) file to HTML for the editor (lazy-loaded). */
export async function importWordToHtml(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return result.value;
}

/** I6: convert the first sheet of an uploaded Excel (.xlsx) file to an HTML table. */
export async function importExcelToHtml(file: File): Promise<string> {
  const readXlsxFile = (await import('read-excel-file/browser')).default;
  const rows = (await readXlsxFile(file)) as unknown[][];
  if (!rows.length) return '';
  const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const [head, ...body] = rows;
  const headHtml = `<tr>${head.map((c) => `<th style="border:1px solid #cbd5e1;padding:6px;background:#f1f5f9;text-align:left">${esc(c)}</th>`).join('')}</tr>`;
  const bodyHtml = body
    .map((r) => `<tr>${r.map((c) => `<td style="border:1px solid #cbd5e1;padding:6px">${esc(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<table style="border-collapse:collapse;width:100%">${headHtml}${bodyHtml}</table>`;
}
