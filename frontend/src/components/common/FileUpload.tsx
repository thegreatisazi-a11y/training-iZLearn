import { useRef } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '../ui/button';

interface FileUploadProps {
  onSelect: (f: File) => void;
  accept?: string;
  label?: string;
  /** Allow choosing several files at once. Requires `onSelectMany` to receive them. */
  multiple?: boolean;
  /** Called with all chosen files when `multiple` is set (falls back to per-file `onSelect`). */
  onSelectMany?: (files: File[]) => void;
  /** When set (0–100), the button shows live upload progress ("Uploading… 42%") and is disabled. */
  progress?: number | null;
}

export function FileUpload({ onSelect, accept, label = 'Choose file', multiple, onSelectMany, progress }: FileUploadProps) {
  const ref = useRef<HTMLInputElement>(null);
  const uploading = progress != null;
  return (
    <div className="flex items-center gap-2">
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={uploading}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length === 0) return;
          if (multiple && onSelectMany) onSelectMany(files);
          else files.forEach(onSelect);
          // Reset the input so the same file can be re-selected. We intentionally do NOT
          // keep the chosen file name displayed beside the button: the upload may still
          // fail (e.g. a duplicate), and a lingering name reads as though the file was
          // attached. The real outcome is shown by the parent — a toast on failure and
          // the material list on success — while the button label reflects progress.
          e.target.value = '';
        }}
      />
      <Button type="button" variant="outline" disabled={uploading} onClick={() => ref.current?.click()}>
        <Upload className="h-4 w-4" /> {uploading ? `Uploading… ${progress}%` : label}
      </Button>
    </div>
  );
}
