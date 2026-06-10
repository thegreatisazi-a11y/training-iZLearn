import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '../ui/button';

export function FileUpload({ onSelect, accept, label = 'Choose file' }: { onSelect: (f: File) => void; accept?: string; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  return (
    <div className="flex items-center gap-2">
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setName(f.name);
            onSelect(f);
          }
        }}
      />
      <Button type="button" variant="outline" onClick={() => ref.current?.click()}>
        <Upload className="h-4 w-4" /> {label}
      </Button>
      {name && <span className="text-sm text-slate-600">{name}</span>}
    </div>
  );
}
