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
}

export function FileUpload({ onSelect, accept, label = 'Choose file', multiple, onSelectMany }: FileUploadProps) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2">
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
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
      <Button type="button" variant="outline" onClick={() => ref.current?.click()}>
        <Upload className="h-4 w-4" /> {label}
      </Button>
    </div>
  );
}
