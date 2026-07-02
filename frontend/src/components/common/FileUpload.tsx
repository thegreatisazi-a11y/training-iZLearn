import { useRef, useState } from 'react';
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
  const [name, setName] = useState('');
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
          setName(files.length > 1 ? `${files.length} files selected` : files[0].name);
          if (multiple && onSelectMany) onSelectMany(files);
          else files.forEach(onSelect);
          // Reset so selecting the same file(s) again re-triggers onChange.
          e.target.value = '';
        }}
      />
      <Button type="button" variant="outline" onClick={() => ref.current?.click()}>
        <Upload className="h-4 w-4" /> {label}
      </Button>
      {name && <span className="text-sm text-slate-600">{name}</span>}
    </div>
  );
}
