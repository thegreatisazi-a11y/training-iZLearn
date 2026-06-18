// Ambient type shim for read-excel-file (browser build) — used by the I6 JD template
// Excel import. The package exposes only subpath exports, so we declare the one we use.
declare module 'read-excel-file/browser' {
  type Row = (string | number | boolean | Date | null)[];
  export default function readXlsxFile(input: Blob | File): Promise<Row[]>;
}
